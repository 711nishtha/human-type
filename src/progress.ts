/*!
 * Human Type - Granular, human-like text insertion for VS Code.
 * Copyright (c) 2026 Nishtha Sharma. All rights reserved.
 * Licensed under the terms in LICENSE. Redistribution is not permitted.
 */
/**
 * Status-bar progress for a running insertion.
 *
 * Two rules drive the design:
 *   1. Never flicker. Short insertions finish before the item is ever shown.
 *   2. Never spam the UI. Redraws are throttled regardless of chunk rate, so a
 *      10,000-chunk insertion still performs one status-bar update per frame budget.
 */
import * as vscode from 'vscode';
import { InsertionProgress } from './types';

/** Insertions shorter than this never show any UI at all. */
const SHOW_AFTER_MS = 250;
/** Minimum interval between status-bar text updates. */
const REDRAW_INTERVAL_MS = 80;

export class ProgressReporter implements vscode.Disposable {
  private item: vscode.StatusBarItem | undefined;
  private showTimer: NodeJS.Timeout | undefined;
  private lastDraw = 0;
  private latest: InsertionProgress | undefined;
  private disposed = false;

  constructor(private readonly enabled: boolean) {}

  /** Begin tracking. The status-bar item appears only if the work outlives SHOW_AFTER_MS. */
  start(): void {
    if (!this.enabled || this.disposed) {
      return;
    }
    this.showTimer = setTimeout(() => {
      if (this.disposed) {
        return;
      }
      this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
      this.item.command = 'humanType.cancel';
      this.item.tooltip = 'Human Type is inserting text. Click (or press Escape) to cancel.';
      this.draw(true);
      this.item.show();
    }, SHOW_AFTER_MS);
  }

  report(progress: InsertionProgress): void {
    this.latest = progress;
    this.draw(false);
  }

  private draw(force: boolean): void {
    if (!this.item || !this.latest) {
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastDraw < REDRAW_INTERVAL_MS) {
      return;
    }
    this.lastDraw = now;
    const { chunksDone, chunksTotal, charactersDone, charactersTotal } = this.latest;
    const percent = charactersTotal > 0 ? Math.floor((charactersDone / charactersTotal) * 100) : 0;
    this.item.text = `$(keyboard) Human Type: ${percent}%  ($(close) cancel)`;
    this.item.tooltip =
      `Human Type is inserting text.\n` +
      `${chunksDone} / ${chunksTotal} chunks, ${charactersDone} / ${charactersTotal} characters.\n` +
      `Click here or press Escape in the editor to cancel.`;
  }

  dispose(): void {
    this.disposed = true;
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = undefined;
    }
    this.item?.dispose();
    this.item = undefined;
  }
}
