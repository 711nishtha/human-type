/**
 * Unit tests for the chunker.
 *
 * The suite is organised around one non-negotiable property - chunking never changes
 * content - plus per-mode behaviour checks.
 */
import * as assert from 'assert';
import {
  assertChunksCoverText,
  chunkByCharacter,
  chunkByLine,
  chunkByWord,
  chunkText,
  chunksToText,
  mergeToLimit
} from '../../src/chunker';
import { getLanguageSyntax, isKnownLanguage } from '../../src/languages';
import { Chunk, InsertionMode } from '../../src/types';

const MODES: InsertionMode[] = ['character', 'word', 'line', 'smart'];

/** Every sample must survive every mode byte-for-byte. */
const SAMPLES: Record<string, string> = {
  empty: '',
  singleChar: 'x',
  plainWords: 'AAA BBB CCC',
  c: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, %s!\\n", "world");\n    return 0;\n}\n',
  cpp: '#include <iostream>\n\nint main() {\n    std::cout << "Hello" << std::endl;\n    return 0;\n}\n',
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hi");\n    }\n}\n',
  python: 'def hello():\n    print("Hello")\n    return True\n',
  pythonDoc: 'def f():\n    """Long\n    docstring.\n    """\n    # trailing comment\n    pass\n',
  javascript: 'const x = [1, 2, 3].map((n) => n ** 2);\n// done\n',
  typescript: 'export interface A<T> {\n  readonly v?: T | null;\n}\n',
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n',
  rust: 'fn main() {\n    let v: Vec<i32> = (0..10).collect();\n    println!("{:?}", v);\n}\n',
  html: '<!DOCTYPE html>\n<html>\n  <body class="a b">\n    <!-- note -->\n    <p>Hi</p>\n  </body>\n</html>\n',
  css: '.a > .b::after {\n  content: "x";\n  margin: 0 auto; /* center */\n}\n',
  json: '{\n  "a": [1, 2],\n  "b": {"c": null},\n  "d": "e\\"f"\n}\n',
  markdown: '# Title\n\nSome *text* with `code` and a [link](http://x).\n\n```js\nlet a = 1;\n```\n',
  sql: "SELECT id, name -- the columns\nFROM users\nWHERE name = 'O''Brien'\nORDER BY id;\n",
  crlf: 'line one\r\nline two\r\n\r\nline four\r\n',
  mixedEol: 'a\nb\r\nc\rd',
  tabs: '\tif (x) {\n\t\treturn;\n\t}\n',
  trailingWs: 'value   \n   \n\t \nend',
  unicode: 'const s = "héllo 你好 🌍 👩‍💻";\n',
  combining: 'éà café\n',
  emojiOnly: '🚀🎉✨',
  onlyNewlines: '\n\n\n',
  onlySpaces: '    ',
  noTrailingNewline: 'last line without newline',
  longString: 'const msg = "' + 'x'.repeat(300) + '";\n',
  longComment: '// ' + 'word '.repeat(60) + '\n',
  unterminatedString: 'const a = "never closed\nconst b = 1;\n',
  unterminatedComment: 'code(); /* never closed\nmore\n'
};

suite('chunker: content integrity (the invariant)', () => {
  for (const [name, text] of Object.entries(SAMPLES)) {
    for (const mode of MODES) {
      test(`${name} survives ${mode} mode unchanged`, () => {
        const chunks = chunkText(text, mode, { languageId: guessLanguage(name) });
        assert.strictEqual(chunksToText(chunks), text);
        assertChunksCoverText(chunks, text);
      });
    }
  }

  test('offsets are contiguous, ascending and match the chunk text', () => {
    const text = SAMPLES.python;
    for (const mode of MODES) {
      const chunks = chunkText(text, mode, { languageId: 'python' });
      let expected = 0;
      for (const c of chunks) {
        assert.strictEqual(c.startOffset, expected);
        assert.strictEqual(c.endOffset - c.startOffset, c.text.length);
        assert.strictEqual(text.slice(c.startOffset, c.endOffset), c.text);
        expected = c.endOffset;
      }
      assert.strictEqual(expected, text.length);
    }
  });

  test('no chunk is ever empty', () => {
    for (const text of Object.values(SAMPLES)) {
      for (const mode of MODES) {
        for (const c of chunkText(text, mode)) {
          assert.ok(c.text.length > 0, `empty chunk in ${mode} mode`);
        }
      }
    }
  });

  test('chunking is deterministic', () => {
    for (const mode of MODES) {
      const a = chunkText(SAMPLES.typescript, mode, { languageId: 'typescript' });
      const b = chunkText(SAMPLES.typescript, mode, { languageId: 'typescript' });
      assert.deepStrictEqual(a, b);
    }
  });

  test('empty input produces no chunks', () => {
    for (const mode of MODES) {
      assert.deepStrictEqual(chunkText('', mode), []);
    }
  });

  test('an unknown mode still preserves content', () => {
    const chunks = chunkText(SAMPLES.python, 'nonsense' as InsertionMode);
    assert.strictEqual(chunksToText(chunks), SAMPLES.python);
  });
});

suite('chunker: character mode', () => {
  test('splits ASCII into one chunk per character', () => {
    assert.deepStrictEqual(texts(chunkByCharacter('hello')), ['h', 'e', 'l', 'l', 'o']);
  });

  test('keeps a CRLF pair together', () => {
    assert.deepStrictEqual(texts(chunkByCharacter('a\r\nb')), ['a', '\r\n', 'b']);
  });

  test('keeps astral-plane characters together', () => {
    const chunks = chunkByCharacter('a🌍b');
    assert.deepStrictEqual(texts(chunks), ['a', '🌍', 'b']);
  });

  test('keeps a ZWJ emoji sequence together', () => {
    // woman technologist = woman + ZWJ + laptop
    const zwj = '👩‍💻';
    assert.deepStrictEqual(texts(chunkByCharacter(zwj)), [zwj]);
  });

  test('keeps a combining accent with its base letter', () => {
    assert.deepStrictEqual(texts(chunkByCharacter('éx')), ['é', 'x']);
  });

  test('preserves tabs and runs of spaces as individual characters', () => {
    assert.deepStrictEqual(texts(chunkByCharacter('\t  ')), ['\t', ' ', ' ']);
  });
});

suite('chunker: word mode', () => {
  test('splits words, spaces and punctuation apart', () => {
    assert.deepStrictEqual(texts(chunkByWord('AAA BBB CCC')), ['AAA', ' ', 'BBB', ' ', 'CCC']);
  });

  test('groups adjacent punctuation into one chunk', () => {
    assert.deepStrictEqual(
      texts(chunkByWord('foo.bar(baz);')),
      ['foo', '.', 'bar', '(', 'baz', ');']
    );
  });

  test('newlines are their own chunks', () => {
    assert.deepStrictEqual(texts(chunkByWord('a\nb')), ['a', '\n', 'b']);
    assert.deepStrictEqual(texts(chunkByWord('a\r\nb')), ['a', '\r\n', 'b']);
  });

  test('leading whitespace is labelled as indentation', () => {
    const chunks = chunkByWord('    x\n    y');
    assert.strictEqual(chunks[0].type, 'indentation');
    assert.strictEqual(chunks[0].text, '    ');
  });

  test('a whitespace run stays a single chunk', () => {
    assert.deepStrictEqual(texts(chunkByWord('a     b')), ['a', '     ', 'b']);
  });

  test('unicode letters count as word characters', () => {
    assert.deepStrictEqual(texts(chunkByWord('你好 world')), ['你好', ' ', 'world']);
  });

  test('keywords and numbers are labelled', () => {
    const chunks = chunkByWord('return 42');
    assert.strictEqual(chunks[0].type, 'keyword');
    assert.strictEqual(chunks[2].type, 'number');
  });
});

suite('chunker: line mode', () => {
  test('each line keeps its own terminator', () => {
    assert.deepStrictEqual(texts(chunkByLine('a\nb\nc\n')), ['a\n', 'b\n', 'c\n']);
  });

  test('a final line without a terminator is its own chunk', () => {
    assert.deepStrictEqual(texts(chunkByLine('a\nb')), ['a\n', 'b']);
  });

  test('blank lines are preserved and labelled', () => {
    const chunks = chunkByLine('a\n\nb\n');
    assert.deepStrictEqual(texts(chunks), ['a\n', '\n', 'b\n']);
    assert.strictEqual(chunks[1].type, 'blank-line');
  });

  test('CRLF terminators stay attached to their line', () => {
    assert.deepStrictEqual(texts(chunkByLine('a\r\nb\r\n')), ['a\r\n', 'b\r\n']);
  });

  test('a multi-line function becomes one chunk per line', () => {
    const src = '#include <iostream>\n\nint main() {\n    std::cout << "Hello";\n    return 0;\n}\n';
    assert.strictEqual(chunkByLine(src).length, 6);
  });
});

suite('chunker: smart mode', () => {
  const smart = (text: string, languageId?: string): string[] =>
    texts(chunkText(text, 'smart', { languageId }));

  test('matches the documented Python example', () => {
    assert.deepStrictEqual(smart('def hello():\n', 'python'), ['def', ' ', 'hello():', '\n']);
  });

  test('indentation is its own chunk', () => {
    const chunks = chunkText('    return x\n', 'smart', { languageId: 'python' });
    assert.strictEqual(chunks[0].text, '    ');
    assert.strictEqual(chunks[0].type, 'indentation');
  });

  test('tab indentation is preserved exactly', () => {
    const chunks = chunkText('\t\tvalue\n', 'smart', { languageId: 'go' });
    assert.strictEqual(chunks[0].text, '\t\t');
    assert.strictEqual(chunks[0].type, 'indentation');
  });

  test('a whole string literal is one chunk', () => {
    const chunks = chunkText('x = "hello world"', 'smart', { languageId: 'python' });
    const str = chunks.find((c) => c.type === 'string');
    assert.strictEqual(str?.text, '"hello world"');
  });

  test('escaped quotes do not end a string early', () => {
    const chunks = chunkText('a = "he said \\"hi\\" ok";', 'smart', { languageId: 'javascript' });
    const str = chunks.find((c) => c.type === 'string');
    assert.strictEqual(str?.text, '"he said \\"hi\\" ok"');
  });

  test('a Python triple-quoted string is one chunk', () => {
    const src = 'x = """line one\nline two"""\n';
    const chunks = chunkText(src, 'smart', { languageId: 'python' });
    const str = chunks.find((c) => c.type === 'string');
    assert.strictEqual(str?.text, '"""line one\nline two"""');
  });

  test('a line comment is one chunk and excludes the newline', () => {
    const chunks = chunkText('x = 1 // set x\n', 'smart', { languageId: 'javascript' });
    const comment = chunks.find((c) => c.type === 'comment');
    assert.strictEqual(comment?.text, '// set x');
    assert.strictEqual(chunks[chunks.length - 1].text, '\n');
  });

  test('a block comment is one chunk', () => {
    const chunks = chunkText('a /* note */ b', 'smart', { languageId: 'c' });
    const comment = chunks.find((c) => c.type === 'comment');
    assert.strictEqual(comment?.text, '/* note */');
  });

  test('an HTML comment is recognised', () => {
    const chunks = chunkText('<p><!-- hi --></p>', 'smart', { languageId: 'html' });
    const comment = chunks.find((c) => c.type === 'comment');
    assert.strictEqual(comment?.text, '<!-- hi -->');
  });

  test('a SQL line comment uses double dash', () => {
    const chunks = chunkText('SELECT 1 -- pick one\n', 'smart', { languageId: 'sql' });
    const comment = chunks.find((c) => c.type === 'comment');
    assert.strictEqual(comment?.text, '-- pick one');
  });

  test('a hash comment is NOT a comment in a C-family language', () => {
    const chunks = chunkText('#include <stdio.h>\n', 'smart', { languageId: 'c' });
    assert.ok(!chunks.some((c) => c.type === 'comment'));
  });

  test('multi-character operators are not split', () => {
    const ops = smart('a === b && c >>= d', 'javascript');
    assert.ok(ops.includes('==='), ops.join('|'));
    assert.ok(ops.includes('&&'), ops.join('|'));
    assert.ok(ops.includes('>>='), ops.join('|'));
  });

  test('an arrow function arrow stays intact', () => {
    assert.ok(smart('(n) => n', 'typescript').includes('=>'));
  });

  test('numbers stay whole, including floats, hex and suffixes', () => {
    for (const [src, want] of [
      ['x = 3.14159', '3.14159'],
      ['x = 0xFF', '0xFF'],
      ['x = 1_000_000', '1_000_000'],
      ['x = 1e-9', '1e-9'],
      ['x = 10u', '10u']
    ] as const) {
      const chunks = chunkText(src, 'smart', { languageId: 'rust' });
      assert.ok(
        chunks.some((c) => c.text === want || c.text.startsWith(want)),
        `${src}: expected a chunk starting with ${want}, got ${texts(chunks).join('|')}`
      );
    }
  });

  test('a blank line is a single chunk including its terminator', () => {
    const chunks = chunkText('a\n\nb', 'smart');
    const blank = chunks.find((c) => c.type === 'blank-line');
    assert.strictEqual(blank?.text, '\n');
  });

  test('a whitespace-only line keeps its spaces and terminator together', () => {
    const chunks = chunkText('a\n   \nb', 'smart');
    const blank = chunks.find((c) => c.type === 'blank-line');
    assert.strictEqual(blank?.text, '   \n');
  });

  test('a word absorbs the closers that follow it', () => {
    // Rule 1: `x` takes the adjacent `));` with it, up to four characters.
    assert.deepStrictEqual(smart('f(g(x));', 'javascript'), ['f(', 'g(', 'x));']);
  });

  test('closing punctuation after a string groups into one chunk', () => {
    // Rule 2: strings never absorb, so the trailing `];` forms its own closer run.
    assert.deepStrictEqual(smart('["a"];', 'javascript'), ['[', '"a"', '];']);
  });

  test('absorption stops at four characters', () => {
    const chunks = chunkText('x))))))', 'smart', { languageId: 'javascript' });
    assert.strictEqual(chunks[0].text, 'x))))');
    assert.strictEqual(chunksToText(chunks), 'x))))))');
  });

  test('absorption never swallows a string or comment opener', () => {
    assert.deepStrictEqual(smart('f("a")', 'javascript'), ['f(', '"a"', ')']);
    const withComment = smart('x.//note\n', 'javascript');
    assert.ok(withComment.includes('//note'), withComment.join('|'));
  });

  test('a very long string is split rather than becoming one giant undo step', () => {
    const chunks = chunkText(SAMPLES.longString, 'smart', { languageId: 'javascript' });
    assert.ok(chunks.every((c) => c.text.length <= 90), 'found an oversized chunk');
    assert.strictEqual(chunksToText(chunks), SAMPLES.longString);
  });

  test('an unterminated string stops at the line break', () => {
    const chunks = chunkText(SAMPLES.unterminatedString, 'smart', { languageId: 'javascript' });
    assert.strictEqual(chunksToText(chunks), SAMPLES.unterminatedString);
    assert.ok(chunks.some((c) => c.text === '\n'), 'the line break was swallowed');
  });

  test('an unterminated block comment does not lose content', () => {
    const chunks = chunkText(SAMPLES.unterminatedComment, 'smart', { languageId: 'c' });
    assert.strictEqual(chunksToText(chunks), SAMPLES.unterminatedComment);
  });

  test('disabling language awareness still preserves content', () => {
    for (const [, text] of Object.entries(SAMPLES)) {
      const chunks = chunkText(text, 'smart', { languageId: 'python', languageAware: false });
      assert.strictEqual(chunksToText(chunks), text);
    }
  });

  test('an unknown language falls back to generic rules and still works', () => {
    const chunks = chunkText('let a = 1; // hi\n', 'smart', { languageId: 'brainfuck-9000' });
    assert.strictEqual(chunksToText(chunks), 'let a = 1; // hi\n');
    assert.ok(chunks.length > 1);
  });

  test('smart mode is coarser than character mode and finer than line mode', () => {
    const src = SAMPLES.java;
    const chars = chunkText(src, 'character').length;
    const smartCount = chunkText(src, 'smart', { languageId: 'java' }).length;
    const lines = chunkText(src, 'line').length;
    assert.ok(lines < smartCount, `line=${lines} smart=${smartCount}`);
    assert.ok(smartCount < chars, `smart=${smartCount} chars=${chars}`);
  });
});

suite('chunker: maxChunks safety limit', () => {
  test('respects the limit and still preserves content', () => {
    const src = 'word '.repeat(2000);
    const chunks = chunkText(src, 'character', { maxChunks: 100 });
    assert.ok(chunks.length <= 100, `got ${chunks.length}`);
    assert.strictEqual(chunksToText(chunks), src);
  });

  test('a limit larger than the chunk count changes nothing', () => {
    const a = chunkText('a b c', 'word');
    const b = chunkText('a b c', 'word', { maxChunks: 1000 });
    assert.deepStrictEqual(a, b);
  });

  test('a limit of 1 produces one chunk containing everything', () => {
    const src = SAMPLES.python;
    const chunks = chunkText(src, 'character', { maxChunks: 1 });
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].text, src);
  });

  test('mergeToLimit keeps offsets consistent', () => {
    const chunks = chunkText(SAMPLES.rust, 'character', { languageId: 'rust' });
    const merged = mergeToLimit(chunks, 7);
    assert.ok(merged.length <= 7);
    assertChunksCoverText(merged, SAMPLES.rust);
  });

  test('a merged group of one type keeps that type', () => {
    const merged = mergeToLimit(chunkText('aaaa', 'character'), 2);
    assert.strictEqual(merged[0].type, 'character');
  });
});

suite('chunker: assertChunksCoverText', () => {
  test('accepts a valid chunk list', () => {
    assert.doesNotThrow(() => assertChunksCoverText(chunkText('abc', 'word'), 'abc'));
  });

  test('rejects a gap', () => {
    const bad: Chunk[] = [{ text: 'a', type: 'word', startOffset: 0, endOffset: 1 }];
    assert.throws(() => assertChunksCoverText(bad, 'abc'), /cover 1 of 3/);
  });

  test('rejects offsets that disagree with the text', () => {
    const bad: Chunk[] = [{ text: 'abc', type: 'word', startOffset: 0, endOffset: 2 }];
    assert.throws(() => assertChunksCoverText(bad, 'abc'), /offsets disagree/);
  });

  test('rejects altered content', () => {
    const bad: Chunk[] = [{ text: 'abd', type: 'word', startOffset: 0, endOffset: 3 }];
    assert.throws(() => assertChunksCoverText(bad, 'abc'), /do not equal the source/);
  });
});

suite('languages', () => {
  test('known languages resolve to their own table', () => {
    assert.strictEqual(getLanguageSyntax('python').lineComments[0], '#');
    assert.strictEqual(getLanguageSyntax('sql').lineComments[0], '--');
    assert.ok(getLanguageSyntax('lua').lineComments.includes('--'));
  });

  test('unknown languages fall back to the generic table', () => {
    assert.ok(!isKnownLanguage('nonexistent-lang'));
    assert.ok(getLanguageSyntax('nonexistent-lang').lineComments.length > 0);
  });

  test('undefined language and disabled awareness both give the generic table', () => {
    assert.deepStrictEqual(getLanguageSyntax(undefined), getLanguageSyntax('anything', false));
  });

  test('every language in the spec has a dedicated table', () => {
    for (const id of [
      'c', 'cpp', 'java', 'python', 'javascript', 'typescript', 'go', 'rust',
      'html', 'css', 'json', 'markdown', 'sql'
    ]) {
      assert.ok(isKnownLanguage(id), `${id} has no syntax table`);
    }
  });
});

suite('chunker: performance', () => {
  const build = (kb: number): string => {
    const unit = 'function f(a, b) {\n  return a + b; // add\n}\n';
    return unit.repeat(Math.ceil((kb * 1024) / unit.length)).slice(0, kb * 1024);
  };

  for (const kb of [1, 10, 100, 500]) {
    test(`${kb} KB chunks in every mode within budget`, function () {
      this.timeout(30000);
      const src = build(kb);
      for (const mode of MODES) {
        const started = Date.now();
        const chunks = chunkText(src, mode, { languageId: 'javascript', maxChunks: 5000 });
        const elapsed = Date.now() - started;
        assert.strictEqual(chunksToText(chunks), src, `${mode} altered ${kb} KB of content`);
        assert.ok(chunks.length <= 5000, `${mode}: ${chunks.length} chunks exceeded the cap`);
        assert.ok(elapsed < 5000, `${mode} took ${elapsed} ms for ${kb} KB`);
        // eslint-disable-next-line no-console
        console.log(`        ${kb} KB / ${mode}: ${chunks.length} chunks in ${elapsed} ms`);
      }
    });
  }
});

function texts(chunks: readonly Chunk[]): string[] {
  return chunks.map((c) => c.text);
}

function guessLanguage(sampleName: string): string | undefined {
  const map: Record<string, string> = {
    c: 'c',
    cpp: 'cpp',
    java: 'java',
    python: 'python',
    pythonDoc: 'python',
    javascript: 'javascript',
    typescript: 'typescript',
    go: 'go',
    rust: 'rust',
    html: 'html',
    css: 'css',
    json: 'json',
    markdown: 'markdown',
    sql: 'sql'
  };
  return map[sampleName];
}
