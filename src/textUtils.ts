/**
 * Pure text helpers shared by the engine and the command layer.
 *
 * No `vscode` import, so these are unit-tested in plain Node.
 */

export type EolSequence = '\n' | '\r\n';

/**
 * Rewrite every line ending in `text` to `eol`.
 *
 * This is the ONLY transformation Human Type applies to user content, and it is
 * required for correctness rather than cosmetic: `TextEditorEdit.insert()` normalises
 * inserted line endings to the document's EOL, so a one-character "\n" grows a CRLF
 * document by two characters. Normalising up front keeps `chunk.text.length` equal to
 * the document's growth, which is what the engine's offset arithmetic depends on.
 *
 * See `docs/UNDO-BEHAVIOR.md` finding 4 and POC test `H`.
 */
export function normaliseEolTo(text: string, eol: EolSequence): string {
  return text.replace(/\r\n|\r|\n/g, eol);
}

/**
 * Interpret the small escape vocabulary accepted by the "Insert Text" input box.
 *
 * VS Code's input box is single-line, so `\n` / `\t` / `\r` are the only way to hand-type
 * a multi-line snippet. `\\` produces a literal backslash; any other backslash sequence
 * is passed through untouched, so Windows paths and regexes survive intact
 * (`C:\Users\dev` stays `C:\Users\dev`).
 *
 * Clipboard and selection insertion never go through this - that text is used verbatim.
 */
export function decodeEscapes(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== '\\' || i === input.length - 1) {
      out += input[i];
      continue;
    }
    switch (input[i + 1]) {
      case 'n':
        out += '\n';
        i++;
        break;
      case 't':
        out += '\t';
        i++;
        break;
      case 'r':
        out += '\r';
        i++;
        break;
      case '\\':
        out += '\\';
        i++;
        break;
      default:
        out += '\\';
        break;
    }
  }
  return out;
}
