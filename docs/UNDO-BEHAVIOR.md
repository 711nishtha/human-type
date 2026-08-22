# Observed VS Code undo/redo behaviour

**Status: VERIFIED.** The undo granularity Human Type needs is achievable using only
stable, public VS Code Extension API. No proposed API, no custom undo stack, no
interception of `Ctrl+Z`.

All findings below are produced by an automated suite that drives a real VS Code
instance. Re-run it at any time with:

```
npm run test:integration
```

Source: [`test/integration/poc.undo.test.ts`](../test/integration/poc.undo.test.ts).

| Environment | Value |
| --- | --- |
| VS Code (test host) | 1.134.0 |
| Platform | Windows 11 x64 |
| API used | `TextEditor.edit(callback, { undoStopBefore, undoStopAfter })` |
| Result | 11 / 11 passing |

---

## Finding 1 — one `edit()` call with an undo stop == one `Ctrl+Z` step

Inserting `one`, ` `, `two`, ` `, `three` as five separate `editor.edit()` calls with
`undoStopBefore: true` produces exactly five undo steps.

Observed `undo` trace:

```
step 1: "one two "
step 2: "one two"
step 3: "one "
step 4: "one"
step 5: ""
```

Observed `redo` trace (from the fully-undone state):

```
step 1: "one"
step 2: "one "
step 3: "one two"
step 4: "one two "
step 5: "one two three"
```

Redo is a perfect mirror of undo. This is the core behaviour the product depends on.

## Finding 2 — `undoStopBefore` is what matters; `undoStopAfter` is not needed

| `undoStopBefore` | `undoStopAfter` | Result |
| --- | --- | --- |
| `true` | `true` | 5 granular steps (VS Code's default options) |
| `true` | `false` | 5 granular steps — **identical**, and avoids a redundant trailing stop |
| `false` | `false` | **1** step — the entire insertion is undone at once |

Human Type uses `{ undoStopBefore: true, undoStopAfter: false }` for every chunk, and
`{ undoStopBefore: true, undoStopAfter: true }` for the *final* chunk only, so that
whatever the user does next starts its own undo element.

Setting both to `false` is exactly the "one giant edit" behaviour the extension exists
to avoid, which confirms the flags are the real mechanism rather than a coincidence of
timing.

## Finding 3 — timing does not affect grouping

The POC inserts chunks back-to-back with no artificial delay and still gets one undo
step per chunk. Undo granularity is a function of the undo-stop flags, **not** of the
delay between edits. This is why `humanType.mode` (granularity) and `humanType.speed`
(delay) are independent settings.

## Finding 4 — HAZARD: `insert()` rewrites `\n` to the document's EOL

This is the most important implementation detail discovered, and it is not obvious from
the API docs.

`TextEditorEdit.insert()` normalises the inserted text's line endings to the *document's*
EOL sequence. On a CRLF document, inserting the 1-character string `"\n"` grows the
document by **2** characters.

An engine that advances its insertion offset by `chunk.length` therefore drifts, and the
remaining chunks are interleaved into the wrong positions — silent content corruption.

Observed, inserting `"a\nbb\ncc\n"` in 2-character chunks into a CRLF document with naive
offset arithmetic:

```
source: "a\nbb\ncc\n"
result: "abb\r\ncc\r\n\r\n"      <-- WRONG: a line break has moved
```

**Mitigation (implemented in `src/insertionEngine.ts`):** the source text is normalised to
the target document's EOL *before* chunking. After that, `chunk.length` matches the actual
document growth exactly, and the engine additionally re-reads the document after every
edit to assert the inserted range matches the chunk. Test `H` in the POC suite locks the
hazard in place as a permanent regression guard; tests `I` and `J` prove the fix.

Consequence for users: line endings of inserted text follow the destination file, exactly
as VS Code's own paste does. This is the only transformation Human Type applies to your
content, and it is documented in the README.

## Finding 5 — extension edits and real typing coexist

Insert `one`, ` `, `two` via the extension, then type `XY` on the keyboard.

Observed `undo` trace:

```
step 1: "one two"     <-- VS Code coalesces the typed run into one step
step 2: "one "
step 3: "one"
step 4: ""
```

The manually typed characters are coalesced by VS Code's own typing heuristics into a
single undo step, and the extension's chunk steps are then peeled off one at a time
beneath it. Neither history destroys the other. Human Type does not interfere with, reset,
or replace VS Code's undo stack.

## Finding 6 — existing undo history is preserved

Inserting into a document that already has content leaves the pre-existing history intact.
Undoing past the extension's own steps continues into whatever came before, normally.

## Finding 7 — replacing a selection is one step

When the editor has a selection, the first chunk is applied as a `replace()` of that
selection. Undoing back through the insertion restores the original selected text in a
single step, matching normal paste semantics.

## Finding 8 — large step counts are safe (with a caveat)

1000 sequential chunk steps were all individually undoable; the document returned exactly
to empty after 1000 `undo` commands.

**Caveat:** VS Code's undo stack is bounded (`UndoRedoService` evicts the oldest elements
past an internal memory budget). A very large character-mode insertion can therefore push
older, unrelated history out of the stack. `humanType.maxChunks` (default `5000`) caps the
number of undo steps a single insertion may create; beyond that, adjacent chunks are merged
so the count fits. See the README's Limitations section.

---

## Conclusion

The product is technically sound as specified. Human Type integrates with VS Code's native
undo/redo system rather than emulating one.
