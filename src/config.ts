/*!
 * Human Type - Granular, human-like text insertion for VS Code.
 * Copyright (c) 2026 Nishtha Sharma. All rights reserved.
 * Licensed under the terms in LICENSE. Redistribution is not permitted.
 */
/**
 * Reads and validates the `humanType.*` settings.
 *
 * Every value is range-checked and falls back to the documented default when a user (or
 * a bad workspace settings file) supplies something invalid, so the extension can never
 * be put into a state where it refuses to run or misbehaves silently.
 */
import * as vscode from 'vscode';
import { HumanTypeConfig, InsertionMode, InsertionSpeed } from './types';

export const CONFIG_SECTION = 'humanType';

const MODES: readonly InsertionMode[] = ['character', 'word', 'line', 'smart'];
const SPEEDS: readonly InsertionSpeed[] = ['instant', 'fast', 'normal', 'slow', 'custom'];

/** Per-chunk delay in milliseconds for each named speed. */
export const SPEED_DELAYS: Readonly<Record<Exclude<InsertionSpeed, 'custom'>, number>> = {
  instant: 0,
  fast: 5,
  normal: 20,
  slow: 60
};

export const DEFAULTS: HumanTypeConfig = {
  mode: 'smart',
  speed: 'fast',
  delayMs: SPEED_DELAYS.fast,
  smartChunking: true,
  showProgress: true,
  replaceSelection: true,
  maxChunks: 5000,
  largeInputThreshold: 102400,
  followInsertionPoint: true
};

/** Problems found while reading settings, surfaced once per insertion. */
export interface ConfigDiagnostics {
  readonly warnings: readonly string[];
}

export interface ResolvedConfig {
  readonly config: HumanTypeConfig;
  readonly diagnostics: ConfigDiagnostics;
}

/**
 * Read the effective configuration for a document.
 *
 * Scoping to the document's URI means per-language and per-workspace-folder overrides
 * (`"[python]": { "humanType.mode": "line" }`) work as users expect.
 */
export function readConfig(scope?: vscode.Uri | vscode.TextDocument): ResolvedConfig {
  let target: vscode.ConfigurationScope | undefined;
  if (scope && 'uri' in scope) {
    // A TextDocument: scope by URI *and* language so per-language overrides such as
    // `"[markdown]": { "humanType.mode": "line" }` are honoured.
    target = { uri: scope.uri, languageId: scope.languageId };
  } else if (scope) {
    target = scope as vscode.Uri;
  }

  const raw = vscode.workspace.getConfiguration(CONFIG_SECTION, target);
  const warnings: string[] = [];

  const mode = pickEnum(raw.get<string>('mode'), MODES, DEFAULTS.mode, 'humanType.mode', warnings);
  const speed = pickEnum(raw.get<string>('speed'), SPEEDS, DEFAULTS.speed, 'humanType.speed', warnings);
  const customDelay = pickNumber(raw.get<number>('delay'), 0, 2000, DEFAULTS.delayMs, 'humanType.delay', warnings);

  return {
    config: {
      mode,
      speed,
      delayMs: speed === 'custom' ? customDelay : SPEED_DELAYS[speed],
      smartChunking: pickBoolean(raw.get<boolean>('smartChunking'), DEFAULTS.smartChunking),
      showProgress: pickBoolean(raw.get<boolean>('showProgress'), DEFAULTS.showProgress),
      replaceSelection: pickBoolean(raw.get<boolean>('replaceSelection'), DEFAULTS.replaceSelection),
      maxChunks: Math.round(
        pickNumber(raw.get<number>('maxChunks'), 1, 100000, DEFAULTS.maxChunks, 'humanType.maxChunks', warnings)
      ),
      largeInputThreshold: Math.round(
        pickNumber(
          raw.get<number>('largeInputThreshold'),
          0,
          Number.MAX_SAFE_INTEGER,
          DEFAULTS.largeInputThreshold,
          'humanType.largeInputThreshold',
          warnings
        )
      ),
      followInsertionPoint: pickBoolean(
        raw.get<boolean>('followInsertionPoint'),
        DEFAULTS.followInsertionPoint
      )
    },
    diagnostics: { warnings }
  };
}

function pickEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  name: string,
  warnings: string[]
): T {
  if (value === undefined) {
    return fallback;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  warnings.push(`${name}: "${value}" is not one of ${allowed.join(', ')}. Using "${fallback}".`);
  return fallback;
}

function pickNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
  name: string,
  warnings: string[]
): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    warnings.push(`${name}: expected a number. Using ${fallback}.`);
    return fallback;
  }
  if (value < min || value > max) {
    const clamped = Math.min(max, Math.max(min, value));
    warnings.push(`${name}: ${value} is outside ${min}-${max}. Using ${clamped}.`);
    return clamped;
  }
  return value;
}

function pickBoolean(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
