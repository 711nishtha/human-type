/**
 * Integration tests for the command layer and configuration reader.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { DEFAULTS, SPEED_DELAYS, readConfig } from '../../src/config';

const ALL_COMMANDS = [
  'humanType.insertClipboard',
  'humanType.insertText',
  'humanType.insertSelection',
  'humanType.cancel',
  'humanType.openSettings',
  'humanType.testUndoBehavior'
];

async function openDoc(content = '', language = 'plaintext'): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  return vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('waitFor: condition was never met');
}

suite('commands', () => {
  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('the extension activates', async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON?.name === 'human-type');
    assert.ok(ext, 'the Human Type extension was not loaded');
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('every contributed command is registered', async () => {
    const registered = await vscode.commands.getCommands(true);
    for (const id of ALL_COMMANDS) {
      assert.ok(registered.includes(id), `${id} is not registered`);
    }
  });

  test('package.json contributes exactly the commands the code registers', () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON?.name === 'human-type');
    const contributed: string[] = (ext?.packageJSON.contributes.commands ?? []).map(
      (c: { command: string }) => c.command
    );
    assert.deepStrictEqual([...contributed].sort(), [...ALL_COMMANDS].sort());
  });

  test('Insert Clipboard inserts the clipboard contents', async () => {
    const editor = await openDoc('');
    await vscode.env.clipboard.writeText('clip board text');
    await vscode.commands.executeCommand('humanType.insertClipboard');
    await waitFor(() => editor.document.getText() === 'clip board text');
    assert.strictEqual(editor.document.getText(), 'clip board text');
  });

  test('Insert Clipboard preserves multi-line code exactly', async () => {
    const editor = await openDoc('', 'python');
    const src = 'def hello():\n    print("Hello")\n    return True\n';
    await vscode.env.clipboard.writeText(src);
    await vscode.commands.executeCommand('humanType.insertClipboard');
    const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const want = src.replace(/\n/g, eol);
    await waitFor(() => editor.document.getText() === want);
    assert.strictEqual(editor.document.getText(), want);
  });

  test('Insert Selection re-inserts the selected text in place', async () => {
    const editor = await openDoc('keep SELECTED keep');
    editor.selection = new vscode.Selection(
      editor.document.positionAt(5),
      editor.document.positionAt(13)
    );
    await vscode.commands.executeCommand('humanType.insertSelection');
    await waitFor(() => editor.document.getText() === 'keep SELECTED keep');
    assert.strictEqual(editor.document.getText(), 'keep SELECTED keep');
  });

  test('Test Undo Behavior inserts the sample and it undoes one chunk at a time', async () => {
    const editor = await openDoc('');
    // Not awaited: the command ends on a notification that nobody will dismiss here.
    void vscode.commands.executeCommand('humanType.testUndoBehavior');
    await waitFor(() => editor.document.getText() === 'one two three');

    await vscode.commands.executeCommand('undo');
    assert.strictEqual(editor.document.getText(), 'one two ');
    await vscode.commands.executeCommand('undo');
    assert.strictEqual(editor.document.getText(), 'one two');
  });

  test('Cancel with nothing running does not throw', async () => {
    await openDoc('');
    await assert.doesNotReject(() => Promise.resolve(vscode.commands.executeCommand('humanType.cancel')));
  });

  test('commands with no active editor warn instead of throwing', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await waitFor(() => vscode.window.activeTextEditor === undefined);
    for (const id of ['humanType.insertClipboard', 'humanType.insertText', 'humanType.insertSelection']) {
      await assert.doesNotReject(
        () => Promise.resolve(vscode.commands.executeCommand(id)),
        `${id} threw with no active editor`
      );
    }
  });

  test('Insert Selection with an empty selection warns instead of inserting', async () => {
    const editor = await openDoc('unchanged content');
    editor.selection = new vscode.Selection(
      editor.document.positionAt(0),
      editor.document.positionAt(0)
    );
    await vscode.commands.executeCommand('humanType.insertSelection');
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(editor.document.getText(), 'unchanged content');
  });
});

suite('configuration', () => {
  test('defaults match the values declared in package.json', () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON?.name === 'human-type');
    const props = ext?.packageJSON.contributes.configuration.properties as Record<
      string,
      { default: unknown }
    >;
    assert.strictEqual(props['humanType.mode'].default, DEFAULTS.mode);
    assert.strictEqual(props['humanType.speed'].default, DEFAULTS.speed);
    assert.strictEqual(props['humanType.smartChunking'].default, DEFAULTS.smartChunking);
    assert.strictEqual(props['humanType.showProgress'].default, DEFAULTS.showProgress);
    assert.strictEqual(props['humanType.replaceSelection'].default, DEFAULTS.replaceSelection);
    assert.strictEqual(props['humanType.maxChunks'].default, DEFAULTS.maxChunks);
    assert.strictEqual(props['humanType.largeInputThreshold'].default, DEFAULTS.largeInputThreshold);
    assert.strictEqual(props['humanType.followInsertionPoint'].default, DEFAULTS.followInsertionPoint);
  });

  test('every declared setting is read by readConfig', () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON?.name === 'human-type');
    const declared = Object.keys(
      ext?.packageJSON.contributes.configuration.properties as Record<string, unknown>
    ).map((k) => k.replace('humanType.', ''));
    const read = new Set([...Object.keys(DEFAULTS), 'delay']);
    // `delayMs` is the resolved form of the `delay` + `speed` settings.
    read.delete('delayMs');
    for (const key of declared) {
      assert.ok(read.has(key), `humanType.${key} is declared but never read`);
    }
  });

  test('readConfig returns the documented defaults on a clean profile', () => {
    const { config, diagnostics } = readConfig();
    assert.strictEqual(config.mode, 'smart');
    assert.strictEqual(config.speed, 'fast');
    assert.strictEqual(config.delayMs, SPEED_DELAYS.fast);
    assert.deepStrictEqual(diagnostics.warnings, []);
  });

  test('speed resolves to a delay independently of the mode', async () => {
    const settings = vscode.workspace.getConfiguration('humanType');
    try {
      for (const [speed, expectedDelay] of Object.entries(SPEED_DELAYS)) {
        await settings.update('speed', speed, vscode.ConfigurationTarget.Global);
        const { config } = readConfig();
        assert.strictEqual(config.speed, speed);
        assert.strictEqual(config.delayMs, expectedDelay, `${speed} resolved to the wrong delay`);
        // Granularity is untouched by speed - the whole point of separating them.
        assert.strictEqual(config.mode, DEFAULTS.mode);
      }

      await settings.update('speed', 'custom', vscode.ConfigurationTarget.Global);
      await settings.update('delay', 250, vscode.ConfigurationTarget.Global);
      assert.strictEqual(readConfig().config.delayMs, 250);
    } finally {
      await settings.update('speed', undefined, vscode.ConfigurationTarget.Global);
      await settings.update('delay', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('an invalid mode falls back to the default and reports a warning', async () => {
    const settings = vscode.workspace.getConfiguration('humanType');
    try {
      await settings.update('mode', 'nonsense', vscode.ConfigurationTarget.Global);
      const { config, diagnostics } = readConfig();
      assert.strictEqual(config.mode, DEFAULTS.mode);
      assert.strictEqual(diagnostics.warnings.length, 1);
      assert.match(diagnostics.warnings[0], /humanType\.mode/);
    } finally {
      await settings.update('mode', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('an out-of-range delay is clamped with a warning', async () => {
    const settings = vscode.workspace.getConfiguration('humanType');
    try {
      await settings.update('speed', 'custom', vscode.ConfigurationTarget.Global);
      await settings.update('delay', 99999, vscode.ConfigurationTarget.Global);
      const { config, diagnostics } = readConfig();
      assert.strictEqual(config.delayMs, 2000);
      assert.ok(diagnostics.warnings.some((w) => /humanType\.delay/.test(w)));
    } finally {
      await settings.update('speed', undefined, vscode.ConfigurationTarget.Global);
      await settings.update('delay', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('a per-language override is honoured', async () => {
    const settings = vscode.workspace.getConfiguration('humanType');
    try {
      await settings.update('mode', 'line', vscode.ConfigurationTarget.Global, true);
      const doc = await vscode.workspace.openTextDocument({ content: '', language: 'markdown' });
      assert.strictEqual(readConfig(doc).config.mode, 'line');
    } finally {
      await settings.update('mode', undefined, vscode.ConfigurationTarget.Global, true);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });
});
