import { describe, expect, it } from 'vitest';
import { validateServerWidgetFragment } from '../html/server-fragment.js';

it('admits native server-rendered HTML', () => {
  expect(validateServerWidgetFragment({ html: '<form action="/api/p/example/book" method="post"><button>Book</button></form>' })).toContain('Book');
});

it.each([
  ['<script>alert(1)</script>', 'executable or unsupported widget element'],
  ['<img src="/x" onerror="alert(1)">', 'executable or unsupported widget attribute'],
  ['<a href="java&#x73;cript:alert(1)">x</a>', 'unsafe widget URL'],
  ['<svg><a>bad</a></svg>', 'executable or unsupported widget element'],
  ['<iframe src="/admin"></iframe>', 'executable or unsupported widget element'],
  ['<div style="color:red">x</div>', 'executable or unsupported widget attribute'],
])('rejects same-origin executable markup %s', (html, message) => {
  expect(() => validateServerWidgetFragment({ html })).toThrow(message);
});

it('rejects excess UTF-8 bytes against a custom cap', () => {
  expect(() => validateServerWidgetFragment({ html: 'éé' }, { maxBytes: 3 })).toThrow('widget HTML exceeds its size cap');
});

describe('validateServerWidgetFragment boundaries', () => {
  it('returns the parse5 serialization of admitted markup', () => {
    expect(validateServerWidgetFragment({ html: '<p class=a>x<br></p>text<!--c-->' })).toBe('<p class="a">x<br></p>text<!--c-->');
  });

  it('admits a fragment exactly at the default 65536-byte cap', () => {
    const html = 'a'.repeat(65536);
    expect(validateServerWidgetFragment({ html })).toBe(html);
  });

  it('rejects a fragment one byte over the default cap', () => {
    expect(() => validateServerWidgetFragment({ html: 'a'.repeat(65537) })).toThrow('widget HTML exceeds its size cap');
  });

  it('admits a fragment exactly at a custom UTF-8 byte cap', () => {
    expect(validateServerWidgetFragment({ html: 'é' }, { maxBytes: 2 })).toBe('é');
  });

  it('rejects a nested disallowed element', () => {
    expect(() => validateServerWidgetFragment({ html: '<div><p><iframe></iframe></p></div>' })).toThrow('executable or unsupported widget element');
  });

  it('admits aria-* attributes', () => {
    expect(validateServerWidgetFragment({ html: '<div aria-label="x" aria-live-x="y"></div>' })).toBe('<div aria-label="x" aria-live-x="y"></div>');
  });

  it('rejects an aria attribute with characters outside [a-z-]', () => {
    expect(() => validateServerWidgetFragment({ html: '<div aria-1="x"></div>' })).toThrow('executable or unsupported widget attribute');
  });

  it('admits relative and http(s) URLs in href, src and action', () => {
    const html = '<a href="/a">a</a><img src="https://x.test/i.png"><form action="http://x.test/p"></form><a href="rel?q=1">r</a>';
    expect(validateServerWidgetFragment({ html })).toBe(html);
  });

  it('rejects a data: URL on src', () => {
    expect(() => validateServerWidgetFragment({ html: '<img src="data:image/png;base64,AA">' })).toThrow('unsafe widget URL');
  });

  it('rejects a protocol-relative URL', () => {
    expect(() => validateServerWidgetFragment({ html: '<a href="//evil.test/">x</a>' })).toThrow('unsafe widget URL');
  });

  it('rejects a URL containing an encoded tab', () => {
    expect(() => validateServerWidgetFragment({ html: '<a href="java&#9;script:x">x</a>' })).toThrow('unsafe widget URL');
  });

  it('rejects a URL containing a backslash', () => {
    expect(() => validateServerWidgetFragment({ html: '<a href="/\\evil.test">x</a>' })).toThrow('unsafe widget URL');
  });

  it('does not URL-check non-URL attributes', () => {
    expect(validateServerWidgetFragment({ html: '<input value="javascript:x">' })).toBe('<input value="javascript:x">');
  });
});
