/*!
 * Human Type - Granular, human-like text insertion for VS Code.
 * Copyright (c) 2026 Nishtha Sharma. All rights reserved.
 * Licensed under the terms in LICENSE. Redistribution is not permitted.
 */
/**
 * Round-trips the real fixture files through every mode.
 *
 * The chunker suite uses inline samples; this one uses actual files read from disk, so
 * encodings, trailing newlines and whatever an editor did to those files on the way in
 * are all part of the test.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { chunkText, chunksToText } from '../../src/chunker';
import { InsertionMode } from '../../src/types';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'test', 'fixtures');
const MODES: InsertionMode[] = ['character', 'word', 'line', 'smart'];

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.py': 'python',
  '.c': 'c',
  '.ts': 'typescript',
  '.go': 'go',
  '.sql': 'sql',
  '.md': 'markdown',
  '.txt': 'plaintext'
};

suite('fixtures: real files survive every mode', () => {
  const files = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES) : [];

  test('the fixture directory is present and populated', () => {
    assert.ok(files.length >= 8, `expected fixtures in ${FIXTURES}, found ${files.length}`);
  });

  for (const file of files) {
    for (const mode of MODES) {
      test(`${file} in ${mode} mode`, function () {
        this.timeout(30000);
        const full = path.join(FIXTURES, file);
        const text = fs.readFileSync(full, 'utf8');
        const languageId = LANGUAGE_BY_EXT[path.extname(file)];
        const chunks = chunkText(text, mode, { languageId, maxChunks: 5000 });

        assert.strictEqual(chunksToText(chunks), text, `${file} was altered by ${mode} mode`);
        assert.ok(chunks.every((c) => c.text.length > 0), 'produced an empty chunk');
      });
    }
  }

  test('smart mode keeps the Python docstring in one piece', () => {
    const text = fs.readFileSync(path.join(FIXTURES, 'sample.py'), 'utf8');
    const chunks = chunkText(text, 'smart', { languageId: 'python' });
    assert.ok(
      chunks.some((c) => c.type === 'string' && c.text.includes('Sample module')),
      'the module docstring was not recognised as a string'
    );
  });

  test('smart mode keeps the SQL escaped quote intact', () => {
    const text = fs.readFileSync(path.join(FIXTURES, 'sample.sql'), 'utf8');
    const chunks = chunkText(text, 'smart', { languageId: 'sql' });
    assert.strictEqual(chunksToText(chunks), text);
    assert.ok(chunks.some((c) => c.type === 'comment' && c.text.startsWith('--')));
  });

  test('the large fixture stays within the chunk cap in every mode', () => {
    const text = fs.readFileSync(path.join(FIXTURES, 'large.txt'), 'utf8');
    for (const mode of MODES) {
      const chunks = chunkText(text, mode, { maxChunks: 1000 });
      assert.ok(chunks.length <= 1000, `${mode}: ${chunks.length} chunks`);
      assert.strictEqual(chunksToText(chunks), text);
    }
  });
});
