# Manual test checklist

The automated suites cover correctness — 203 unit tests and 67 integration tests against a
real VS Code instance. This checklist covers what automation cannot judge: how the
insertion *feels*, whether the UI flickers, and whether the keyboard behaves under a real
human's hands.

Run through it before tagging a release.

**Setup:** press <kbd>F5</kbd> in the project to open the Extension Development Host, then
work inside that window. Fixture files live in [`../test/fixtures/`](../test/fixtures/).

---

## 1. The five-second check

| # | Step | Expected |
| --- | --- | --- |
| 1.1 | Open a new empty file. Run **Human Type: Test Undo Behavior**. | `one two three` appears, visibly typed rather than pasted. |
| 1.2 | Press <kbd>Ctrl</kbd>+<kbd>Z</kbd> five times, slowly. | `one two ` → `one two` → `one ` → `one` → empty. One chunk per press. |
| 1.3 | Press <kbd>Ctrl</kbd>+<kbd>Y</kbd> five times. | The text comes back one chunk per press, ending at `one two three`. |

**If 1.2 fails, stop and investigate before shipping anything.** This is the product's
core promise.

---

## 2. Modes

Copy `test/fixtures/sample.py` to the clipboard for each of these.

| # | Setting | Step | Expected |
| --- | --- | --- | --- |
| 2.1 | `mode: character` | Insert Clipboard into an empty `.py` file. | One character at a time. Undo removes one character per press. |
| 2.2 | `mode: word` | Same. | Words and punctuation appear as units. |
| 2.3 | `mode: line` | Same. | Whole lines appear at once. Undo removes one line per press. |
| 2.4 | `mode: smart` | Same. | `def`, `hello():`, indentation, the whole `"Hello"` string each arrive as units. Comments never appear half-written. |
| 2.5 | `mode: smart` | Compare the result of all four to the clipboard content. | Identical every time. |

---

## 3. Speed is independent of granularity

| # | Setting | Expected |
| --- | --- | --- |
| 3.1 | `mode: word`, `speed: instant` | Appears immediately, but undo still steps word by word. |
| 3.2 | `mode: word`, `speed: slow` | Visibly paced; undo granularity identical to 3.1. |
| 3.3 | `mode: character`, `speed: instant` | Fast, but each character is still separately undoable. |

If granularity ever changes with speed, that is a serious regression — the two are
architecturally separate.

---

## 4. Placement

| # | Step | Expected |
| --- | --- | --- |
| 4.1 | Insert into an empty file. | Content appears at the top. |
| 4.2 | Open `test/fixtures/large.txt`, put the cursor mid-file, insert. | Inserted at the cursor; surrounding lines untouched. |
| 4.3 | Cursor at the very first character, insert. | Prepended cleanly. |
| 4.4 | Cursor at end of file, insert. | Appended cleanly. |
| 4.5 | Select a word, insert. | The selection is replaced (default paste semantics). |
| 4.6 | Undo 4.5 completely. | The originally selected text returns intact. |
| 4.7 | Set `replaceSelection: false`, select a word, insert. | Content appears *after* the selection; the selection survives. |

---

## 5. Indentation and Unicode

| # | Step | Expected |
| --- | --- | --- |
| 5.1 | Insert `test/fixtures/sample.py` into a `.py` file. | Indentation is exactly as in the source. **No auto-indent doubling.** |
| 5.2 | Insert `test/fixtures/sample.go` into a `.go` file. | Tab indentation preserved as tabs. |
| 5.3 | Insert `test/fixtures/unicode.txt`. | Emoji, CJK and accents render correctly; no replacement characters, no half-emoji flicker mid-insertion. |
| 5.4 | Turn on **View → Render Whitespace**, repeat 5.1. | Trailing whitespace matches the source exactly. |

Item 5.1 matters: programmatic edits do not trigger auto-indent, but bracket-completion
extensions can interfere. If indentation doubles, some other extension is reacting to the
edits — note which one.

---

## 6. Coexistence with real typing

| # | Step | Expected |
| --- | --- | --- |
| 6.1 | Insert `AAA BBB` in word mode. Type `hello` by hand. Press <kbd>Ctrl</kbd>+<kbd>Z</kbd>. | The typed `hello` is removed first (VS Code coalesces typed runs). |
| 6.2 | Keep pressing <kbd>Ctrl</kbd>+<kbd>Z</kbd>. | The inserted chunks come off one at a time. |
| 6.3 | Type some text, then insert, then <kbd>Ctrl</kbd>+<kbd>Z</kbd> past the insertion. | Your earlier typing is still there. Human Type never clears existing history. |
| 6.4 | Insert twice in a row. Undo back through both. | Each insertion's chunks undo separately, newest first. |

---

## 7. Cancellation

| # | Step | Expected |
| --- | --- | --- |
| 7.1 | Set `speed: slow`. Insert `test/fixtures/large.txt`. Press <kbd>Esc</kbd> midway. | Insertion stops immediately. |
| 7.2 | Look at the document. | The text inserted so far is **still there** — nothing is reverted. |
| 7.3 | Read the notification. | It says how many chunks were applied and that Ctrl+Z steps back through them. |
| 7.4 | Press <kbd>Ctrl</kbd>+<kbd>Z</kbd> repeatedly. | The partial insertion comes off one chunk at a time. |
| 7.5 | Repeat 7.1 but click the status-bar item instead of pressing Escape. | Same result. |
| 7.6 | Repeat 7.1 but run **Human Type: Cancel Current Insertion**. | Same result. |
| 7.7 | With no insertion running, press <kbd>Esc</kbd> in the editor. | Normal VS Code behaviour. The keybinding is inert. |
| 7.8 | With no insertion running, run the Cancel command. | An informational message, no error. |

Item 7.7 is important: the Escape binding is scoped to `humanType.inserting`, so it must
never interfere with dismissing suggestions, exiting multi-cursor mode, or anything else.

---

## 8. Progress UI

| # | Step | Expected |
| --- | --- | --- |
| 8.1 | Insert a short string at `speed: fast`. | **No status-bar item appears at all** — it must not flash. |
| 8.2 | Insert `test/fixtures/large.txt` at `speed: normal`. | The item appears after a moment and shows a rising percentage. |
| 8.3 | Watch the percentage. | It updates smoothly, not frantically, and reaches 100%. |
| 8.4 | Hover the item. | The tooltip shows chunk and character counts and mentions cancelling. |
| 8.5 | Set `showProgress: false`, repeat 8.2. | No status-bar item at any point. |
| 8.6 | After any insertion completes. | The item disappears; a brief summary shows in the status bar. |

---

## 9. Errors and edge cases

| # | Step | Expected |
| --- | --- | --- |
| 9.1 | Close all editors, run Insert Clipboard. | A clear warning. No error dialog, no stack trace. |
| 9.2 | Copy an image, run Insert Clipboard. | A warning that the clipboard holds no text. |
| 9.3 | Run Insert Selection with nothing selected. | A warning explaining what the command does. |
| 9.4 | Run Insert Text and press <kbd>Esc</kbd>. | Nothing happens. No error. |
| 9.5 | Run Insert Text, enter `a\nb\tc`. | Inserts a real newline and a real tab. |
| 9.6 | Run Insert Text, enter `C:\Users\dev`. | Inserted literally — the backslashes survive. |
| 9.7 | Place two cursors (<kbd>Alt</kbd>+click), run Insert Clipboard. | A warning about multi-cursor with a choice. Choosing *Use primary cursor* inserts at one cursor only. |
| 9.8 | Same, but choose *Cancel*. | Nothing is inserted. |
| 9.9 | Set `humanType.mode` to `"nonsense"` in settings.json, insert. | A warning naming the setting; insertion proceeds in `smart` mode. |
| 9.10 | Open a read-only file (e.g. from a diff view), insert. | A clear error. No partial garbage. |
| 9.11 | Copy 200 KB, run Insert Clipboard. | A confirmation dialog naming the size. Cancelling inserts nothing. |
| 9.12 | Start an insertion, then run Insert Clipboard again during it. | A warning that an insertion is already running. |
| 9.13 | Start a slow insertion, then close the tab mid-way. | An error message, not a crash. |

---

## 10. Language awareness

Insert each fixture into a file of the matching language, in `smart` mode, and confirm no
comment or string is ever torn mid-token as it appears.

| # | Fixture | Watch for |
| --- | --- | --- |
| 10.1 | `sample.py` | `#` comments and `"""docstrings"""` stay whole. |
| 10.2 | `sample.c` | `/* block */` and `//` comments stay whole; `#include` is not treated as a comment. |
| 10.3 | `sample.ts` | Template literals and `=>` stay whole. |
| 10.4 | `sample.sql` | `--` comments stay whole; `'O''Brien'` is not split. |
| 10.5 | `sample.md` | Fenced code blocks and `` `inline code` `` stay whole. |
| 10.6 | Any file, language set to something exotic | Still works; falls back to generic rules. |

---

## 11. Performance sanity

| # | Step | Expected |
| --- | --- | --- |
| 11.1 | Insert 100 KB in `smart` mode at `speed: instant`. | Completes in a few seconds. VS Code stays responsive — you can scroll and click throughout. |
| 11.2 | During 11.1, try to cancel. | Cancels promptly. |
| 11.3 | Insert 500 KB. | Confirmation prompt first; then completes without freezing the window. |
| 11.4 | Check CPU during a slow insertion. | No pegged core. |

---

## 12. Settings round-trip

| # | Step | Expected |
| --- | --- | --- |
| 12.1 | Run **Human Type: Open Settings**. | The Settings UI opens filtered to Human Type. |
| 12.2 | Change every setting through the UI. | Each takes effect on the next insertion, with no reload. |
| 12.3 | Add `"[markdown]": { "humanType.mode": "line" }`. | Markdown files insert line by line; other languages keep the global mode. |

---

## Sign-off

| Item | Result |
| --- | --- |
| VS Code version tested | |
| Operating system | |
| Section 1 (core promise) | |
| Sections 2–5 | |
| Sections 6–9 | |
| Sections 10–12 | |
| Tester / date | |
