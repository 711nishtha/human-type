# Contributing to Human Type

Thanks for your interest. This document covers what you need to know to make a change
that will be accepted.

## Getting set up

```bash
npm install
npm run compile
npm test
```

`npm test` is the same command CI runs: compile, lint, unit tests, integration tests. It
must pass before a pull request can be merged.

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with your build
loaded.

## The one hard rule

**Human Type must never alter user content.**

Any change touching `src/chunker.ts` or `src/insertionEngine.ts` must keep the content
integrity tests green. Those tests round-trip 30 samples through all four modes and assert
byte equality. If you add a mode, a language, or a chunking heuristic, add a sample to
`SAMPLES` in `test/unit/chunker.test.ts` — that single addition tests your change against
every mode automatically.

The chunker's invariant, asserted at runtime and not only in tests:

```
chunkText(text, mode, opts).map(c => c.text).join('') === text
```

with contiguous offsets, no gaps, no overlaps, and no empty chunks.

## Undo semantics

If you change how edits are applied, re-read [`docs/UNDO-BEHAVIOR.md`](docs/UNDO-BEHAVIOR.md)
first. It records measured behaviour, not assumptions, and
`test/integration/poc.undo.test.ts` re-verifies it on every run.

Two things that are not negotiable:

- Use VS Code's native undo stack. No custom undo system, no <kbd>Ctrl</kbd>+<kbd>Z</kbd>
  interception.
- Use stable, public API only. No proposed API.

## Adding a language to Smart mode

Add an entry to `LANGUAGE_TABLE` in `src/languages.ts` describing the language's line
comments, block comments, string delimiters and multi-character operators. Then:

1. Add a representative sample to `SAMPLES` in `test/unit/chunker.test.ts`.
2. Add its language ID to `guessLanguage()` in the same file.
3. Add a targeted assertion if the language has a distinctive construct worth pinning
   (Python's triple quotes and SQL's `--` comments both have one).

Never remove the generic fallback. Unknown languages must keep working.

## Style

- TypeScript, `strict` mode. No `any` without a comment explaining why.
- `npm run lint` must pass.
- Comments explain *why*, not *what*. The existing code is the reference for tone and
  density.
- Keep `src/extension.ts` free of editing and chunking logic — it is the command layer.

## Pull requests

- One logical change per PR.
- Update `CHANGELOG.md` under an `## [Unreleased]` heading.
- Update the README if you change a setting, a command, or a documented behaviour.
- If you found a behaviour of VS Code that surprised you, add it to `docs/UNDO-BEHAVIOR.md`
  with a test that proves it. That file is the project's memory.
