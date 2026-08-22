/*!
 * Human Type - Granular, human-like text insertion for VS Code.
 * Copyright (c) 2026 Nishtha Sharma. All rights reserved.
 * Licensed under the terms in LICENSE. Redistribution is not permitted.
 */
/**
 * PHASE 3 - PROOF OF CONCEPT.
 *
 * This suite does not test Human Type's own code. It probes the *stable* VS Code
 * editing API to answer one question:
 *
 *   Does calling TextEditor.edit() repeatedly, with explicit undo-stop options,
 *   produce granular, per-chunk Ctrl+Z / Ctrl+Y behaviour?
 *
 * Every observation printed by this file is recorded in docs/UNDO-BEHAVIOR.md.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

type EditOptions = { undoStopBefore: boolean; undoStopAfter: boolean };

async function freshEditor(initial = ''): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({
    content: initial,
    language: 'plaintext'
  });
  const editor = await vscode.window.showTextDocument(doc, {
    preview: false,
    viewColumn: vscode.ViewColumn.One
  });
  editor.selection = new vscode.Selection(
    doc.positionAt(initial.length),
    doc.positionAt(initial.length)
  );
  return editor;
}

async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

/** Insert chunks sequentially at the caret using the given undo-stop options. */
async function insertChunks(
  editor: vscode.TextEditor,
  chunks: string[],
  options: EditOptions
): Promise<void> {
  let offset = editor.document.offsetAt(editor.selection.active);
  for (const chunk of chunks) {
    const pos = editor.document.positionAt(offset);
    const ok = await editor.edit((b) => b.insert(pos, chunk), options);
    assert.strictEqual(ok, true, 'edit() returned false for chunk ' + JSON.stringify(chunk));
    offset += chunk.length;
    const p = editor.document.positionAt(offset);
    editor.selection = new vscode.Selection(p, p);
  }
}

/** Run undo n times, capturing the document text after each step. */
async function undoTrace(doc: vscode.TextDocument, n: number): Promise<string[]> {
  const trace: string[] = [];
  for (let i = 0; i < n; i++) {
    await vscode.commands.executeCommand('undo');
    trace.push(doc.getText());
  }
  return trace;
}

async function redoTrace(doc: vscode.TextDocument, n: number): Promise<string[]> {
  const trace: string[] = [];
  for (let i = 0; i < n; i++) {
    await vscode.commands.executeCommand('redo');
    trace.push(doc.getText());
  }
  return trace;
}

function report(title: string, trace: string[]): void {
  // eslint-disable-next-line no-console
  console.log('\n  [POC] ' + title);
  trace.forEach((t, i) => {
    // eslint-disable-next-line no-console
    console.log('        step ' + (i + 1) + ': ' + JSON.stringify(t));
  });
}

suite('POC: VS Code undo-stop semantics', () => {
  teardown(async () => {
    await closeAll();
  });

  test('A. default options (before=true, after=true) - one undo step per edit() call', async () => {
    const editor = await freshEditor('');
    await insertChunks(editor, ['one', ' ', 'two', ' ', 'three'], {
      undoStopBefore: true,
      undoStopAfter: true
    });
    assert.strictEqual(editor.document.getText(), 'one two three');

    const u = await undoTrace(editor.document, 5);
    report('A / undo x5 (default options)', u);
    assert.deepStrictEqual(u, ['one two ', 'one two', 'one ', 'one', '']);

    const r = await redoTrace(editor.document, 5);
    report('A / redo x5 (default options)', r);
    assert.deepStrictEqual(r, ['one', 'one ', 'one two', 'one two ', 'one two three']);
  });

  test('B. before=true, after=false - same granularity', async () => {
    const editor = await freshEditor('');
    await insertChunks(editor, ['one', ' ', 'two', ' ', 'three'], {
      undoStopBefore: true,
      undoStopAfter: false
    });
    assert.strictEqual(editor.document.getText(), 'one two three');

    const u = await undoTrace(editor.document, 5);
    report('B / undo x5 (before=true, after=false)', u);
    assert.deepStrictEqual(u, ['one two ', 'one two', 'one ', 'one', '']);

    const r = await redoTrace(editor.document, 5);
    report('B / redo x5 (before=true, after=false)', r);
    assert.deepStrictEqual(r, ['one', 'one ', 'one two', 'one two ', 'one two three']);
  });

  test('C. before=false, after=false - everything collapses into ONE undo step', async () => {
    const editor = await freshEditor('');
    await insertChunks(editor, ['one', ' ', 'two', ' ', 'three'], {
      undoStopBefore: false,
      undoStopAfter: false
    });
    assert.strictEqual(editor.document.getText(), 'one two three');

    const u = await undoTrace(editor.document, 2);
    report('C / undo x2 (before=false, after=false)', u);
    assert.strictEqual(u[0], '', 'expected a single undo to wipe the whole insertion');
  });

  test('D. existing content is preserved by the extra undo stops', async () => {
    const editor = await freshEditor('PREFIX-');
    await insertChunks(editor, ['a', 'b', 'c'], {
      undoStopBefore: true,
      undoStopAfter: false
    });
    assert.strictEqual(editor.document.getText(), 'PREFIX-abc');

    const u = await undoTrace(editor.document, 3);
    report('D / undo x3 over pre-existing content', u);
    assert.deepStrictEqual(u, ['PREFIX-ab', 'PREFIX-a', 'PREFIX-']);
  });

  test('E. manual typing after an insertion undoes independently', async () => {
    const editor = await freshEditor('');
    await insertChunks(editor, ['one', ' ', 'two'], {
      undoStopBefore: true,
      undoStopAfter: false
    });
    // Simulate real user typing through the same code path VS Code uses.
    await vscode.commands.executeCommand('default:type', { text: 'X' });
    await vscode.commands.executeCommand('default:type', { text: 'Y' });
    assert.strictEqual(editor.document.getText(), 'one twoXY');

    const u = await undoTrace(editor.document, 4);
    report('E / typing after insertion, then undo x4', u);
    // OBSERVED: VS Code coalesces the manually typed run into ONE undo step, then
    // peels the extension's chunks off one at a time. The two histories interleave
    // correctly and neither destroys the other.
    assert.deepStrictEqual(u, ['one two', 'one ', 'one', '']);
  });

  test('F. two sequential insertions keep separate boundaries', async () => {
    const editor = await freshEditor('');
    await insertChunks(editor, ['aa', 'bb'], { undoStopBefore: true, undoStopAfter: false });
    await insertChunks(editor, ['cc', 'dd'], { undoStopBefore: true, undoStopAfter: false });
    assert.strictEqual(editor.document.getText(), 'aabbccdd');

    const u = await undoTrace(editor.document, 4);
    report('F / two insertions, undo x4', u);
    assert.deepStrictEqual(u, ['aabbcc', 'aabb', 'aa', '']);
  });

  test('G. replacing a selection in the first chunk is a single undo step', async () => {
    const editor = await freshEditor('REPLACE_ME tail');
    const sel = new vscode.Selection(
      editor.document.positionAt(0),
      editor.document.positionAt('REPLACE_ME'.length)
    );
    editor.selection = sel;
    await editor.edit((b) => b.replace(sel, 'aa'), {
      undoStopBefore: true,
      undoStopAfter: false
    });
    let offset = 2;
    for (const chunk of ['bb', 'cc']) {
      const pos = editor.document.positionAt(offset);
      await editor.edit((b) => b.insert(pos, chunk), {
        undoStopBefore: true,
        undoStopAfter: false
      });
      offset += chunk.length;
    }
    assert.strictEqual(editor.document.getText(), 'aabbcc tail');

    const u = await undoTrace(editor.document, 3);
    report('G / selection replacement, undo x3', u);
    assert.deepStrictEqual(u, ['aabb tail', 'aa tail', 'REPLACE_ME tail']);
  });

  /**
   * HAZARD (discovered by this POC - see docs/UNDO-BEHAVIOR.md finding #4).
   *
   * TextEditorEdit.insert() rewrites "\n" to the *document's* EOL sequence. On a
   * CRLF document a 1-character "\n" therefore grows the document by 2 characters.
   * An engine that advances its insertion offset by chunk.length will drift and
   * INTERLEAVE the remaining chunks into the wrong positions - silent corruption.
   *
   * This test proves the hazard is real so the regression can never come back.
   */
  test('H. HAZARD: raw LF chunks corrupt a CRLF document', async () => {
    const editor = await freshEditor('');
    const source = 'a\nbb\ncc\n';
    const chunks = source.match(/[\s\S]{1,2}/g) ?? [];
    await insertChunks(editor, chunks, { undoStopBefore: true, undoStopAfter: false });

    const actual = editor.document.getText();
    report('H / naive offset arithmetic on a CRLF document', [source, actual]);
    if (editor.document.eol === vscode.EndOfLine.CRLF) {
      assert.notStrictEqual(
        actual,
        source.replace(/\n/g, '\r\n'),
        'expected naive offset arithmetic to corrupt the text on a CRLF document'
      );
    }
  });

  test('I. FIX: normalising source EOL to the document EOL round-trips exactly', async () => {
    const editor = await freshEditor('');
    const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const source = 'def hello():\n    print("héllo 🌍 你好")\n\n    return True\n';
    const normalised = source.replace(/\r\n|\r|\n/g, eol);
    const chunks = normalised.match(/[\s\S]{1,3}/g) ?? [];
    await insertChunks(editor, chunks, { undoStopBefore: true, undoStopAfter: false });
    assert.strictEqual(editor.document.getText(), normalised);
  });

  test('J. FIX: per-code-point chunks with normalised EOL round-trip exactly', async () => {
    const editor = await freshEditor('');
    const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const source = 'const s = "héllo 🌍 你好";\n\ttab\n';
    const normalised = source.replace(/\r\n|\r|\n/g, eol);
    // Split by code point, but never between CR and LF.
    const chunks: string[] = [];
    for (const cp of Array.from(normalised)) {
      if (cp === '\n' && chunks[chunks.length - 1] === '\r') {
        chunks[chunks.length - 1] = '\r\n';
      } else {
        chunks.push(cp);
      }
    }
    await insertChunks(editor, chunks, { undoStopBefore: true, undoStopAfter: false });
    assert.strictEqual(editor.document.getText(), normalised);
  });

  test('K. undo stack survives 1000 chunk-sized steps', async () => {
    const editor = await freshEditor('');
    const chunks = Array.from({ length: 1000 }, (_, i) => String.fromCharCode(97 + (i % 26)));
    await insertChunks(editor, chunks, { undoStopBefore: true, undoStopAfter: false });
    assert.strictEqual(editor.document.getText().length, 1000);

    const u = await undoTrace(editor.document, 1000);
    report('K / document after 1000 undos', [u[u.length - 1]]);
    assert.strictEqual(
      u[u.length - 1],
      '',
      'VS Code dropped undo history before all 1000 chunk steps could be undone'
    );
  });
});
