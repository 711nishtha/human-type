# Support

## Before opening an issue

Run **Human Type: Test Undo Behavior** from the Command Palette. It inserts
`one two three` in five chunks. If pressing <kbd>Ctrl</kbd>+<kbd>Z</kbd> five times does
not remove them one at a time, that is the bug — say so, and include your VS Code version.

## Reporting a bug

Open an issue at `<REPOSITORY_URL>/issues` and include:

1. **VS Code version** — Help → About, or `code --version`.
2. **Operating system.**
3. **Your Human Type settings** — `humanType.mode`, `humanType.speed`, and anything else
   you changed from the defaults.
4. **The language of the file** you were inserting into (the language ID in the status
   bar, e.g. `python`).
5. **The exact text you inserted**, if you can share it. A minimal snippet that reproduces
   the problem is far more useful than a description.
6. **What you expected, and what happened.**

If content was altered or lost, that is the highest-severity class of bug in this project.
Please say so explicitly and include the before/after text — it will be treated as urgent.

## Common questions

**Nothing happens when I press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>.**
Human Type ships with no insertion keybinding on purpose, so it never takes over a paste
shortcut you did not ask it to. Bind one yourself — see the README's *Keyboard shortcut*
section.

**Undo removes more than one chunk at a time.**
Check `humanType.mode`. In `line` mode a whole line is one chunk; in `smart` mode a whole
string literal is one chunk. Also check `humanType.maxChunks` — on very large inputs,
adjacent chunks are merged to stay under that cap.

**My CRLF file got LF line endings, or vice versa.**
Line endings are normalised to the *destination document's* EOL, which is what VS Code's
own paste does. This is intentional and required for correctness; see the README's
*Content integrity* section.

**It is slow on a big file.**
Insertion time scales with the number of chunks, not the size of the input. Use `line` or
`smart` mode rather than `character`, set `humanType.speed` to `instant`, and lower
`humanType.maxChunks`.

**Does it send my code anywhere?**
No. There are no network calls of any kind, no telemetry, and no runtime dependencies. See
the README's *Privacy* section.

## Feature requests

Welcome — open an issue describing the workflow you want, not just the feature. The
roadmap in the README shows what is already planned.

## Security

If you believe you have found a security issue, please open an issue marked `[security]`
rather than posting exploit details publicly first.
