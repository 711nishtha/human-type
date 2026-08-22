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
| **Tested** | 306 automated tests, including a suite that drives a real VS Code instance |

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

## Installation

### From a VSIX

```bash
code --install-extension human-type-0.1.0.vsix
```

Or: **Extensions** view → **…** menu → **Install from VSIX…**

### From the Marketplace

Not yet published. See [Publishing](#how-to-publish-to-the-vs-code-marketplace).

---

## Usage

1. Copy the code or text you want.
2. Put your cursor where it should go.
3. Run **Human Type: Insert Clipboard** from the Command Palette
   (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>).

That is the whole workflow.

### Keyboard shortcut

**Human Type ships with no insertion keybinding by default**, deliberately: it will not
take over <kbd>Ctrl</kbd>+<kbd>V</kbd> or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>
behind your back. To bind it yourself, open **Preferences: Open Keyboard Shortcuts (JSON)**
and add:

```jsonc
{
  "key": "ctrl+shift+v",
  "command": "humanType.insertClipboard",
  "when": "editorTextFocus"
}
```

The only keybinding the extension does contribute is <kbd>Esc</kbd> to cancel, and it is
active *only* while an insertion is running (`when: "humanType.inserting"`), so it never
interferes with normal editing.

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

Measured on Windows 11 x64, VS Code 1.134, with `maxChunks: 300`:

| Input | Chunks | Time | Rate |
| --- | --- | --- | --- |
| 1 KB | 276 | 2.9 s | ~94 chunks/s |
| 10 KB | 292 | 2.9 s | ~100 chunks/s |
| 100 KB | 300 | 3.3 s | ~90 chunks/s |
| 500 KB | 300 | 3.6 s | ~84 chunks/s |

The chunking itself is fast — 500 KB splits in 73 ms in Smart mode. Wall-clock time is
dominated by the per-chunk round trip between the extension host and the editor, roughly
10 ms each. **Insertion time scales with chunk count, not with input size.**

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

You can verify this: the extension has zero runtime dependencies, and `src/` is about 1,200
lines of TypeScript.

---

## Limitations

Known and deliberate, as of 0.1.0:

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
git clone <REPOSITORY_URL>
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

**306 tests**: 239 unit and 67 integration.

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

## Packaging a VSIX

```bash
npm install --global @vscode/vsce
npm run compile
vsce package
```

This produces `human-type-0.1.0.vsix`.

Useful checks before shipping:

```bash
vsce ls        # exactly which files will be included
vsce package   # fails on missing icon, bad repository field, etc.
```

Install it locally:

```bash
code --install-extension human-type-0.1.0.vsix
```

Or **Extensions** → **…** → **Install from VSIX…**. Uninstall with
`code --uninstall-extension your-publisher-id.human-type`.

> **Before packaging you must replace `your-publisher-id`** in `package.json` — see
> [Placeholders](#placeholders-you-must-replace).

---

## Publishing to GitHub

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin <REPOSITORY_URL>
git push -u origin main
```

`.gitignore` already excludes `node_modules/`, `out/`, `dist/`, `*.vsix`, `.env`,
credentials, tokens and local test artefacts.

CI runs on every push and pull request: `npm ci`, `npm run compile`, `npm run lint`,
`npm run test:unit`, and the integration suite under `xvfb` on Linux. It fails on
TypeScript errors, lint errors and failing tests. It does **not** publish to the
Marketplace.

---

## How to publish to the VS Code Marketplace

Microsoft changes the authentication requirements for this periodically, so follow the
official documentation rather than any hardcoded steps:

**<https://code.visualstudio.com/api/working-with-extensions/publishing-extension>**

The shape of the process:

1. **Sign in to a Microsoft account.**
2. **Create an Azure DevOps organisation** — the Marketplace uses it for identity.
   <https://dev.azure.com/>
3. **Create the authentication credential** the current documentation calls for (a Personal
   Access Token scoped to **Marketplace → Manage**, with **All accessible organizations**
   selected, at the time of writing). Follow the live docs — this is the part that changes.
4. **Create a Marketplace publisher** at
   <https://marketplace.visualstudio.com/manage>. The publisher ID you choose is what goes
   into `package.json`.
5. **Set `publisher` in `package.json`** to that ID, replacing `your-publisher-id`.
6. **Authenticate `vsce`:**
   ```bash
   vsce login <your-publisher-id>
   ```
7. **Publish:**
   ```bash
   vsce publish
   # or bump and publish in one step:
   vsce publish minor
   ```

### Manual publishing

If you would rather not give `vsce` a token:

```bash
vsce package
```

then upload the `.vsix` at <https://marketplace.visualstudio.com/manage> → your publisher
→ **New extension** → **Visual Studio Code**.

### Before you publish

- The Marketplace requires a **globally unique** extension name. `human-type` may already
  be taken — check <https://marketplace.visualstudio.com/search?term=human%20type> and
  change `name` in `package.json` if needed. The `displayName` does not have to be unique.
- Replace every placeholder listed below.
- Run `vsce package` and `vsce ls` and read the file list.

---

## Placeholders you must replace

Everything you need to change before publishing, in one place:

| Placeholder | File | Replace with |
| --- | --- | --- |
| `your-publisher-id` | `package.json` → `publisher` | Your Marketplace publisher ID |
| `your-publisher-id` | `src/extension.ts` → `currentExtensionUri()` | The same ID (there is a fallback, so this one is optional) |
| `YOUR_GITHUB_USERNAME` | `package.json` → `repository`, `bugs`, `homepage` | Your GitHub username |
| `YOUR_NAME` | `LICENSE` | The copyright holder's name |
| `<REPOSITORY_URL>` | `README.md`, `SUPPORT.md` | Your repository URL |

Find them all with:

```bash
grep -rn "your-publisher-id\|YOUR_GITHUB_USERNAME\|YOUR_NAME\|<REPOSITORY_URL>" \
  --include="*.json" --include="*.ts" --include="*.md" .
```

---

## Versioning

[Semantic Versioning](https://semver.org/). Starting at **0.1.0**, not 0.0.1: this is a
complete, tested, usable MVP rather than a first sketch, and `0.x` signals that the
settings surface may still change before 1.0.

Roadmap:

| Version | Focus |
| --- | --- |
| **0.1.0** | Usable MVP — four modes, four commands + cancel, native undo, full test suite |
| 0.2.0 | Smart-mode improvements: better statement grouping, more languages, per-chunk-type pacing |
| 0.3.0 | UI: mode picker in the status bar, a multi-line input panel, a chunk preview |
| 0.4.0 | Multi-cursor support, if it can be made genuinely reliable |
| 1.0.0 | Stable settings surface, Marketplace release |

---

## Related work

**[Paste Letter by Letter](https://marketplace.visualstudio.com/search?term=paste%20letter%20by%20letter)**
is an existing extension that inserts clipboard content character by character to give
granular undo. The core idea is not new, and this project does not claim otherwise. Human
Type was written from scratch and adds word / line / smart granularity, language awareness,
speed decoupled from granularity, cancellation, progress reporting, content-integrity
verification, configuration, and a test suite.

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

The one hard rule: **any change that touches chunking or insertion must keep the content
integrity tests passing.** If you add a mode or a language, add a round-trip test for it.

---

## Support

See [SUPPORT.md](SUPPORT.md).

---

## License

[MIT](LICENSE).
