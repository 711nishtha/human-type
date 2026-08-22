/**
 * Clipboard access.
 *
 * Everything stays on the machine: `vscode.env.clipboard` is the only source, the value
 * is used for the current insertion and then dropped. Nothing is cached, logged, or sent
 * anywhere. See the Privacy section of the README.
 */
import * as vscode from 'vscode';

export type ClipboardResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/** Read the clipboard, converting the two expected failure shapes into a result. */
export async function readClipboard(): Promise<ClipboardResult> {
  let text: string;
  try {
    text = await vscode.env.clipboard.readText();
  } catch (err) {
    return {
      ok: false,
      reason: `Could not read the clipboard: ${errorMessage(err)}`
    };
  }
  if (text.length === 0) {
    return {
      ok: false,
      reason: 'The clipboard is empty, or holds content that is not text (an image, for example).'
    };
  }
  return { ok: true, text };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return String(err);
}
