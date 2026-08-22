# START HERE

You have a complete, tested, packaged VS Code extension. This page is the five-minute
orientation; [README.md](README.md) is the full reference.

## 1. See it work (2 minutes)

```bash
npm install     # already done, but safe to re-run
npm run compile
```

Then in VS Code:

1. Open this folder.
2. Press <kbd>F5</kbd> → a second window opens, titled **[Extension Development Host]**.
3. In that window, open any file.
4. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> → **Human Type: Test Undo Behavior**.
5. Press <kbd>Ctrl</kbd>+<kbd>Z</kbd> five times.

Each press should remove one chunk. That is the entire product promise, and if it ever
stops being true, everything else is irrelevant.

## 2. Confirm the build is honest

```bash
npm test
```

Compile → lint → 239 unit tests → 67 integration tests against a real VS Code instance.
Takes about a minute. This is exactly what CI runs.

## 3. Replace the placeholders

Nothing ships until these are real values:

```bash
grep -rn "your-publisher-id\|YOUR_GITHUB_USERNAME\|YOUR_NAME\|<REPOSITORY_URL>" \
  --include="*.json" --include="*.ts" --include="*.md" . | grep -v node_modules
```

| Placeholder | Where | What it should become |
| --- | --- | --- |
| `your-publisher-id` | `package.json` → `publisher` | Your Marketplace publisher ID (**required** to publish) |
| `your-publisher-id` | `src/extension.ts` → `currentExtensionUri()` | The same ID (optional — there is a working fallback) |
| `YOUR_GITHUB_USERNAME` | `package.json` → `repository`, `bugs`, `homepage`; `CHANGELOG.md` | Your GitHub username |
| `YOUR_NAME` | `LICENSE` | The copyright holder |
| `<REPOSITORY_URL>` | `README.md`, `SUPPORT.md` | Your repository URL |

Also set your git identity — the initial commit used a placeholder name:

```bash
git config user.name "Your Real Name"
```

Check that `human-type` is still free on the Marketplace before publishing:
<https://marketplace.visualstudio.com/search?term=human%20type>. If it is taken, change
`name` in `package.json` (`displayName` does not need to be unique).

## 4. Push to GitHub

A local repository already exists on `main` with one clean commit. Nothing has been
pushed.

```bash
git remote add origin <REPOSITORY_URL>
git push -u origin main
```

CI starts on the first push: compile, lint, and both test suites on Linux, Windows and
macOS, plus a VSIX packaging check. It does **not** publish anything.

## 5. Ship a VSIX

```bash
npm run package                                   # -> human-type-0.1.0.vsix
code --install-extension human-type-0.1.0.vsix    # try it in your real editor
```

## 6. Publish to the Marketplace

Follow the README's [publishing section](README.md#how-to-publish-to-the-vs-code-marketplace).
It deliberately links to Microsoft's live documentation for the authentication step,
because that is the part Microsoft changes.

---

## Where things live

| I want to… | Go to |
| --- | --- |
| Change how text is split into undo steps | `src/chunker.ts` |
| Add a language to Smart mode | `src/languages.ts` |
| Change how edits are applied to the editor | `src/insertionEngine.ts` |
| Add or change a command | `src/extension.ts` |
| Add or change a setting | `package.json` → `contributes.configuration`, then `src/config.ts` |
| Understand why the undo code is written the way it is | **`docs/UNDO-BEHAVIOR.md`** |
| Test something automation cannot | `docs/MANUAL-TESTS.md` |

## The two things to know before changing anything

**1. Content integrity is the hard invariant.** The chunker asserts at runtime that
rejoining chunks reproduces the source exactly. If you touch chunking, add a sample to
`SAMPLES` in `test/unit/chunker.test.ts` — one line there tests your change against all
four modes automatically.

**2. `docs/UNDO-BEHAVIOR.md` is measured, not assumed.** Every claim in it comes from
`test/integration/poc.undo.test.ts`, which runs on every `npm test`. Before changing how
edits are applied, read it. It also documents the EOL hazard that would otherwise silently
corrupt files on Windows.

## Honest status

- ✅ Undo/redo granularity: verified against real VS Code, not assumed.
- ✅ Content integrity: verified on every insertion at runtime, plus 300+ tests.
- ✅ Packages cleanly into a 47 KB VSIX with zero runtime dependencies.
- ⚠️ Multi-cursor is not supported — Human Type asks, then uses the primary cursor.
- ⚠️ Line endings are normalised to the destination document's EOL (same as paste). This
  is required for correctness, not a convenience.
- ⚠️ Insertion speed is ~90 chunks/second, bounded by the editor round trip. Time scales
  with chunk count, not input size.
