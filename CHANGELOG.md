# Changelog

All notable changes to Human Type are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-22

First release: a complete, tested MVP.

### Added

- **Four insertion modes**, each producing a different undo granularity:
  - `character` — one user-perceived character per undo step, Unicode-safe (emoji ZWJ
    sequences, combining marks and CRLF pairs are never split).
  - `word` — words, whitespace runs and punctuation runs.
  - `line` — one logical line per step, terminator included.
  - `smart` *(default)* — a language-aware lexical scanner covering indentation, blank
    lines, comments, strings, numbers, identifiers, keywords, multi-character operators
    and punctuation, with adjacent-punctuation grouping.
- **Speed decoupled from granularity**: `instant`, `fast`, `normal`, `slow`, `custom`.
  Undo granularity comes from undo-stop flags, never from timing.
- **Language awareness** for 50+ VS Code language IDs, including C, C++, Java, Python,
  JavaScript, TypeScript, Go, Rust, HTML, CSS, JSON, Markdown and SQL. Unknown languages
  fall back to generic lexical rules and still work.
- **Commands**: Insert Clipboard, Insert Text, Insert Selection, Cancel Current Insertion,
  Open Settings, Test Undo Behavior.
- **Cancellation** via <kbd>Esc</kbd> (scoped to `humanType.inserting`, so it never
  interferes with normal editing), the status-bar item, or the command. Already-inserted
  text is left in place and remains individually undoable.
- **Throttled, flicker-free progress**: the status-bar item appears only if the insertion
  outlives 250 ms, and redraws at most every 80 ms.
- **Content-integrity verification** at two levels: the chunker asserts that rejoined
  chunks equal the source with contiguous offsets, and the engine re-reads the affected
  range after every edit to confirm the chunk landed exactly as written.
- **`maxChunks` safety cap** (default 5000) that merges adjacent chunks on very large
  inputs, protecting responsiveness and VS Code's bounded undo stack.
- **Large-input confirmation** above `largeInputThreshold` (default 100 KB).
- Per-language and per-workspace-folder setting overrides.
- Setting validation: invalid values fall back to documented defaults with an explanatory
  warning rather than failing.
- **306 automated tests** — 239 unit, 67 integration against a real VS Code instance.
- [`docs/UNDO-BEHAVIOR.md`](docs/UNDO-BEHAVIOR.md): measured VS Code undo semantics, kept
  honest by a permanent probe suite.
- [`docs/MANUAL-TESTS.md`](docs/MANUAL-TESTS.md): checklist for what automation cannot
  assert.
- Icon generated from code by `scripts/generate-icon.js` — no third-party assets.

### Notes on behaviour

- Line endings are normalised to the destination document's EOL, exactly as VS Code's own
  paste does. This is the only transformation applied to content, and it is required for
  correctness — see `docs/UNDO-BEHAVIOR.md` finding 4.
- Multi-cursor insertion is not supported. With several cursors active, Human Type asks
  before proceeding and uses the primary cursor only.
- Human Type uses VS Code's native undo stack. There is no custom undo system and no
  <kbd>Ctrl</kbd>+<kbd>Z</kbd> interception.

### Privacy

- No network requests, no AI services, no telemetry. Zero runtime dependencies.

[0.1.0]: https://github.com/YOUR_GITHUB_USERNAME/human-type/releases/tag/v0.1.0
