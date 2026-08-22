/*!
 * Human Type - Granular, human-like text insertion for VS Code.
 * Copyright (c) 2026 Nishtha Sharma. All rights reserved.
 * Licensed under the terms in LICENSE. Redistribution is not permitted.
 */
/**
 * Small, deterministic syntax tables used by Smart mode.
 *
 * This is deliberately NOT a parser. It is a lexical description that is good enough
 * to keep strings and comments together as single undo units, and to avoid splitting
 * multi-character operators down the middle. Unknown languages fall back to
 * {@link GENERIC_SYNTAX}, which still produces sensible chunks.
 *
 * No `vscode` import: this module is unit-testable in plain Node.
 */

export interface StringDelimiter {
  /** Opening delimiter, e.g. `"` or `"""` or `` ` ``. */
  readonly open: string;
  /** Closing delimiter. Usually identical to `open`. */
  readonly close: string;
  /** Whether a backslash escapes the next character inside the literal. */
  readonly escapes: boolean;
  /** Whether the literal may span multiple lines. */
  readonly multiline: boolean;
}

export interface LanguageSyntax {
  /** Line-comment introducers, longest first. */
  readonly lineComments: readonly string[];
  /** Block-comment `[open, close]` pairs. */
  readonly blockComments: readonly (readonly [string, string])[];
  /** String/character literal delimiters, longest `open` first. */
  readonly strings: readonly StringDelimiter[];
  /** Multi-character operators, longest first. */
  readonly operators: readonly string[];
  /** Extra characters that count as part of an identifier beyond letters/digits. */
  readonly identifierExtras: string;
}

const C_OPERATORS = [
  '>>>=', '<<=', '>>=', '...', '===', '!==', '**=', '&&=', '||=', '??=', '<=>',
  '->', '=>', '::', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '??', '?.', '|>', ':=', '<-'
] as const;

const dq = (multiline = false): StringDelimiter => ({
  open: '"', close: '"', escapes: true, multiline
});
const sq = (multiline = false): StringDelimiter => ({
  open: "'", close: "'", escapes: true, multiline
});

export const GENERIC_SYNTAX: LanguageSyntax = {
  lineComments: ['//', '#'],
  blockComments: [['/*', '*/']],
  strings: [dq(), sq(), { open: '`', close: '`', escapes: true, multiline: true }],
  operators: C_OPERATORS,
  identifierExtras: '_$'
};

const C_LIKE: LanguageSyntax = {
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  strings: [dq(), sq()],
  operators: C_OPERATORS,
  identifierExtras: '_'
};

const JS_LIKE: LanguageSyntax = {
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  strings: [dq(), sq(), { open: '`', close: '`', escapes: true, multiline: true }],
  operators: C_OPERATORS,
  identifierExtras: '_$'
};

const PYTHON: LanguageSyntax = {
  lineComments: ['#'],
  blockComments: [],
  strings: [
    { open: '"""', close: '"""', escapes: true, multiline: true },
    { open: "'''", close: "'''", escapes: true, multiline: true },
    dq(),
    sq()
  ],
  operators: ['**=', '//=', '>>=', '<<=', '...', '->', '==', '!=', '<=', '>=', '**', '//',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', ':='],
  identifierExtras: '_'
};

const SHELL_LIKE: LanguageSyntax = {
  lineComments: ['#'],
  blockComments: [],
  strings: [dq(true), sq(true)],
  operators: ['&&', '||', '>>', '<<', '==', '!=', '<=', '>=', '=~'],
  identifierExtras: '_'
};

const HTML_LIKE: LanguageSyntax = {
  lineComments: [],
  blockComments: [['<!--', '-->']],
  strings: [dq(), sq()],
  operators: ['</', '/>', '<!'],
  identifierExtras: '_-:'
};

const CSS_LIKE: LanguageSyntax = {
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  strings: [dq(), sq()],
  operators: ['::', '>=', '<=', '~=', '|=', '^=', '$=', '*='],
  identifierExtras: '_-#.%@'
};

const SQL: LanguageSyntax = {
  lineComments: ['--'],
  blockComments: [['/*', '*/']],
  // Single quotes are string literals; double quotes are quoted identifiers. Both are
  // treated as atomic units, which is the behaviour we want either way.
  strings: [sq(), dq()],
  operators: ['<>', '!=', '<=', '>=', '||', '::'],
  identifierExtras: '_$#@'
};

const JSON_LIKE: LanguageSyntax = {
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  strings: [dq()],
  operators: [],
  identifierExtras: '_-'
};

const MARKDOWN: LanguageSyntax = {
  lineComments: [],
  blockComments: [['<!--', '-->']],
  // Backtick spans hold code; keeping them atomic reads better than splitting them.
  strings: [{ open: '```', close: '```', escapes: false, multiline: true },
            { open: '`', close: '`', escapes: false, multiline: false }],
  operators: ['**', '__', '~~', '](', '!['],
  identifierExtras: "_'-"
};

const YAML_LIKE: LanguageSyntax = {
  lineComments: ['#'],
  blockComments: [],
  strings: [dq(), sq()],
  operators: ['---', '...'],
  identifierExtras: '_-.'
};

const LISP_LIKE: LanguageSyntax = {
  lineComments: [';'],
  blockComments: [],
  strings: [dq(true)],
  operators: ["#'", '#(', ',@'],
  identifierExtras: '_-*+!?<>=/'
};

/** VS Code `languageId` -> syntax table. */
const LANGUAGE_TABLE: ReadonlyMap<string, LanguageSyntax> = new Map<string, LanguageSyntax>([
  ['c', C_LIKE],
  ['cpp', C_LIKE],
  ['objective-c', C_LIKE],
  ['objective-cpp', C_LIKE],
  ['csharp', C_LIKE],
  ['java', C_LIKE],
  ['go', C_LIKE],
  ['rust', { ...C_LIKE, lineComments: ['///', '//!', '//'], operators: [...C_OPERATORS, '..=', '..'] }],
  ['swift', C_LIKE],
  ['kotlin', JS_LIKE],
  ['scala', C_LIKE],
  ['dart', C_LIKE],
  ['php', { ...JS_LIKE, lineComments: ['//', '#'], operators: [...C_OPERATORS, '=>', '->', '<=>'] }],
  ['javascript', JS_LIKE],
  ['javascriptreact', JS_LIKE],
  ['typescript', JS_LIKE],
  ['typescriptreact', JS_LIKE],
  ['vue', JS_LIKE],
  ['svelte', JS_LIKE],
  ['python', PYTHON],
  ['ruby', { ...PYTHON, operators: [...PYTHON.operators, '=>', '<=>', '&.'] }],
  ['perl', SHELL_LIKE],
  ['shellscript', SHELL_LIKE],
  ['powershell', { ...SHELL_LIKE, lineComments: ['#'], blockComments: [['<#', '#>']], identifierExtras: '_$:' }],
  ['dockerfile', SHELL_LIKE],
  ['makefile', SHELL_LIKE],
  ['ini', SHELL_LIKE],
  ['properties', SHELL_LIKE],
  ['html', HTML_LIKE],
  ['xml', HTML_LIKE],
  ['xsl', HTML_LIKE],
  ['handlebars', HTML_LIKE],
  ['css', CSS_LIKE],
  ['scss', CSS_LIKE],
  ['less', CSS_LIKE],
  ['sql', SQL],
  ['plsql', SQL],
  ['mysql', SQL],
  ['postgres', SQL],
  ['json', JSON_LIKE],
  ['jsonc', JSON_LIKE],
  ['json5', JSON_LIKE],
  ['markdown', MARKDOWN],
  ['yaml', YAML_LIKE],
  ['toml', YAML_LIKE],
  ['clojure', LISP_LIKE],
  ['lisp', LISP_LIKE],
  ['scheme', LISP_LIKE],
  ['lua', { ...C_LIKE, lineComments: ['--'], blockComments: [['--[[', ']]']], operators: ['...', '==', '~=', '<=', '>=', '..', '::'] }],
  ['haskell', { ...C_LIKE, lineComments: ['--'], blockComments: [['{-', '-}']], operators: ['->', '<-', '=>', '::', '++', '<>', '$!', '>>=', '>>', '<$>', '<*>'] }],
  ['r', SHELL_LIKE],
  ['julia', { ...PYTHON, lineComments: ['#'], blockComments: [['#=', '=#']] }],
  ['elixir', { ...PYTHON, operators: ['|>', '->', '=>', '<-', '++', '--', '==', '!=', '<=', '>=', '&&', '||', '::'] }],
  ['plaintext', { ...GENERIC_SYNTAX, lineComments: [], blockComments: [], strings: [], operators: [] }],
  ['log', { ...GENERIC_SYNTAX, lineComments: [], blockComments: [], strings: [], operators: [] }]
]);

/**
 * Resolve the syntax table for a language.
 *
 * Unknown languages return {@link GENERIC_SYNTAX} - Smart mode always works, it just
 * gets less precise. Passing `languageAware: false` forces the generic table.
 */
export function getLanguageSyntax(languageId?: string, languageAware = true): LanguageSyntax {
  if (!languageAware || !languageId) {
    return GENERIC_SYNTAX;
  }
  return LANGUAGE_TABLE.get(languageId) ?? GENERIC_SYNTAX;
}

/** True when a syntax table has a dedicated entry (used only for diagnostics/tests). */
export function isKnownLanguage(languageId: string): boolean {
  return LANGUAGE_TABLE.has(languageId);
}
