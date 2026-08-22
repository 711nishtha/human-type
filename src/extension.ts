/*!
 * Human Type - Granular, human-like text insertion for VS Code.
 * Copyright (c) 2026 Nishtha Sharma. All rights reserved.
 * Licensed under the terms in LICENSE. Redistribution is not permitted.
 */
/**
 * Command layer.
 *
 * Everything here is orchestration: resolve the target editor, resolve configuration,
 * validate, hand off to the InsertionEngine, and report the outcome. The editing logic
 * lives in `insertionEngine.ts` and the splitting logic in `chunker.ts`.
 */
import * as vscode from 'vscode';
import { errorMessage, readClipboard } from './clipboard';
import { readConfig } from './config';
import { InsertionEngine } from './insertionEngine';
import { ProgressReporter } from './progress';
import { decodeEscapes } from './textUtils';
import { InsertionOutcome } from './types';

/** Context key that gates the Escape keybinding and the palette entry for Cancel. */
const INSERTING_CONTEXT = 'humanType.inserting';

/** Hard-coded sample used by the Test Undo Behavior command. */
const UNDO_TEST_TEXT = 'one two three';

let engine: InsertionEngine;

export function activate(context: vscode.ExtensionContext): void {
  engine = new InsertionEngine();
  context.subscriptions.push(engine);

  context.subscriptions.push(
    vscode.commands.registerCommand('humanType.insertClipboard', insertClipboardCommand),
    vscode.commands.registerCommand('humanType.insertText', insertTextCommand),
    vscode.commands.registerCommand('humanType.insertSelection', insertSelectionCommand),
    vscode.commands.registerCommand('humanType.cancel', cancelCommand),
    vscode.commands.registerCommand('humanType.openSettings', openSettingsCommand),
    vscode.commands.registerCommand('humanType.testUndoBehavior', testUndoBehaviorCommand)
  );

  void vscode.commands.executeCommand('setContext', INSERTING_CONTEXT, false);
}

export function deactivate(): void {
  engine?.dispose();
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

async function insertClipboardCommand(): Promise<void> {
  const editor = requireEditor();
  if (!editor) {
    return;
  }
  const clipboard = await readClipboard();
  if (!clipboard.ok) {
    vscode.window.showWarningMessage(`Human Type: ${clipboard.reason}`);
    return;
  }
  await runInsertion(editor, clipboard.text);
}

async function insertTextCommand(): Promise<void> {
  const editor = requireEditor();
  if (!editor) {
    return;
  }
  const input = await vscode.window.showInputBox({
    title: 'Human Type: Insert Text',
    prompt: 'Text to insert. Use \\n for a line break and \\t for a tab.',
    placeHolder: 'console.log("hello");',
    ignoreFocusOut: true
  });
  if (input === undefined) {
    return; // user dismissed the box
  }
  if (input.length === 0) {
    vscode.window.showWarningMessage('Human Type: nothing to insert.');
    return;
  }
  await runInsertion(editor, decodeEscapes(input));
}

async function insertSelectionCommand(): Promise<void> {
  const editor = requireEditor();
  if (!editor) {
    return;
  }
  const selected = editor.document.getText(editor.selection);
  if (selected.length === 0) {
    vscode.window.showWarningMessage(
      'Human Type: select some text first. Insert Selection re-inserts the selected text ' +
        'in chunks, replacing it in place.'
    );
    return;
  }
  await runInsertion(editor, selected);
}

function cancelCommand(): void {
  if (!engine.isRunning()) {
    vscode.window.showInformationMessage('Human Type: no insertion is running.');
    return;
  }
  engine.cancel();
}

async function openSettingsCommand(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', 'humanType');
}

/**
 * Proof-of-concept command kept in the shipping build.
 *
 * Inserts a known string in word mode so a user (or a bug reporter) can verify undo
 * granularity on their own machine in five seconds.
 */
async function testUndoBehaviorCommand(): Promise<void> {
  const editor = requireEditor();
  if (!editor) {
    return;
  }
  const { config } = readConfig(editor.document);
  const outcome = await runInsertionWithConfig(
    editor,
    UNDO_TEST_TEXT,
    { ...config, mode: 'word', speed: 'normal', delayMs: 40 },
    { silentSuccess: true }
  );
  if (outcome?.status !== 'completed') {
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    `Human Type inserted "${UNDO_TEST_TEXT}" as ${outcome.chunks} chunks. ` +
      `Press Ctrl+Z (Cmd+Z) ${outcome.chunks} times: each press should remove one chunk. ` +
      'Then press Ctrl+Y (Cmd+Shift+Z) the same number of times to bring it back.',
    'Open the full test checklist'
  );
  if (choice) {
    await vscode.commands.executeCommand(
      'vscode.open',
      vscode.Uri.joinPath(currentExtensionUri(), 'docs', 'MANUAL-TESTS.md')
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Shared insertion flow                                                       */
/* -------------------------------------------------------------------------- */

async function runInsertion(editor: vscode.TextEditor, text: string): Promise<void> {
  const { config, diagnostics } = readConfig(editor.document);
  for (const warning of diagnostics.warnings) {
    vscode.window.showWarningMessage(`Human Type setting ignored - ${warning}`);
  }
  await runInsertionWithConfig(editor, text, config, { silentSuccess: false });
}

interface RunOptions {
  readonly silentSuccess: boolean;
}

async function runInsertionWithConfig(
  editor: vscode.TextEditor,
  text: string,
  config: ReturnType<typeof readConfig>['config'],
  options: RunOptions
): Promise<InsertionOutcome | undefined> {
  if (engine.isRunning()) {
    vscode.window.showWarningMessage(
      'Human Type: an insertion is already running. Press Escape or run ' +
        '"Human Type: Cancel Current Insertion" first.'
    );
    return undefined;
  }

  // MVP limitation, documented in the README: a single insertion targets one caret.
  if (editor.selections.length > 1) {
    const proceed = await vscode.window.showWarningMessage(
      `Human Type: ${editor.selections.length} cursors are active. Multi-cursor insertion ` +
        'is not supported yet, because keeping every caret and its undo steps consistent ' +
        'cannot be done reliably with the current API. Human Type will use the primary ' +
        'cursor only.',
      { modal: false },
      'Use primary cursor',
      'Cancel'
    );
    if (proceed !== 'Use primary cursor') {
      return undefined;
    }
  }

  if (config.largeInputThreshold > 0 && text.length > config.largeInputThreshold) {
    const kb = Math.round(text.length / 1024);
    const proceed = await vscode.window.showWarningMessage(
      `Human Type: this is a large insertion (${kb} KB). It will be split into at most ` +
        `${config.maxChunks} undo steps and may take a while. Insert anyway?`,
      { modal: true },
      'Insert'
    );
    if (proceed !== 'Insert') {
      return undefined;
    }
  }

  const reporter = new ProgressReporter(config.showProgress);
  let outcome: InsertionOutcome;
  try {
    await vscode.commands.executeCommand('setContext', INSERTING_CONTEXT, true);
    reporter.start();
    outcome = await engine.insert({
      editor,
      text,
      config,
      onProgress: (p) => reporter.report(p)
    });
  } catch (err) {
    outcome = {
      status: 'failed',
      reason: `Unexpected error: ${errorMessage(err)}`,
      chunks: 0,
      characters: 0
    };
  } finally {
    reporter.dispose();
    await vscode.commands.executeCommand('setContext', INSERTING_CONTEXT, false);
  }

  reportOutcome(outcome, options);
  return outcome;
}

function reportOutcome(outcome: InsertionOutcome, options: RunOptions): void {
  switch (outcome.status) {
    case 'completed':
      if (!options.silentSuccess && outcome.chunks > 0) {
        vscode.window.setStatusBarMessage(
          `$(check) Human Type: inserted ${outcome.characters} characters in ${outcome.chunks} undo steps.`,
          4000
        );
      }
      break;
    case 'cancelled':
      vscode.window.showInformationMessage(
        `Human Type: cancelled after ${outcome.chunks} of the planned chunks. ` +
          'The text inserted so far was left in place - press Ctrl+Z to step back through it.'
      );
      break;
    case 'failed':
      vscode.window.showErrorMessage(`Human Type: ${outcome.reason}`);
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function requireEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(
      'Human Type: open a file and place the cursor where the text should go.'
    );
    return undefined;
  }
  if (editor.document.isClosed) {
    vscode.window.showWarningMessage('Human Type: the active document has been closed.');
    return undefined;
  }
  return editor;
}

function currentExtensionUri(): vscode.Uri {
  const ext =
    vscode.extensions.getExtension('711nishtha.human-type') ??
    vscode.extensions.all.find((e) => e.packageJSON?.name === 'human-type');
  if (!ext) {
    throw new Error('Human Type: could not locate the extension installation directory.');
  }
  return ext.extensionUri;
}
