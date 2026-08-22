/**
 * The insertion engine.
 *
 * Applies a chunk list to an editor as a sequence of `TextEditor.edit()` calls, each
 * carrying its own undo stop, so that VS Code's native Ctrl+Z / Ctrl+Y walks the
 * insertion one chunk at a time. See `docs/UNDO-BEHAVIOR.md` for the measurements that
 * justify every decision in this file.
 *
 * Three rules this file exists to enforce:
 *
 *   1. CONTENT IS NEVER ALTERED. The only transformation applied is line-ending
 *      normalisation to the destination document's EOL, which VS Code's own paste does
 *      too and which is *required* for correctness (see `normaliseEol`). After every
 *      edit the engine re-reads the affected range and compares it to the chunk.
 *   2. UNDO IS NATIVE. No custom undo stack, no `Ctrl+Z` interception. Chunks are
 *      applied with `{ undoStopBefore: true }`, which the POC proved is what creates a
 *      separate undo element.
 *   3. CANCELLATION NEVER DESTROYS WORK. Cancelling stops future chunks. Text already
 *      inserted stays in the document, exactly as if the user had stopped typing.
 */
import * as vscode from 'vscode';
import { assertChunksCoverText, chunkText } from './chunker';
import { errorMessage } from './clipboard';
import {
  Chunk,
  HumanTypeConfig,
  InsertionOutcome,
  InsertionProgress
} from './types';
import { normaliseEolTo } from './textUtils';

/** How often the editor scrolls to follow the insertion point, in milliseconds. */
const REVEAL_INTERVAL_MS = 120;

export interface InsertionRequest {
  readonly editor: vscode.TextEditor;
  readonly text: string;
  readonly config: HumanTypeConfig;
  readonly onProgress?: (progress: InsertionProgress) => void;
}

/**
 * Normalise line endings to `eol`.
 *
 * CRITICAL. `TextEditorEdit.insert()` rewrites the inserted text's line endings to the
 * document's EOL, so on a CRLF document a one-character "\n" grows the document by two
 * characters. Without this step the engine's offset arithmetic drifts and the remaining
 * chunks land in the wrong places - silent corruption, reproduced by POC test `H`.
 *
 * Doing it up front means `chunk.text.length` always equals the document's growth.
 */
export function normaliseEol(text: string, eol: vscode.EndOfLine): string {
  return normaliseEolTo(text, eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
}

/** The document range the insertion will consume, and where the caret ends up. */
interface Target {
  /** Range replaced by the first chunk, or `undefined` to insert without replacing. */
  readonly replaceRange: vscode.Range | undefined;
  /** Document offset at which the inserted text begins. */
  readonly startOffset: number;
}

function resolveTarget(editor: vscode.TextEditor, config: HumanTypeConfig): Target {
  const selection = editor.selection;
  if (selection.isEmpty) {
    return { replaceRange: undefined, startOffset: editor.document.offsetAt(selection.active) };
  }
  if (config.replaceSelection) {
    return {
      replaceRange: new vscode.Range(selection.start, selection.end),
      startOffset: editor.document.offsetAt(selection.start)
    };
  }
  return { replaceRange: undefined, startOffset: editor.document.offsetAt(selection.end) };
}

export class InsertionEngine implements vscode.Disposable {
  private running = false;
  private cancelRequested = false;
  private lastReveal = 0;

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Request that the current insertion stop.
   *
   * Already-inserted text is deliberately left in place. Reverting it would either
   * require a destructive edit the user did not ask for, or a batch undo that would
   * defeat the point of the extension. The user can press Ctrl+Z to step back through
   * whatever was inserted, one chunk at a time.
   */
  cancel(): void {
    if (this.running) {
      this.cancelRequested = true;
    }
  }

  /** Split `text` the way {@link insert} would, without touching any document. */
  planChunks(text: string, languageId: string | undefined, config: HumanTypeConfig): Chunk[] {
    return chunkText(text, config.mode, {
      languageId,
      languageAware: config.smartChunking,
      maxChunks: config.maxChunks
    });
  }

  async insert(request: InsertionRequest): Promise<InsertionOutcome> {
    if (this.running) {
      return { status: 'failed', reason: 'An insertion is already running.', chunks: 0, characters: 0 };
    }

    const { editor, config, onProgress } = request;
    const document = editor.document;

    if (document.isClosed) {
      return { status: 'failed', reason: 'The target document has been closed.', chunks: 0, characters: 0 };
    }

    const text = normaliseEol(request.text, document.eol);
    if (text.length === 0) {
      return { status: 'completed', chunks: 0, characters: 0 };
    }

    let chunks: Chunk[];
    try {
      chunks = this.planChunks(text, document.languageId, config);
      // Belt and braces: the chunker asserts this too, but a corrupted chunk list is
      // the one failure mode that would damage a user's file, so it is checked here
      // as well before a single character is written.
      assertChunksCoverText(chunks, text);
    } catch (err) {
      return {
        status: 'failed',
        reason: `Could not split the text safely, so nothing was inserted: ${errorMessage(err)}`,
        chunks: 0,
        characters: 0
      };
    }

    this.running = true;
    this.cancelRequested = false;
    this.lastReveal = 0;

    const target = resolveTarget(editor, config);
    let offset = target.startOffset;
    let chunksDone = 0;
    let charactersDone = 0;

    try {
      for (let index = 0; index < chunks.length; index++) {
        if (this.cancelRequested) {
          return { status: 'cancelled', chunks: chunksDone, characters: charactersDone };
        }
        if (document.isClosed) {
          return {
            status: 'failed',
            reason: 'The document was closed while text was being inserted.',
            chunks: chunksDone,
            characters: charactersDone
          };
        }

        const chunk = chunks[index];
        const isFirst = index === 0;
        const isLast = index === chunks.length - 1;
        const replaceRange = isFirst ? target.replaceRange : undefined;
        const insertPosition = document.positionAt(offset);

        let applied: boolean;
        try {
          applied = await editor.edit(
            (builder) => {
              if (replaceRange) {
                builder.replace(replaceRange, chunk.text);
              } else {
                builder.insert(insertPosition, chunk.text);
              }
            },
            {
              // Proven by POC finding 2: `undoStopBefore` is what opens a new undo
              // element. A stop after the final chunk keeps whatever the user does
              // next out of the last chunk's undo step.
              undoStopBefore: true,
              undoStopAfter: isLast
            }
          );
        } catch (err) {
          return {
            status: 'failed',
            reason: `The editor stopped accepting edits: ${errorMessage(err)}`,
            chunks: chunksDone,
            characters: charactersDone
          };
        }

        if (!applied) {
          return {
            status: 'failed',
            reason:
              'The editor rejected the edit. The document may be read-only, or another ' +
              'extension may have changed it at the same moment.',
            chunks: chunksDone,
            characters: charactersDone
          };
        }

        // Integrity check: confirm the chunk landed exactly where it was aimed. This
        // catches EOL drift, concurrent edits from other extensions, and any future
        // regression in the offset arithmetic - cheaply, since it reads one chunk's
        // worth of text rather than the whole document.
        const landed = document.getText(
          new vscode.Range(document.positionAt(offset), document.positionAt(offset + chunk.text.length))
        );
        if (landed !== chunk.text) {
          return {
            status: 'failed',
            reason:
              'The document changed unexpectedly during insertion, so Human Type stopped ' +
              'to avoid corrupting it. Press Ctrl+Z to undo the partial insertion.',
            chunks: chunksDone,
            characters: charactersDone
          };
        }

        offset += chunk.text.length;
        chunksDone++;
        charactersDone += chunk.text.length;

        this.updateCaret(editor, offset, config);
        onProgress?.({
          chunksDone,
          chunksTotal: chunks.length,
          charactersDone,
          charactersTotal: text.length
        });

        if (config.delayMs > 0 && !isLast) {
          await delay(config.delayMs);
        }
      }

      return { status: 'completed', chunks: chunksDone, characters: charactersDone };
    } finally {
      this.running = false;
      this.cancelRequested = false;
    }
  }

  /**
   * Keep the insertion point in view.
   *
   * Note what this does NOT do: it does not decide whether the caret moves. VS Code
   * advances the caret past text inserted at its own position regardless - that is
   * native editing behaviour, confirmed by integration test `the caret advances with
   * inserted text even when following is disabled`. What this method adds is the
   * explicit re-sync (so a stray click mid-insertion does not strand the caret) and
   * the scrolling that keeps the insertion point on screen.
   *
   * `revealRange` is throttled because it forces a layout; the selection assignment is
   * cheap enough to run every chunk.
   */
  private updateCaret(editor: vscode.TextEditor, offset: number, config: HumanTypeConfig): void {
    if (!config.followInsertionPoint) {
      return;
    }
    try {
      const position = editor.document.positionAt(offset);
      editor.selection = new vscode.Selection(position, position);
      const now = Date.now();
      if (now - this.lastReveal >= REVEAL_INTERVAL_MS) {
        this.lastReveal = now;
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.Default
        );
      }
    } catch {
      // The editor went away mid-insertion; the next loop iteration reports it properly.
    }
  }

  dispose(): void {
    this.cancel();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
