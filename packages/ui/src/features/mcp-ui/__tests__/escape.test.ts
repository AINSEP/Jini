import { describe, expect, it } from 'vitest';
import { escapeHtml, escapeJsString, escapeJsValue } from '../escape.js';

describe('escapeHtml', () => {
  it('escapes all five characters that are special in HTML text or a quoted attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('escapes the ampersand before the other four, so an escape is never double-escaped', () => {
    // `&lt;` in, `&amp;lt;` out — not `&amp;amp;lt;`, which is what an ampersand-last ordering
    // would produce by re-escaping the ampersands it had just introduced.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves text with nothing special in it untouched', () => {
    expect(escapeHtml('Delete this post?')).toBe('Delete this post?');
  });
});

describe('escapeJsValue', () => {
  it('produces a JS string literal for a string', () => {
    expect(escapeJsValue('hello')).toBe('"hello"');
  });

  it('defuses a literal </script> so it cannot close the enclosing script element', () => {
    const literal = escapeJsValue('</script><img onerror=alert(1)>');
    expect(literal).not.toContain('<');
    expect(literal).toContain('\\u003c/script');
    // Still a valid JS literal that evaluates back to the original text.
    expect(JSON.parse(literal.replace(/\\u003c/g, '<')) as string).toBe('</script><img onerror=alert(1)>');
  });

  it('escapes U+2028 and U+2029, which are legal JSON but were illegal in pre-ES2019 string literals', () => {
    expect(escapeJsValue('a\u2028b\u2029c')).toBe('"a\\u2028b\\u2029c"');
  });

  it('serializes objects and arrays, not just strings', () => {
    expect(escapeJsValue({ id: 'p1', kind: 'post', count: 2 })).toBe('{"id":"p1","kind":"post","count":2}');
    expect(escapeJsValue([1, null, true])).toBe('[1,null,true]');
  });

  it('serializes null as null and undefined as the literal undefined', () => {
    expect(escapeJsValue(null)).toBe('null');
    // `JSON.stringify(undefined)` returns `undefined`, not a string — emitting that raw would
    // produce `var X = ;`, a syntax error in the generated surface.
    expect(escapeJsValue(undefined)).toBe('undefined');
  });
});

describe('escapeJsString', () => {
  it('is escapeJsValue narrowed to strings', () => {
    expect(escapeJsString('a<b')).toBe(escapeJsValue('a<b'));
  });
});
