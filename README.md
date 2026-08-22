# Human Type

**AI writes the code. You control how it enters your editor.**

Granular, human-like text insertion for Visual Studio Code.

---

## The problem

When code arrives in your editor as one big edit — a paste, a generated block, an
agent's output — VS Code records it as **one** undo step. Press <kbd>Ctrl</kbd>+<kbd>Z</kbd>
once and the whole thing vanishes. There is no way to walk back through it, keep the first
half, or undo just the last statement.

That is fine for three words. It is painful for a forty-line function you wanted to
review as it landed.

## The solution

Human Type inserts your text through a controlled sequence of small editor edits, each
with its own undo boundary. The content that ends up in your file is identical; what
changes is the *shape of the undo history*.

```
Paste          →  [ ████████████████████████ ]   one Ctrl+Z removes everything
Human Type     →  [ ██ ][ █ ][ ███ ][ █ ][ ██ ]  one Ctrl+Z removes one chunk
```

It uses VS Code's **native** undo stack. There is no custom undo system, no
<kbd>Ctrl</kbd>+<kbd>Z</kbd> interception, and no proposed API.

> ### What this is not
>
> Human Type is an editing and UX tool. It is **not** designed to evade AI-detection,
> plagiarism, or authorship-detection systems, and it deliberately implements nothing
> aimed at disguising how code was written. It does not simulate keystrokes, and it does
> not make generated code look hand-written — the text is inserted verbatim.

---

## Features

| | |
| --- | --- |
| **Four granularity modes** | Character, Word, Line, and language-aware Smart |
| **Speed is separate from granularity** | Insert at word-level undo granularity *instantly*, if you like |
| **Language-aware Smart mode** | Understands comments, strings, operators and indentation across 50+ language IDs |
| **Cancellable** | <kbd>Esc</kbd> stops an insertion; what has landed stays put |
| **Progress feedback** | A cancellable status-bar item, with no flicker on short insertions |
| **Content-safe** | Every insertion is verified chunk by chunk against the source |
| **Local only** | No network calls, no telemetry, no AI service |
| **Tested** | 314 automated tests, including a suite that drives a real VS Code instance |

---

## How it works

1. You give Human Type some text — from the clipboard, from an input box, or from a
   selection.
2. The **chunker** (`src/chunker.ts`) splits it into insertion units according to your
   chosen mode. This is deterministic local logic: no LLM, no network, no randomness.
3. The **insertion engine** (`src/insertionEngine.ts`) applies each chunk with a separate
   `TextEditor.edit()` call carrying `undoStopBefore: true`.
4. VS Code records one undo element per call, so <kbd>Ctrl</kbd>+<kbd>Z</kbd> and
   <kbd>Ctrl</kbd>+<kbd>Y</kbd> step through the insertion one chunk at a time.

The engine re-reads the affected range after every edit and compares it to the chunk it
just wrote. If anything disagrees — a concurrent edit from another extension, an
unexpected transformation — it stops immediately rather than continuing to write into a
document whose state it no longer understands.

---

## Modes

### Character

One user-perceived character per undo step.

```
hello  →  h · e · l · l · o
```

Emoji (including ZWJ sequences such as 👩‍💻), combining accents and CRLF pairs are never
split apart. This is the slowest mode; it exists mainly for testing and for maximum
compatibility.

### Word

Splits on transitions between three character classes — word, horizontal whitespace, and
everything else — with line breaks always forming their own chunk.

```
foo.bar(baz);  →  foo · . · bar · ( · baz · );
```

### Line

One chunk per logical line, including that line's terminator.

```
#include <iostream>       →  #include <iostream>\n
                          →  \n
int main() {              →  int main() {\n
    std::cout << "Hello"; →      std::cout << "Hello";\n
    return 0;             →      return 0;\n
}                         →  }\n
```

### Smart (default)

A language-aware lexical scanner — not a parser, and deliberately so. It recognises
indentation, blank lines, comments, string literals, numbers, identifiers, keywords,
multi-character operators and punctuation, then applies two grouping rules:

1. A word-like token absorbs directly adjacent trailing punctuation, up to four
   characters — so `hello` + `():` becomes one chunk.
2. A run of adjacent closing punctuation groups together — `}` + `;` becomes `};`.

```python
def hello():
    print("Hello")
    return True
```

becomes

```
def · ␣ · hello(): · ⏎ · ␣␣␣␣ · print( · "Hello" · ) · ⏎ · ␣␣␣␣ · return · ␣ · True · ⏎
```

Strings and comments stay intact as single units, so a comment never gets torn in half —
unless it exceeds 80 characters, in which case it is split at whitespace so one long
docstring does not become one enormous undo step.

Unknown languages fall back to generic lexical rules and still work.

---

## Speed is not granularity

These are two independent settings, and conflating them is the most common mistake in
this category of extension.

- **`humanType.mode`** decides *where the undo boundaries go*.
- **`humanType.speed`** decides *how long to wait between chunks*.

`mode: "word"` with `speed: "instant"` gives you word-level undo granularity with no
perceptible delay. Undo granularity comes from the undo-stop flags, **not** from timing —
this is measured and documented in [`docs/UNDO-BEHAVIOR.md`](docs/UNDO-BEHAVIOR.md),
finding 3.

| Speed | Delay per chunk |
| --- | --- |
| `instant` | 0 ms |
| `fast` *(default)* | 5 ms |
| `normal` | 20 ms |
| `slow` | 60 ms |
| `custom` | `humanType.delay` |

---

## Install

Not on the Marketplace and not intended for it. Download the VSIX from the
[latest release](https://github.com/711nishtha/human-type/releases/latest) and install it.
This URL always points at the newest build, so it never needs updating:

```bash
curl -L -o human-type.vsix https://github.com/711nishtha/human-type/releases/latest/download/human-type.vsix
code --install-extension human-type.vsix
```

Then reload VS Code. <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd> works immediately — the
keybinding ships with the extension, so there is nothing to configure on a new machine.

Building it yourself instead:

```bash
npm install
npm run package                 # -> human-type-0.2.0.vsix
code --install-extension human-type-0.2.0.vsix
```

To remove it: `code --uninstall-extension 711nishtha.human-type`

---

## Usage

1. Copy the code or text you want.
2. Put your cursor where it should go.
3. Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd> — or run **Human Type: Insert
   Clipboard** from the Command Palette (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>).

That is the whole workflow.

### Keyboard shortcuts

| Shortcut | Does |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd> (<kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd> on macOS) | Insert Clipboard |
| <kbd>Esc</kbd> | Cancel the running insertion |

`Ctrl+Alt+V` was chosen because VS Code leaves it unbound, so installing Human Type does
not take anything away from you. **Normal paste is untouched** — <kbd>Ctrl</kbd>+<kbd>V</kbd>
and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> behave exactly as they always did.

The <kbd>Esc</kbd> binding is scoped to `humanType.inserting`, so it is inert unless an
insertion is actually running — it never interferes with dismissing suggestions or exiting
multi-cursor mode.

To use a different key, open **Preferences: Open Keyboard Shortcuts**, search for
`Human Type`, and rebind it there.

---

## Commands

| Command | ID | What it does |
| --- | --- | --- |
| Human Type: Insert Clipboard | `humanType.insertClipboard` | Inserts the clipboard contents at the cursor |
| Human Type: Insert Text… | `humanType.insertText` | Prompts for text, then inserts it |
| Human Type: Insert Selection | `humanType.insertSelection` | Re-inserts the current selection in chunks, in place |
| Human Type: Cancel Current Insertion | `humanType.cancel` | Stops a running insertion |
| Human Type: Open Settings | `humanType.openSettings` | Opens the Human Type settings |
| Human Type: Test Undo Behavior | `humanType.testUndoBehavior` | Inserts `one two three` in five chunks so you can verify undo granularity yourself |

**Insert Text** uses VS Code's input box, which is single-line. Type `\n` for a line
break, `\t` for a tab, `\\` for a literal backslash. Any other backslash sequence is
passed through untouched, so `C:\Users\dev` and `\d+\s*` survive intact. Clipboard and
selection insertion never go through this decoding — that text is used verbatim.

---

## Configuration

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `humanType.mode` | `character` \| `word` \| `line` \| `smart` | `smart` | Where undo boundaries go |
| `humanType.speed` | `instant` \| `fast` \| `normal` \| `slow` \| `custom` | `fast` | Delay between chunks |
| `humanType.delay` | number (0–2000) | `15` | Milliseconds per chunk when `speed` is `custom` |
| `humanType.smartChunking` | boolean | `true` | Use language-specific syntax in Smart mode; when off, Smart mode uses generic rules for every language |
| `humanType.showProgress` | boolean | `true` | Show the cancellable status-bar item |
| `humanType.replaceSelection` | boolean | `true` | Replace the selection (normal paste semantics) rather than inserting after it |
| `humanType.maxChunks` | number (1–100000) | `5000` | Safety cap on undo steps per insertion |
| `humanType.largeInputThreshold` | number | `102400` | Ask for confirmation above this many characters; `0` disables the prompt |
| `humanType.followInsertionPoint` | boolean | `true` | Scroll to keep the insertion point visible and re-sync the caret |

All settings support per-language overrides:

```jsonc
{
  "humanType.mode": "smart",
  "[markdown]": {
    "humanType.mode": "line"
  }
}
```

Invalid values are never fatal. They fall back to the documented default and Human Type
tells you which setting it ignored and why.

---

## Undo and redo: what is actually guaranteed

This is the part of the project that got built first and tested hardest. Before any UI
existed, a proof-of-concept measured VS Code's real behaviour; the results are recorded in
[**`docs/UNDO-BEHAVIOR.md`**](docs/UNDO-BEHAVIOR.md) and re-verified on every test run.

**Verified behaviour** (VS Code 1.134, Windows 11 x64, 11 automated probes):

- One `edit()` call with `undoStopBefore: true` produces exactly one undo step.
- Redo is a perfect mirror of undo.
- Timing does not affect grouping — only the undo-stop flags do.
- Your existing undo history is preserved; Human Type never resets or replaces it.
- Text you type by hand after an insertion undoes separately. VS Code coalesces a typed
  run into one step (its own behaviour, not ours), then Human Type's chunks come off one
  at a time beneath it.
- Replacing a selection restores the original text in a single undo step.

Inserting `AAA BBB CCC` in Word mode:

| Action | Document |
| --- | --- |
| *after insertion* | `AAA BBB CCC` |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | `AAA BBB ` |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | `AAA BBB` |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | `AAA ` |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | `AAA` |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | *(empty)* |
| <kbd>Ctrl</kbd>+<kbd>Y</kbd> | `AAA` |
| <kbd>Ctrl</kbd>+<kbd>Y</kbd> | `AAA ` |

You can reproduce this yourself in five seconds with **Human Type: Test Undo Behavior**.

**What is *not* guaranteed:** VS Code's undo stack is bounded — its `UndoRedoService`
evicts the oldest elements once an internal memory budget is exceeded. A very large
character-mode insertion can therefore push older, unrelated history off the end of the
stack. `humanType.maxChunks` exists to keep that from happening by accident.

---

## Content integrity

Human Type must never change your content. The guarantee is enforced in three places:

1. The chunker asserts that rejoined chunks equal the source exactly, with contiguous
   offsets and no empty chunks — on every insertion, not just in tests.
2. The engine re-reads the affected range after every single edit and compares it to the
   chunk it wrote.
3. The test suite round-trips 30 samples — C, C++, Java, Python, JS, TS, Go, Rust, HTML,
   CSS, JSON, Markdown, SQL, CRLF, mixed EOL, tabs, emoji, CJK, combining accents,
   unterminated strings and comments — through all four modes and asserts byte equality.

### The one transformation

Line endings are normalised to the destination document's EOL, exactly as VS Code's own
paste does. Pasting LF content into a CRLF file gives you CRLF.

This is not cosmetic — it is required for correctness. `TextEditorEdit.insert()` rewrites
inserted line endings to the document's EOL, so a one-character `"\n"` grows a CRLF
document by *two* characters. An engine that advanced its offset by `chunk.length` would
drift and interleave the remaining chunks into the wrong positions. That failure is real:
it was caught by the proof of concept before any of the product was built, and POC test
`H` now reproduces it deliberately so the regression can never return.

---

## Cancellation: exactly what happens

Press <kbd>Esc</kbd> in the editor, click the status-bar item, or run **Human Type: Cancel
Current Insertion**.

- **Future chunks stop.** Nothing further is written.
- **Text already inserted stays in the document.** Human Type does *not* revert it.
- Every chunk that landed is still individually undoable — press
  <kbd>Ctrl</kbd>+<kbd>Z</kbd> to step back through as much or as little as you want.
- A notification tells you how many chunks were applied.

Leaving the partial text is deliberate. Auto-reverting would mean either issuing a
destructive edit you did not ask for, or firing a batch undo — which is precisely the
behaviour this extension exists to avoid.

---

## Performance

Measured on Windows 11 x64, VS Code 1.134, with `maxChunks: 300`, across several runs:

| Input | Chunks | Time | Rate |
| --- | --- | --- | --- |
| 1 KB | 276 | 1.0-3.1 s | ~90-285 chunks/s |
| 10 KB | 292 | 1.0-3.1 s | ~95-280 chunks/s |
| 100 KB | 300 | 1.2-3.0 s | ~100-257 chunks/s |
| 500 KB | 300 | 1.9-3.6 s | ~83-155 chunks/s |

The spread is real: the per-chunk cost is an async round trip to the editor, so it swings
with machine load. Plan on roughly **100 chunks per second** and treat anything faster as
a bonus.

Chunking itself is a small fraction of that: 500 KB splits in about 85 ms in Smart mode
and 45 ms in Character mode. Wall-clock time is dominated by the round trips, not the
splitting. **Insertion time scales with chunk count, not with input size** - which is why
`maxChunks` is the setting that controls how long a large insertion takes.

Practical guidance:

- Word / Line / Smart modes are comfortable up to a few hundred KB.
- Character mode on large input will be slow by definition — that is the mode's nature,
  not a defect. `maxChunks` merges chunks to keep it bounded.
- Above `humanType.largeInputThreshold` (100 KB by default) Human Type asks before
  starting.
- There is no hard size limit, but inputs beyond ~1 MB are not recommended.

The extension does not create one timer per character, does not block the extension host,
and throttles status-bar redraws so a 5,000-chunk insertion still performs at most one UI
update per 80 ms.

---

## Privacy

Human Type is **local only**.

- **No network calls of any kind.** No AI API — not OpenAI, not Anthropic, not Google, not
  anything. The extension makes no HTTP requests whatsoever.
- **No telemetry.** Nothing is collected, counted, or reported.
- **Your document contents never leave your machine.**
- **Clipboard access happens only when you invoke Insert Clipboard**, is used for that one
  insertion, and is never cached, logged, or persisted.
- Smart mode's language awareness is a static table compiled into the extension. No model,
  no service.

The extension has zero runtime dependencies and `src/` is about 1,900 lines of TypeScript,
so the claim is checkable in the source rather than merely asserted.

---

## Limitations

Known and deliberate, as of 0.2.0:

- **Multi-cursor is not supported.** With several cursors active, Human Type asks before
  proceeding and then uses the primary cursor only. Keeping every caret and its undo steps
  consistent across many sequential edits cannot be done reliably with the current API, and
  shipping something unreliable here would be worse than shipping nothing.
- **Line endings are normalised** to the destination document's EOL. See
  [Content integrity](#content-integrity).
- **Insert Text is single-line**, because VS Code's input box is. Use `\n`, or use the
  clipboard.
- **The undo stack is bounded by VS Code**, not by this extension. Very large insertions
  can evict older history; `maxChunks` mitigates this.
- **Character mode is slow on large input**, by design.
- **Smart mode is a lexer, not a parser.** It will not always agree with your language's
  grammar in exotic cases — nested template literals, heredocs, regex-vs-division
  ambiguity. It never loses or alters content when it guesses differently; the chunk
  boundaries just land somewhere less elegant.
- **Concurrent edits abort the insertion.** If another extension or an external change
  modifies the document mid-insertion, Human Type stops rather than risk corrupting it.

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer (developed on 24.x)
- npm 9 or newer
- Visual Studio Code 1.85 or newer

### Set up

```bash
git clone https://github.com/711nishtha/human-type
cd human-type
npm install
```

### Compile

```bash
npm run compile     # one-off build to out/
npm run watch       # rebuild on change
```

### Run the extension locally

1. Open the project folder in VS Code.
2. Press <kbd>F5</kbd> (or **Run and Debug** → **Run Extension**).
3. A second window opens — the **Extension Development Host**. Its title bar says
   `[Extension Development Host]`.
4. In that window, open or create any file.
5. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> and type `Human Type`. All six
   commands appear under the **Human Type** category.
6. Start with **Human Type: Test Undo Behavior**, then press <kbd>Ctrl</kbd>+<kbd>Z</kbd>
   a few times.

Breakpoints set in `src/*.ts` in the first window will hit while the second window runs.

### Project structure

```
human-type/
├── src/
│   ├── extension.ts         Command layer: activation, the six commands, user messaging
│   ├── insertionEngine.ts   Applies chunks as edits with undo stops; integrity checks
│   ├── chunker.ts           Deterministic splitting for all four modes
│   ├── languages.ts         Per-language comment/string/operator tables for Smart mode
│   ├── config.ts            Reads and validates every humanType.* setting
│   ├── clipboard.ts         Clipboard read with explicit failure handling
│   ├── progress.ts          Throttled, flicker-free status-bar progress
│   ├── textUtils.ts         EOL normalisation and input-box escape decoding
│   └── types.ts             Shared types; the Chunk contract
├── test/
│   ├── unit/                Plain Node tests: chunker, languages, text utilities
│   ├── integration/         Tests that drive a real VS Code instance
│   └── fixtures/            Sample files for manual testing
├── docs/
│   ├── UNDO-BEHAVIOR.md     Measured VS Code undo semantics and the hazards found
│   └── MANUAL-TESTS.md      Human checklist for things automation cannot assert
├── scripts/generate-icon.js Generates icon.png from code
└── .github/workflows/ci.yml Compile, lint and test on every push and PR
```

`extension.ts` deliberately contains no editing logic and no chunking logic.

---

## Testing

```bash
npm test                  # compile + lint + unit + integration (the CI command)
npm run test:unit         # fast, plain Node, no editor required
npm run test:integration   # downloads and drives a real VS Code instance
npm run lint
```

**314 tests**: 247 unit and 67 integration.

The unit suite's centrepiece is a property check — 30 samples × 4 modes — asserting that
rejoining the chunks reproduces the source exactly. If a chunking change ever altered a
byte of user content, those tests fail before anything else does.

The integration suite runs inside a real Extension Development Host and covers the full
scenario matrix: empty files, 120-line files, insertion at start/middle/end, selection
replacement, multi-line content, indentation, Unicode, 1 KB through 500 KB, undo, redo,
undo after manual typing, typing after insertion, repeated insertions, cancellation, and
every error path.

`test/integration/poc.undo.test.ts` is the original proof of concept, kept in the suite
permanently. It probes VS Code's undo semantics directly and fails loudly if a future VS
Code release changes them.

For the things automation cannot check — how it *feels*, whether the status bar flickers —
see [`docs/MANUAL-TESTS.md`](docs/MANUAL-TESTS.md).

---

## Building a VSIX

```bash
npm run package     # runs vsce package -> human-type-0.2.0.vsix
```

`npx vsce ls` prints exactly which files will be included, which is worth a glance after
changing `.vscodeignore`. The packaged extension is ~50 KB and has no runtime
dependencies.

---

## Versioning and roadmap

[Semantic Versioning](https://semver.org/). `0.x` signals that the settings surface may
still change.

| Version | Shipped |
| --- | --- |
| **0.2.0** | `Ctrl+Alt+V` as a default keybinding, so a fresh install needs no setup |
| 0.1.0 | Four modes, six commands, native undo, full test suite |

Planned, in no fixed order: better statement grouping in Smart mode, more languages, a
status-bar mode picker, a multi-line input panel, and multi-cursor support if it can be
made genuinely reliable.

---

## Related work

*Paste Letter by Letter* is an existing VS Code extension that inserts clipboard content
character by character for granular undo. The core idea is not new and this project does
not claim otherwise. Human Type was written from scratch and adds word / line / smart
granularity, language awareness, speed decoupled from granularity, cancellation, progress,
content-integrity verification and a test suite.

---

## Contributing

This is a personal, proprietary project. If you have been given access and want to
propose a change, open an issue first — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
terms that apply to contributions.

---

## Support

See [SUPPORT.md](SUPPORT.md).

---

## License

**Copyright © 2026 Nishtha Sharma. All rights reserved.**

Human Type is proprietary software, licensed — not sold — under the terms in
[LICENSE](LICENSE). It is free to install and free to use, for personal and commercial
work alike.

This is not open source. Access to the source does not grant rights to copy, modify,
redistribute, or republish it to any marketplace or registry without written permission
from the copyright holder.
