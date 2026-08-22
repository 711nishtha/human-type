/**
 * Integration tests for the insertion engine, run inside a real VS Code instance.
 *
 * Covers the full scenario matrix from the project brief: empty and large files,
 * insertion at the start / middle / end, selection replacement, multi-line content,
 * indentation, Unicode, undo, redo, interleaving with real typing, and repeated
 * insertions - plus cancellation and the error paths.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { DEFAULTS } from '../../src/config';
import { InsertionEngine, normaliseEol } from '../../src/insertionEngine';
import { HumanTypeConfig, InsertionProgress } from '../../src/types';

function cfg(overrides: Partial<HumanTypeConfig> = {}): HumanTypeConfig {
  return { ...DEFAULTS, speed: 'instant', delayMs: 0, showProgress: false, ...overrides };
}

async function openDoc(content: string, language = 'plaintext'): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  return vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
}

function caretAt(editor: vscode.TextEditor, offset: number): void {
  const p = editor.document.positionAt(offset);
  editor.selection = new vscode.Selection(p, p);
}

function selectRange(editor: vscode.TextEditor, start: number, end: number): void {
  editor.selection = new vscode.Selection(
    editor.document.positionAt(start),
    editor.document.positionAt(end)
  );
}

/** What the document should contain once `text` has been inserted into it. */
function expected(editor: vscode.TextEditor, before: string, at: number, text: string): string {
  const t = normaliseEol(text, editor.document.eol);
  return before.slice(0, at) + t + before.slice(at);
}

async function undoTimes(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await vscode.commands.executeCommand('undo');
  }
}

async function redoTimes(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await vscode.commands.executeCommand('redo');
  }
}

const HUNDRED_LINES = Array.from({ length: 120 }, (_, i) => `line ${i + 1} of the existing file`).join('\n') + '\n';

const CODE_SAMPLE = [
  '#include <iostream>',
  '',
  'int main() {',
  '    std::cout << "Hello";',
  '    return 0;',
  '}',
  ''
].join('\n');

suite('InsertionEngine', () => {
  let engine: InsertionEngine;

  setup(() => {
    engine = new InsertionEngine();
  });

  teardown(async () => {
    engine.dispose();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  /* ---------------------------------------------------------------------- */
  /* Scenario 1-9: placement and content fidelity                            */
  /* ---------------------------------------------------------------------- */

  test('1. inserts into an empty file', async () => {
    const editor = await openDoc('');
    const outcome = await engine.insert({ editor, text: CODE_SAMPLE, config: cfg() });
    assert.strictEqual(outcome.status, 'completed');
    assert.strictEqual(editor.document.getText(), normaliseEol(CODE_SAMPLE, editor.document.eol));
  });

  test('2. inserts into a file with 120 existing lines', async () => {
    const editor = await openDoc(HUNDRED_LINES);
    const at = HUNDRED_LINES.indexOf('line 60');
    caretAt(editor, at);
    const outcome = await engine.insert({ editor, text: 'INSERTED\n', config: cfg() });
    assert.strictEqual(outcome.status, 'completed');
    assert.strictEqual(editor.document.getText(), expected(editor, HUNDRED_LINES, at, 'INSERTED\n'));
  });

  test('3. inserts at the very beginning', async () => {
    const before = 'existing content\n';
    const editor = await openDoc(before);
    caretAt(editor, 0);
    await engine.insert({ editor, text: 'HEAD ', config: cfg() });
    assert.strictEqual(editor.document.getText(), 'HEAD ' + before);
  });

  test('4. inserts in the middle of a line', async () => {
    const before = 'abcdef';
    const editor = await openDoc(before);
    caretAt(editor, 3);
    await engine.insert({ editor, text: '-MID-', config: cfg() });
    assert.strictEqual(editor.document.getText(), 'abc-MID-def');
  });

  test('5. inserts at the very end', async () => {
    const before = 'existing content';
    const editor = await openDoc(before);
    caretAt(editor, before.length);
    await engine.insert({ editor, text: ' TAIL', config: cfg() });
    assert.strictEqual(editor.document.getText(), before + ' TAIL');
  });

  test('6. replaces a selection (default paste semantics)', async () => {
    const editor = await openDoc('keep REPLACE keep');
    selectRange(editor, 5, 12);
    const outcome = await engine.insert({ editor, text: 'NEW-TEXT', config: cfg() });
    assert.strictEqual(outcome.status, 'completed');
    assert.strictEqual(editor.document.getText(), 'keep NEW-TEXT keep');
  });

  test('6b. inserts after the selection when replaceSelection is off', async () => {
    const editor = await openDoc('keep KEEPME keep');
    selectRange(editor, 5, 11);
    await engine.insert({ editor, text: '+ADDED', config: cfg({ replaceSelection: false }) });
    assert.strictEqual(editor.document.getText(), 'keep KEEPME+ADDED keep');
  });

  test('7. multi-line insertion keeps every line', async () => {
    const editor = await openDoc('');
    await engine.insert({ editor, text: CODE_SAMPLE, config: cfg({ mode: 'line' }) });
    assert.strictEqual(editor.document.lineCount, CODE_SAMPLE.split('\n').length);
  });

  test('8. indentation is preserved exactly, spaces and tabs', async () => {
    const src = 'def f():\n    if x:\n        return 1\n\tmixed_tab\n';
    const editor = await openDoc('', 'python');
    await engine.insert({ editor, text: src, config: cfg({ mode: 'smart' }) });
    assert.strictEqual(editor.document.getText(), normaliseEol(src, editor.document.eol));
  });

  test('9. Unicode survives every mode', async () => {
    const src = 'const s = "héllo 你好 🌍 👩‍💻 café";\n';
    for (const mode of ['character', 'word', 'line', 'smart'] as const) {
      const editor = await openDoc('', 'typescript');
      const outcome = await engine.insert({ editor, text: src, config: cfg({ mode }) });
      assert.strictEqual(outcome.status, 'completed', `${mode}: ${JSON.stringify(outcome)}`);
      assert.strictEqual(
        editor.document.getText(),
        normaliseEol(src, editor.document.eol),
        `${mode} altered Unicode content`
      );
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  test('9b. every mode round-trips a realistic code sample byte-for-byte', async () => {
    for (const mode of ['character', 'word', 'line', 'smart'] as const) {
      const editor = await openDoc('', 'cpp');
      await engine.insert({ editor, text: CODE_SAMPLE, config: cfg({ mode }) });
      assert.strictEqual(
        editor.document.getText(),
        normaliseEol(CODE_SAMPLE, editor.document.eol),
        `${mode} altered the sample`
      );
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  /* ---------------------------------------------------------------------- */
  /* Scenario 10: large content                                              */
  /* ---------------------------------------------------------------------- */

  // The brief asks for 1 KB / 10 KB / 100 KB / 500 KB. These numbers are what the
  // README's Performance table reports, so regressions show up here first.
  for (const kb of [1, 10, 100, 500]) {
    test(`10. inserts ${kb} KB unaltered, within the chunk cap`, async function () {
      this.timeout(300000);
      const unit = 'function f(a, b) {\n  return a + b;\n}\n';
      const src = unit.repeat(Math.ceil((kb * 1024) / unit.length)).slice(0, kb * 1024);
      const editor = await openDoc('', 'javascript');

      const started = Date.now();
      const outcome = await engine.insert({ editor, text: src, config: cfg({ maxChunks: 300 }) });
      const elapsed = Date.now() - started;

      assert.strictEqual(outcome.status, 'completed');
      assert.ok(outcome.chunks <= 300, `${outcome.chunks} chunks exceeded the cap`);
      assert.strictEqual(
        editor.document.getText(),
        normaliseEol(src, editor.document.eol),
        `${kb} KB was altered during insertion`
      );
      const rate = Math.round((outcome.chunks / Math.max(elapsed, 1)) * 1000);
      // eslint-disable-next-line no-console
      console.log(`        ${kb} KB: ${outcome.chunks} chunks in ${elapsed} ms (~${rate} chunks/s)`);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Scenario 11-12: undo and redo                                           */
  /* ---------------------------------------------------------------------- */

  test('11. one undo per chunk, in reverse order', async () => {
    const editor = await openDoc('');
    const outcome = await engine.insert({ editor, text: 'AAA BBB CCC', config: cfg({ mode: 'word' }) });
    assert.strictEqual(outcome.status, 'completed');
    assert.strictEqual(outcome.chunks, 5, 'expected AAA / space / BBB / space / CCC');

    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await vscode.commands.executeCommand('undo');
      seen.push(editor.document.getText());
    }
    assert.deepStrictEqual(seen, ['AAA BBB ', 'AAA BBB', 'AAA ', 'AAA', '']);
  });

  test('12. redo restores the chunks one at a time', async () => {
    const editor = await openDoc('');
    await engine.insert({ editor, text: 'AAA BBB CCC', config: cfg({ mode: 'word' }) });
    await undoTimes(5);
    assert.strictEqual(editor.document.getText(), '');

    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await vscode.commands.executeCommand('redo');
      seen.push(editor.document.getText());
    }
    assert.deepStrictEqual(seen, ['AAA', 'AAA ', 'AAA BBB', 'AAA BBB ', 'AAA BBB CCC']);
  });

  test('12b. a partial undo followed by redo returns to the full text', async () => {
    const editor = await openDoc('');
    await engine.insert({ editor, text: 'AAA BBB CCC', config: cfg({ mode: 'word' }) });
    await undoTimes(2);
    assert.strictEqual(editor.document.getText(), 'AAA BBB');
    await redoTimes(2);
    assert.strictEqual(editor.document.getText(), 'AAA BBB CCC');
  });

  test('12c. undo restores the original text when a selection was replaced', async () => {
    const before = 'keep ORIGINAL keep';
    const editor = await openDoc(before);
    selectRange(editor, 5, 13);
    const outcome = await engine.insert({ editor, text: 'AAA BBB', config: cfg({ mode: 'word' }) });
    assert.strictEqual(editor.document.getText(), 'keep AAA BBB keep');
    await undoTimes(outcome.chunks);
    assert.strictEqual(editor.document.getText(), before);
  });

  test('12d. character mode gives one undo step per character', async () => {
    const editor = await openDoc('');
    const outcome = await engine.insert({ editor, text: 'hello', config: cfg({ mode: 'character' }) });
    assert.strictEqual(outcome.chunks, 5);
    await undoTimes(1);
    assert.strictEqual(editor.document.getText(), 'hell');
    await undoTimes(4);
    assert.strictEqual(editor.document.getText(), '');
  });

  test('12e. line mode gives one undo step per line', async () => {
    const src = 'one\ntwo\nthree\n';
    const editor = await openDoc('');
    const outcome = await engine.insert({ editor, text: src, config: cfg({ mode: 'line' }) });
    assert.strictEqual(outcome.chunks, 3);
    await undoTimes(1);
    assert.strictEqual(editor.document.getText(), normaliseEol('one\ntwo\n', editor.document.eol));
  });

  /* ---------------------------------------------------------------------- */
  /* Scenario 13-15: coexistence with real editing                           */
  /* ---------------------------------------------------------------------- */

  test('13. undo after manual typing removes the typed text first', async () => {
    const editor = await openDoc('');
    await engine.insert({ editor, text: 'AAA BBB', config: cfg({ mode: 'word' }) });
    await vscode.commands.executeCommand('default:type', { text: 'Z' });
    assert.strictEqual(editor.document.getText(), 'AAA BBBZ');

    await undoTimes(1);
    assert.strictEqual(editor.document.getText(), 'AAA BBB', 'the typed character should go first');
    await undoTimes(1);
    assert.strictEqual(editor.document.getText(), 'AAA ');
  });

  test('14. typing after an insertion is not merged into the last chunk', async () => {
    const editor = await openDoc('');
    await engine.insert({ editor, text: 'AAA', config: cfg({ mode: 'word' }) });
    await vscode.commands.executeCommand('default:type', { text: 'x' });
    await undoTimes(1);
    assert.strictEqual(
      editor.document.getText(),
      'AAA',
      'the undo stop after the final chunk kept the typed character separate'
    );
  });

  test('15. sequential insertions keep independent undo boundaries', async () => {
    const editor = await openDoc('');
    const first = await engine.insert({ editor, text: 'AAA BBB', config: cfg({ mode: 'word' }) });
    const second = await engine.insert({ editor, text: ' CCC', config: cfg({ mode: 'word' }) });
    assert.strictEqual(editor.document.getText(), 'AAA BBB CCC');

    await undoTimes(second.chunks);
    assert.strictEqual(editor.document.getText(), 'AAA BBB');
    await undoTimes(first.chunks);
    assert.strictEqual(editor.document.getText(), '');
  });

  test('15b. three insertions in different modes all round-trip', async () => {
    const editor = await openDoc('');
    await engine.insert({ editor, text: 'a1 ', config: cfg({ mode: 'character' }) });
    await engine.insert({ editor, text: 'b2 ', config: cfg({ mode: 'word' }) });
    await engine.insert({ editor, text: 'c3', config: cfg({ mode: 'smart' }) });
    assert.strictEqual(editor.document.getText(), 'a1 b2 c3');
  });

  /* ---------------------------------------------------------------------- */
  /* Cancellation                                                            */
  /* ---------------------------------------------------------------------- */

  test('cancellation stops future chunks and keeps what was already inserted', async () => {
    const editor = await openDoc('');
    const src = 'one two three four five six seven eight nine ten';
    const pending = engine.insert({ editor, text: src, config: cfg({ mode: 'word', delayMs: 30 }) });

    await new Promise((r) => setTimeout(r, 120));
    engine.cancel();
    const outcome = await pending;

    assert.strictEqual(outcome.status, 'cancelled');
    assert.ok(outcome.chunks > 0, 'expected some chunks to have landed');
    assert.ok(outcome.chunks < 19, 'expected the insertion to stop early');

    const text = editor.document.getText();
    assert.ok(text.length > 0, 'cancellation must not delete what was inserted');
    assert.ok(src.startsWith(text), `partial text "${text}" is not a prefix of the source`);
  });

  test('cancelled partial content is still undoable one chunk at a time', async () => {
    const editor = await openDoc('');
    const pending = engine.insert({
      editor,
      text: 'alpha beta gamma delta epsilon',
      config: cfg({ mode: 'word', delayMs: 30 })
    });
    await new Promise((r) => setTimeout(r, 150));
    engine.cancel();
    const outcome = await pending;

    await undoTimes(outcome.chunks);
    assert.strictEqual(editor.document.getText(), '');
  });

  test('cancelling when nothing is running is harmless', () => {
    assert.doesNotThrow(() => engine.cancel());
    assert.strictEqual(engine.isRunning(), false);
  });

  test('isRunning reflects the engine state', async () => {
    const editor = await openDoc('');
    assert.strictEqual(engine.isRunning(), false);
    const pending = engine.insert({ editor, text: 'a b c d e', config: cfg({ delayMs: 20 }) });
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(engine.isRunning(), true);
    engine.cancel();
    await pending;
    assert.strictEqual(engine.isRunning(), false);
  });

  test('a second insertion is refused while one is running', async () => {
    const editor = await openDoc('');
    const pending = engine.insert({ editor, text: 'a b c d e', config: cfg({ delayMs: 25 }) });
    await new Promise((r) => setTimeout(r, 30));
    const refused = await engine.insert({ editor, text: 'x', config: cfg() });
    assert.strictEqual(refused.status, 'failed');
    assert.match(refused.reason, /already running/);
    engine.cancel();
    await pending;
  });

  /* ---------------------------------------------------------------------- */
  /* Progress, EOL and edge cases                                            */
  /* ---------------------------------------------------------------------- */

  test('progress is reported monotonically and finishes at 100%', async () => {
    const editor = await openDoc('');
    const seen: InsertionProgress[] = [];
    const src = 'one two three four five';
    await engine.insert({
      editor,
      text: src,
      config: cfg({ mode: 'word' }),
      onProgress: (p) => seen.push(p)
    });

    assert.ok(seen.length > 0);
    for (let i = 1; i < seen.length; i++) {
      assert.ok(seen[i].chunksDone > seen[i - 1].chunksDone, 'chunk progress went backwards');
      assert.ok(seen[i].charactersDone >= seen[i - 1].charactersDone);
    }
    const last = seen[seen.length - 1];
    assert.strictEqual(last.chunksDone, last.chunksTotal);
    assert.strictEqual(last.charactersDone, last.charactersTotal);
    assert.strictEqual(last.charactersTotal, src.length);
  });

  test('mixed line endings are normalised to the document EOL', async () => {
    const editor = await openDoc('');
    const src = 'a\r\nb\rc\nd';
    await engine.insert({ editor, text: src, config: cfg({ mode: 'line' }) });
    const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    assert.strictEqual(editor.document.getText(), `a${eol}b${eol}c${eol}d`);
    assert.strictEqual(editor.document.lineCount, 4);
  });

  test('inserting empty text is a no-op that reports success', async () => {
    const editor = await openDoc('unchanged');
    const outcome = await engine.insert({ editor, text: '', config: cfg() });
    assert.deepStrictEqual(outcome, { status: 'completed', chunks: 0, characters: 0 });
    assert.strictEqual(editor.document.getText(), 'unchanged');
  });

  test('a single character inserts correctly', async () => {
    const editor = await openDoc('');
    const outcome = await engine.insert({ editor, text: 'x', config: cfg() });
    assert.strictEqual(outcome.chunks, 1);
    assert.strictEqual(editor.document.getText(), 'x');
  });

  test('text that is only whitespace is preserved', async () => {
    const editor = await openDoc('');
    const src = '   \n\t\n  ';
    await engine.insert({ editor, text: src, config: cfg({ mode: 'smart' }) });
    assert.strictEqual(editor.document.getText(), normaliseEol(src, editor.document.eol));
  });

  test('the caret ends at the end of the inserted text', async () => {
    const editor = await openDoc('tail');
    caretAt(editor, 0);
    await engine.insert({ editor, text: 'head-', config: cfg() });
    assert.strictEqual(editor.document.offsetAt(editor.selection.active), 5);
  });

  test('the caret advances with inserted text even when following is disabled', async () => {
    // Documents a VS Code behaviour rather than one of ours: text inserted AT the caret
    // pushes the caret along, because that is how the editor's own edit operations
    // compute the resulting selection. `followInsertionPoint: false` therefore only
    // suppresses the explicit re-sync and the scrolling, never the caret movement.
    const editor = await openDoc('tail');
    caretAt(editor, 0);
    await engine.insert({ editor, text: 'head-', config: cfg({ followInsertionPoint: false }) });
    assert.strictEqual(editor.document.getText(), 'head-tail');
    assert.strictEqual(editor.document.offsetAt(editor.selection.active), 5);
  });

  test('planChunks does not touch the document', async () => {
    const editor = await openDoc('untouched');
    const chunks = engine.planChunks('a b c', 'plaintext', cfg({ mode: 'word' }));
    assert.strictEqual(chunks.length, 5);
    assert.strictEqual(editor.document.getText(), 'untouched');
  });

  test('language-aware smart mode keeps a Python comment whole', async () => {
    const editor = await openDoc('', 'python');
    const src = 'x = 1  # a trailing note\n';
    const chunks = engine.planChunks(src, 'python', cfg({ mode: 'smart' }));
    assert.ok(chunks.some((c) => c.text === '# a trailing note'), chunks.map((c) => c.text).join('|'));
    await engine.insert({ editor, text: src, config: cfg({ mode: 'smart' }) });
    assert.strictEqual(editor.document.getText(), normaliseEol(src, editor.document.eol));
  });
});
