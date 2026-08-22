/*!
 * Human Type - Granular, human-like text insertion for VS Code.
 * Copyright (c) 2026 Nishtha Sharma. All rights reserved.
 * Licensed under the terms in LICENSE. Redistribution is not permitted.
 */
/**
 * Deterministic text chunking.
 *
 * Splits a source string into {@link Chunk}s, each of which becomes exactly one
 * undoable step in the editor. There is no LLM, no network, and no randomness here:
 * the same input always produces the same chunks.
 *
 * THE CENTRAL INVARIANT, enforced by {@link assertChunksCoverText} and by the unit
 * tests, is that chunking never alters content:
 *
 *   chunkText(text, ...).map(c => c.text).join('') === text
 *
 * No `vscode` import - this module is unit-tested in plain Node.
 */
import { getLanguageSyntax, LanguageSyntax } from './languages';
import { Chunk, ChunkOptions, ChunkType, InsertionMode } from './types';

/** Longest a single string/comment chunk may get before it is split further. */
const MAX_ATOMIC_CHUNK = 80;

/** Punctuation a word-like token may absorb when directly adjacent (Smart mode). */
const ABSORBABLE = '()[]{}<>,;:.';
/** Closing punctuation that groups into a run (Smart mode). */
const CLOSERS = ')]}>,;:';
/** Maximum characters absorbed/grouped by the two rules above. */
const ABSORB_MAX = 4;

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const DIGIT = /[0-9]/;
/** Whitespace that is not a line break (includes NBSP and the Unicode spaces). */
const HORIZONTAL_WS_SRC = '[ \\t\\f\\v\\u00a0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000]';
const HORIZONTAL_WS = new RegExp(HORIZONTAL_WS_SRC);

/**
 * Keywords across the supported languages. Used only to *label* chunks; mislabelling
 * a token has no effect on the text that gets inserted.
 */
const KEYWORDS = new Set([
  // control flow / declarations shared by most C-family and scripting languages
  'if', 'else', 'elif', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
  'continue', 'return', 'goto', 'try', 'catch', 'except', 'finally', 'throw', 'raise',
  'yield', 'await', 'async', 'def', 'lambda', 'function', 'fn', 'func', 'class',
  'struct', 'enum', 'union', 'interface', 'trait', 'impl', 'type', 'typedef',
  'namespace', 'module', 'package', 'import', 'from', 'include', 'require', 'use',
  'using', 'export', 'extends', 'implements', 'public', 'private', 'protected',
  'static', 'final', 'abstract', 'virtual', 'override', 'const', 'let', 'var', 'val',
  'mut', 'auto', 'new', 'delete', 'this', 'self', 'super', 'null', 'nil', 'none',
  'true', 'false', 'True', 'False', 'None', 'void', 'int', 'long', 'short', 'char',
  'float', 'double', 'bool', 'boolean', 'string', 'str', 'and', 'or', 'not', 'in',
  'is', 'as', 'with', 'pass', 'global', 'nonlocal', 'assert', 'del', 'print',
  'select', 'insert', 'update', 'delete_', 'where', 'join', 'group', 'order', 'by'
]);

/* -------------------------------------------------------------------------- */
/* Builder                                                                     */
/* -------------------------------------------------------------------------- */

class ChunkBuilder {
  private readonly chunks: Chunk[] = [];
  private cursor = 0;

  constructor(private readonly source: string) {}

  /** Emit the source range `[start, end)` as one chunk. */
  push(start: number, end: number, type: ChunkType): void {
    if (end <= start) {
      return;
    }
    if (start !== this.cursor) {
      throw new Error(
        `chunker: non-contiguous chunk at ${start} (expected ${this.cursor}). ` +
          'This is a bug; content integrity would be at risk.'
      );
    }
    this.chunks.push({
      text: this.source.slice(start, end),
      type,
      startOffset: start,
      endOffset: end
    });
    this.cursor = end;
  }

  /**
   * Emit `[start, end)` but split it at word boundaries if it is longer than
   * {@link MAX_ATOMIC_CHUNK}, so a 400-character string literal does not become a
   * single undo step.
   */
  pushAtomic(start: number, end: number, type: ChunkType): void {
    if (end - start <= MAX_ATOMIC_CHUNK) {
      this.push(start, end, type);
      return;
    }
    let i = start;
    while (i < end) {
      let stop = Math.min(i + MAX_ATOMIC_CHUNK, end);
      if (stop < end) {
        // Prefer to break after whitespace, so the pieces read naturally.
        let back = stop;
        while (back > i + 1 && !/\s/.test(this.source[back - 1])) {
          back--;
        }
        if (back > i + 1) {
          stop = back;
        }
        // Never split a CRLF pair.
        if (this.source[stop - 1] === '\r' && this.source[stop] === '\n') {
          stop++;
        }
      }
      this.push(i, stop, type);
      i = stop;
    }
  }

  finish(): Chunk[] {
    if (this.cursor !== this.source.length) {
      throw new Error(
        `chunker: chunks cover ${this.cursor} of ${this.source.length} characters. ` +
          'This is a bug; content integrity would be at risk.'
      );
    }
    return this.chunks;
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Split `text` into undoable insertion units.
 *
 * @param text      Exact source text. Callers should already have normalised line
 *                  endings to the destination document's EOL (see `insertionEngine`).
 * @param mode      Granularity.
 * @param options   Language hints and the chunk-count safety limit.
 */
export function chunkText(text: string, mode: InsertionMode, options: ChunkOptions = {}): Chunk[] {
  if (text.length === 0) {
    return [];
  }

  let chunks: Chunk[];
  switch (mode) {
    case 'character':
      chunks = chunkByCharacter(text);
      break;
    case 'word':
      chunks = chunkByWord(text);
      break;
    case 'line':
      chunks = chunkByLine(text);
      break;
    case 'smart':
      chunks = chunkSmart(text, getLanguageSyntax(options.languageId, options.languageAware ?? true));
      break;
    default:
      // Unknown mode from a corrupted setting: fail safe, do not lose content.
      chunks = chunkByWord(text);
      break;
  }

  assertChunksCoverText(chunks, text);

  const limit = options.maxChunks ?? 0;
  if (limit > 0 && chunks.length > limit) {
    chunks = mergeToLimit(chunks, limit);
    assertChunksCoverText(chunks, text);
  }
  return chunks;
}

/** Re-join chunks. Should always equal the original source. */
export function chunksToText(chunks: readonly Chunk[]): string {
  return chunks.map((c) => c.text).join('');
}

/**
 * Throw if the chunk list does not tile the source exactly.
 *
 * Cheap (O(n) over chunks, one string comparison) and run on every insertion, because
 * silently corrupting a user's file is the worst thing this extension could do.
 */
export function assertChunksCoverText(chunks: readonly Chunk[], text: string): void {
  let expected = 0;
  for (const c of chunks) {
    if (c.startOffset !== expected) {
      throw new Error(`chunker: gap or overlap at offset ${c.startOffset} (expected ${expected}).`);
    }
    if (c.endOffset !== c.startOffset + c.text.length) {
      throw new Error(`chunker: chunk offsets disagree with chunk text at ${c.startOffset}.`);
    }
    expected = c.endOffset;
  }
  if (expected !== text.length) {
    throw new Error(`chunker: chunks cover ${expected} of ${text.length} characters.`);
  }
  if (chunksToText(chunks) !== text) {
    throw new Error('chunker: rejoined chunks do not equal the source text.');
  }
}

/* -------------------------------------------------------------------------- */
/* Character mode                                                              */
/* -------------------------------------------------------------------------- */

const graphemeSegmenter: Intl.Segmenter | undefined = (() => {
  try {
    return new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  } catch {
    return undefined;
  }
})();

/**
 * One user-perceived character per chunk.
 *
 * Uses `Intl.Segmenter` where available so emoji (including ZWJ sequences and skin-tone
 * modifiers), combining accents and CRLF pairs are never split apart. Falls back to a
 * code-point walk that still keeps surrogate pairs, combining marks and CRLF together.
 */
export function chunkByCharacter(text: string): Chunk[] {
  const b = new ChunkBuilder(text);
  if (graphemeSegmenter) {
    for (const seg of graphemeSegmenter.segment(text)) {
      const start = seg.index;
      b.push(start, start + seg.segment.length, classifyCharacter(seg.segment));
    }
    return b.finish();
  }

  let i = 0;
  while (i < text.length) {
    let end = i + charSize(text, i);
    if (text[i] === '\r' && text[end] === '\n') {
      end++;
    } else {
      // Absorb trailing combining marks.
      while (end < text.length && /\p{M}/u.test(text[end])) {
        end += charSize(text, end);
      }
    }
    b.push(i, end, classifyCharacter(text.slice(i, end)));
    i = end;
  }
  return b.finish();
}

function charSize(text: string, i: number): number {
  const code = text.codePointAt(i);
  return code !== undefined && code > 0xffff ? 2 : 1;
}

function classifyCharacter(s: string): ChunkType {
  if (s === '\n' || s === '\r' || s === '\r\n') {
    return 'newline';
  }
  return 'character';
}

/* -------------------------------------------------------------------------- */
/* Word mode                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Split on transitions between three character classes - word, horizontal whitespace,
 * and everything else - with line breaks always forming their own chunk.
 *
 * `foo.bar(baz);` becomes `foo` `.` `bar` `(` `baz` `);`
 * (the trailing `);` is one chunk because both characters are in the "other" class).
 */
export function chunkByWord(text: string): Chunk[] {
  const b = new ChunkBuilder(text);
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '\r' || ch === '\n') {
      const end = ch === '\r' && text[i + 1] === '\n' ? i + 2 : i + 1;
      b.push(i, end, 'newline');
      i = end;
      continue;
    }

    if (HORIZONTAL_WS.test(ch)) {
      let end = i;
      while (end < text.length && HORIZONTAL_WS.test(text[end])) {
        end++;
      }
      b.push(i, end, isLineStart(text, i) ? 'indentation' : 'whitespace');
      i = end;
      continue;
    }

    if (isWordChar(text, i)) {
      let end = i;
      while (end < text.length && isWordChar(text, end)) {
        end += charSize(text, end);
      }
      b.push(i, end, classifyWord(text.slice(i, end)));
      i = end;
      continue;
    }

    // Run of adjacent punctuation/operator characters.
    let end = i;
    while (
      end < text.length &&
      !isWordChar(text, end) &&
      !HORIZONTAL_WS.test(text[end]) &&
      text[end] !== '\n' &&
      text[end] !== '\r'
    ) {
      end += charSize(text, end);
    }
    b.push(i, end, 'punctuation');
    i = end;
  }
  return b.finish();
}

function isWordChar(text: string, i: number): boolean {
  const ch = text[i];
  return WORD_CHAR.test(ch) || ch === '_' || ch === '$';
}

function isLineStart(text: string, i: number): boolean {
  return i === 0 || text[i - 1] === '\n' || text[i - 1] === '\r';
}

function classifyWord(word: string): ChunkType {
  if (DIGIT.test(word[0])) {
    return 'number';
  }
  if (KEYWORDS.has(word)) {
    return 'keyword';
  }
  return 'word';
}

/* -------------------------------------------------------------------------- */
/* Line mode                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One chunk per logical line, including that line's terminator. A trailing final line
 * without a terminator is its own chunk.
 */
export function chunkByLine(text: string): Chunk[] {
  const b = new ChunkBuilder(text);
  let i = 0;
  let lineStart = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') {
      const end = ch === '\r' && text[i + 1] === '\n' ? i + 2 : i + 1;
      const body = text.slice(lineStart, i);
      b.push(lineStart, end, body.trim().length === 0 ? 'blank-line' : 'line');
      i = end;
      lineStart = end;
      continue;
    }
    i++;
  }
  if (lineStart < text.length) {
    const body = text.slice(lineStart);
    b.push(lineStart, text.length, body.trim().length === 0 ? 'blank-line' : 'line');
  }
  return b.finish();
}

/* -------------------------------------------------------------------------- */
/* Smart mode                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Language-aware lexical chunking.
 *
 * This is a scanner, not a parser. It recognises indentation, blank lines, comments,
 * string literals, numbers, identifiers/keywords, multi-character operators and
 * punctuation, and applies two grouping rules that make the result read like a person
 * typing rather than like a token dump:
 *
 *   1. A word-like token absorbs directly adjacent trailing punctuation
 *      (`hello` + `():` -> `hello():`), up to 4 characters.
 *   2. A run of adjacent closing punctuation groups together (`}` + `;` -> `};`).
 *
 * Strings and comments stay intact as single units unless they exceed
 * {@link MAX_ATOMIC_CHUNK}, in which case they are split at whitespace.
 */
export function chunkSmart(text: string, syntax: LanguageSyntax): Chunk[] {
  const b = new ChunkBuilder(text);
  let i = 0;

  while (i < text.length) {
    // --- line breaks -------------------------------------------------------
    const ch = text[i];
    if (ch === '\n' || ch === '\r') {
      const end = ch === '\r' && text[i + 1] === '\n' ? i + 2 : i + 1;
      // A terminator sitting at the start of a line means that line was empty.
      b.push(i, end, isLineStart(text, i) ? 'blank-line' : 'newline');
      i = end;
      continue;
    }

    // --- indentation and blank lines --------------------------------------
    if (isLineStart(text, i) && HORIZONTAL_WS.test(ch)) {
      let end = i;
      while (end < text.length && HORIZONTAL_WS.test(text[end])) {
        end++;
      }
      const next = text[end];
      if (end >= text.length || next === '\n' || next === '\r') {
        // Whitespace-only line: keep the whitespace and its terminator together.
        let stop = end;
        if (next === '\r' && text[end + 1] === '\n') {
          stop = end + 2;
        } else if (next === '\n' || next === '\r') {
          stop = end + 1;
        }
        b.push(i, stop, 'blank-line');
        i = stop;
      } else {
        b.push(i, end, 'indentation');
        i = end;
      }
      continue;
    }

    // --- inline whitespace -------------------------------------------------
    if (HORIZONTAL_WS.test(ch)) {
      let end = i;
      while (end < text.length && HORIZONTAL_WS.test(text[end])) {
        end++;
      }
      b.push(i, end, 'whitespace');
      i = end;
      continue;
    }

    // --- comments ----------------------------------------------------------
    const comment = matchComment(text, i, syntax);
    if (comment !== undefined) {
      b.pushAtomic(i, comment, 'comment');
      i = comment;
      continue;
    }

    // --- string literals ---------------------------------------------------
    const str = matchString(text, i, syntax);
    if (str !== undefined) {
      b.pushAtomic(i, str, 'string');
      i = str;
      continue;
    }

    // --- numbers -----------------------------------------------------------
    const num = matchNumber(text, i);
    if (num !== undefined) {
      const end = absorbTrailingPunctuation(text, num, syntax);
      b.push(i, end, 'number');
      i = end;
      continue;
    }

    // --- identifiers / keywords -------------------------------------------
    if (isWordChar(text, i)) {
      let end = i;
      while (end < text.length && isWordChar(text, end)) {
        end += charSize(text, end);
      }
      const word = text.slice(i, end);
      const withPunct = absorbTrailingPunctuation(text, end, syntax);
      b.push(i, withPunct, KEYWORDS.has(word) ? 'keyword' : 'identifier');
      i = withPunct;
      continue;
    }

    // --- multi-character operators ----------------------------------------
    const op = matchOperator(text, i, syntax);
    if (op !== undefined) {
      b.push(i, op, 'operator');
      i = op;
      continue;
    }

    // --- runs of closing punctuation --------------------------------------
    if (CLOSERS.includes(ch)) {
      let end = i;
      while (end < text.length && end - i < ABSORB_MAX && CLOSERS.includes(text[end])) {
        end++;
      }
      b.push(i, end, 'punctuation');
      i = end;
      continue;
    }

    // --- anything else: one character --------------------------------------
    const size = charSize(text, i);
    b.push(i, i + size, 'punctuation');
    i += size;
  }

  return b.finish();
}

/**
 * Extend `end` over directly adjacent trailing punctuation, so `hello` + `():` becomes
 * one chunk. Stops at anything that could open a string or a comment, so the string and
 * comment scanners always get first refusal on those characters.
 */
function absorbTrailingPunctuation(text: string, end: number, syntax: LanguageSyntax): number {
  let out = end;
  while (out < text.length && out - end < ABSORB_MAX && ABSORBABLE.includes(text[out])) {
    if (matchComment(text, out, syntax) !== undefined || matchString(text, out, syntax) !== undefined) {
      break;
    }
    out++;
  }
  return out;
}

/** End offset of a comment starting at `i`, or `undefined` if there is none. */
function matchComment(text: string, i: number, syntax: LanguageSyntax): number | undefined {
  for (const open of syntax.lineComments) {
    if (text.startsWith(open, i)) {
      let end = i;
      while (end < text.length && text[end] !== '\n' && text[end] !== '\r') {
        end++;
      }
      return end;
    }
  }
  for (const [open, close] of syntax.blockComments) {
    if (text.startsWith(open, i)) {
      const found = text.indexOf(close, i + open.length);
      return found === -1 ? text.length : found + close.length;
    }
  }
  return undefined;
}

/** End offset of a string literal starting at `i`, or `undefined` if there is none. */
function matchString(text: string, i: number, syntax: LanguageSyntax): number | undefined {
  for (const d of syntax.strings) {
    if (!text.startsWith(d.open, i)) {
      continue;
    }
    let p = i + d.open.length;
    while (p < text.length) {
      const c = text[p];
      if (d.escapes && c === '\\') {
        p += 2;
        continue;
      }
      if (!d.multiline && (c === '\n' || c === '\r')) {
        // Unterminated single-line literal: stop at the line break rather than
        // swallowing the rest of the file.
        return p;
      }
      if (text.startsWith(d.close, p)) {
        return p + d.close.length;
      }
      p += charSize(text, p);
    }
    return text.length;
  }
  return undefined;
}

/** End offset of a numeric literal starting at `i`, or `undefined`. */
function matchNumber(text: string, i: number): number | undefined {
  if (!DIGIT.test(text[i])) {
    return undefined;
  }
  let end = i;
  // Hex / binary / octal prefixes.
  if (text[i] === '0' && /[xXbBoO]/.test(text[i + 1] ?? '')) {
    end = i + 2;
    while (end < text.length && /[0-9a-fA-F_]/.test(text[end])) {
      end++;
    }
  } else {
    while (end < text.length && /[0-9_]/.test(text[end])) {
      end++;
    }
    if (text[end] === '.' && DIGIT.test(text[end + 1] ?? '')) {
      end++;
      while (end < text.length && /[0-9_]/.test(text[end])) {
        end++;
      }
    }
    if (/[eE]/.test(text[end] ?? '') && /[0-9+-]/.test(text[end + 1] ?? '')) {
      end += 2;
      while (end < text.length && DIGIT.test(text[end])) {
        end++;
      }
    }
  }
  // Type suffixes: 10u, 3.5f, 100L, 1_000i64, 5n.
  while (end < text.length && /[a-zA-Z_0-9]/.test(text[end])) {
    end++;
  }
  return end;
}

/** End offset of a multi-character operator starting at `i`, or `undefined`. */
function matchOperator(text: string, i: number, syntax: LanguageSyntax): number | undefined {
  let best: number | undefined;
  for (const op of syntax.operators) {
    if (text.startsWith(op, i) && (best === undefined || op.length > best - i)) {
      best = i + op.length;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Chunk-count limiting                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Merge adjacent chunks until there are at most `limit` of them.
 *
 * Used as a safety valve for very large inputs: it keeps insertions responsive and
 * keeps a single insertion from evicting the user's older undo history. Content is
 * never altered - only the boundaries between undo steps become coarser.
 */
export function mergeToLimit(chunks: readonly Chunk[], limit: number): Chunk[] {
  if (limit <= 0 || chunks.length <= limit) {
    return [...chunks];
  }
  const groupSize = Math.ceil(chunks.length / limit);
  const out: Chunk[] = [];
  for (let i = 0; i < chunks.length; i += groupSize) {
    const group = chunks.slice(i, i + groupSize);
    const first = group[0];
    const last = group[group.length - 1];
    const type = group.every((c) => c.type === first.type) ? first.type : 'other';
    out.push({
      text: group.map((c) => c.text).join(''),
      type,
      startOffset: first.startOffset,
      endOffset: last.endOffset
    });
  }
  return out;
}
