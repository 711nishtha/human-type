import * as assert from 'assert';
import { decodeEscapes, normaliseEolTo } from '../../src/textUtils';

suite('textUtils: normaliseEolTo', () => {
  test('converts every line-ending style to LF', () => {
    assert.strictEqual(normaliseEolTo('a\r\nb\rc\nd', '\n'), 'a\nb\nc\nd');
  });

  test('converts every line-ending style to CRLF', () => {
    assert.strictEqual(normaliseEolTo('a\r\nb\rc\nd', '\r\n'), 'a\r\nb\r\nc\r\nd');
  });

  test('does not double-convert an already-CRLF string', () => {
    assert.strictEqual(normaliseEolTo('a\r\nb\r\n', '\r\n'), 'a\r\nb\r\n');
  });

  test('leaves text without line breaks untouched', () => {
    assert.strictEqual(normaliseEolTo('no breaks here', '\r\n'), 'no breaks here');
  });

  test('preserves blank lines', () => {
    assert.strictEqual(normaliseEolTo('a\n\n\nb', '\r\n'), 'a\r\n\r\n\r\nb');
  });

  test('changes nothing except line endings', () => {
    const src = '\tif (x) { /* 🌍 你好 */ }\n';
    assert.strictEqual(normaliseEolTo(src, '\n'), src);
    assert.strictEqual(normaliseEolTo(src, '\r\n').replace(/\r\n/g, '\n'), src);
  });

  test('is idempotent', () => {
    const once = normaliseEolTo('a\rb\nc\r\nd', '\r\n');
    assert.strictEqual(normaliseEolTo(once, '\r\n'), once);
  });
});

suite('textUtils: decodeEscapes', () => {
  test('decodes the supported escapes', () => {
    assert.strictEqual(decodeEscapes('a\\nb'), 'a\nb');
    assert.strictEqual(decodeEscapes('a\\tb'), 'a\tb');
    assert.strictEqual(decodeEscapes('a\\rb'), 'a\rb');
    assert.strictEqual(decodeEscapes('a\\\\b'), 'a\\b');
  });

  test('leaves unknown escapes alone so paths and regexes survive', () => {
    assert.strictEqual(decodeEscapes('C:\\Users\\dev'), 'C:\\Users\\dev');
    assert.strictEqual(decodeEscapes('\\d+\\s*'), '\\d+\\s*');
  });

  test('a trailing backslash is kept verbatim', () => {
    assert.strictEqual(decodeEscapes('end\\'), 'end\\');
  });

  test('an escaped backslash is not re-interpreted', () => {
    assert.strictEqual(decodeEscapes('\\\\n'), '\\n');
  });

  test('text without backslashes is returned unchanged', () => {
    assert.strictEqual(decodeEscapes('console.log("hi");'), 'console.log("hi");');
  });

  test('handles the empty string', () => {
    assert.strictEqual(decodeEscapes(''), '');
  });
});
