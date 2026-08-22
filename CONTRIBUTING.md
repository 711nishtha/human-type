# Contributing to Human Type

Human Type is **proprietary software**. Copyright © 2026 Nishtha Sharma. All rights
reserved.

The source is published for transparency, evaluation, and security review. It is not open
source, and the [LICENSE](LICENSE) does not grant rights to fork, modify, or redistribute
it.

That said, contributions are welcome on the terms below.

## Before you write any code

**Open an issue first.** Describe the problem or the change you have in mind and wait for
a reply. Unsolicited pull requests may be declined regardless of quality, simply because
the change does not fit the roadmap — and nobody enjoys that outcome.

Bug reports and feature requests need no permission at all. See [SUPPORT.md](SUPPORT.md).

## Contributor terms

By submitting a pull request, patch, or any other contribution, you agree that:

1. You assign to Nishtha Sharma all right, title, and interest in your contribution,
   including all copyright and related rights.
2. You have the legal right to make that assignment — the work is yours, and it is not
   encumbered by an employer agreement or a third-party licence.
3. Your contribution contains no code copied from another project, unless you say so
   explicitly in the pull request and the licence permits it.
4. Your contribution is provided without warranty.

This is stated in Section 3 of the [LICENSE](LICENSE). If you cannot agree to it, please
open an issue describing the fix instead of sending code — a clear bug report is genuinely
just as valuable.

## Getting set up

```bash
npm install
npm run compile
npm test
```

`npm test` is exactly what CI runs: compile, lint, unit tests, integration tests. It must
pass before anything can be merged.

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with your build
loaded.

## The one hard rule

**Human Type must never alter user content.**

Any change touching `src/chunker.ts` or `src/insertionEngine.ts` must keep the content
integrity tests green. Those tests round-trip 30+ samples through all four modes and assert
byte equality. If you add a mode, a language, or a chunking heuristic, add a sample to
`SAMPLES` in `test/unit/chunker.test.ts` — that single addition tests your change against
every mode automatically.

The chunker's invariant, asserted at runtime and not only in tests:

```
chunkText(text, mode, opts).map(c => c.text).join('') === text
```

with contiguous offsets, no gaps, no overlaps, and no empty chunks.

## Undo semantics

If you change how edits are applied, read [`docs/UNDO-BEHAVIOR.md`](docs/UNDO-BEHAVIOR.md)
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
- Keep the copyright header at the top of every source file.
- Comments explain *why*, not *what*. The existing code is the reference for tone and
  density.
- Keep `src/extension.ts` free of editing and chunking logic — it is the command layer.

## Pull requests

- One logical change per PR.
- Update `CHANGELOG.md` under an `## [Unreleased]` heading.
- Update the README if you change a setting, a command, or a documented behaviour.
- If you found a behaviour of VS Code that surprised you, add it to `docs/UNDO-BEHAVIOR.md`
  with a test that proves it. That file is the project's memory.
