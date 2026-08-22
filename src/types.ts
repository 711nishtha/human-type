/*!
 * Human Type - Granular, human-like text insertion for VS Code.
 * Copyright (c) 2026 Nishtha Sharma. All rights reserved.
 * Licensed under the terms in LICENSE. Redistribution is not permitted.
 */
/**
 * Shared types for Human Type.
 *
 * This module is deliberately free of any `vscode` import so that the chunker and
 * its types can be unit-tested in plain Node without an Extension Host.
 */

/** How inserted text is split into undoable units. */
export type InsertionMode = 'character' | 'word' | 'line' | 'smart';

/** How fast chunks are applied. Completely independent of {@link InsertionMode}. */
export type InsertionSpeed = 'instant' | 'fast' | 'normal' | 'slow' | 'custom';

/**
 * Classification of a chunk. Purely informational: it drives nothing in the editing
 * path, but it makes the chunker testable and debuggable, and leaves room for future
 * per-type pacing.
 */
export type ChunkType =
  | 'character'
  | 'word'
  | 'identifier'
  | 'keyword'
  | 'number'
  | 'operator'
  | 'punctuation'
  | 'string'
  | 'comment'
  | 'indentation'
  | 'whitespace'
  | 'newline'
  | 'blank-line'
  | 'line'
  | 'other';

/**
 * One undoable insertion unit.
 *
 * INVARIANT: for a chunk list produced from `text`,
 *   `chunks.map(c => c.text).join('') === text`
 * and the chunks tile `[0, text.length)` contiguously with no gaps or overlaps.
 * This is enforced by {@link assertChunksCoverText} and asserted in the unit tests.
 */
export interface Chunk {
  /** The exact substring of the source this chunk inserts. Never modified. */
  readonly text: string;
  readonly type: ChunkType;
  /** Inclusive start offset into the source string (UTF-16 code units). */
  readonly startOffset: number;
  /** Exclusive end offset into the source string (UTF-16 code units). */
  readonly endOffset: number;
}

export interface ChunkOptions {
  /** VS Code `languageId` of the destination document, e.g. `"python"`. */
  readonly languageId?: string;
  /**
   * When false, Smart mode ignores language-specific syntax tables and uses generic
   * lexical rules only. Mirrors the `humanType.smartChunking` setting.
   */
  readonly languageAware?: boolean;
  /**
   * Upper bound on the number of chunks returned. When chunking produces more than
   * this, adjacent chunks are merged evenly until the count fits. `0` means unlimited.
   */
  readonly maxChunks?: number;
}

/** Resolved, validated user configuration. */
export interface HumanTypeConfig {
  readonly mode: InsertionMode;
  readonly speed: InsertionSpeed;
  /** Effective per-chunk delay in milliseconds, already resolved from `speed`/`delay`. */
  readonly delayMs: number;
  readonly smartChunking: boolean;
  readonly showProgress: boolean;
  readonly replaceSelection: boolean;
  readonly maxChunks: number;
  readonly largeInputThreshold: number;
  readonly followInsertionPoint: boolean;
}

/** Why an insertion stopped. */
export type InsertionOutcome =
  | { readonly status: 'completed'; readonly chunks: number; readonly characters: number }
  | { readonly status: 'cancelled'; readonly chunks: number; readonly characters: number }
  | { readonly status: 'failed'; readonly reason: string; readonly chunks: number; readonly characters: number };

/** Progress notification emitted by the insertion engine. */
export interface InsertionProgress {
  readonly chunksDone: number;
  readonly chunksTotal: number;
  readonly charactersDone: number;
  readonly charactersTotal: number;
}
