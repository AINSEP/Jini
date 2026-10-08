import { describe, expect, it } from 'vitest';
import { buildSandboxedDocument } from '../sandboxed-document.js';
import { buildSrcDoc } from '../srcdoc/build.js';
import {
  ACTIVATION, DOCUMENT_FOCUS, DOCUMENT_STORAGE, LAZY_SHELL, SRCDOC_FOCUS, SRCDOC_STORAGE,
} from './fixtures/injection-contract.js';

// Pin the default itself, not just agreement with an imported production constant.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'unsafe-inline'; img-src * data: blob:; font-src * data:; media-src * data: blob:; connect-src *; frame-src *; child-src *; object-src 'none'; base-uri 'none'; form-action 'none';">`;
const BASE = '<base href="https://assets.example/?a=&quot;x&quot;&amp;b=&lt;y&gt;">';
const baseHref = 'https://assets.example/?a="x"&b=<y>';
const input = '<!doctype html><html><head data-host="1"><title>Report: Q3</title><script>"</head>"</script></head><body><p>hi</p></body></html>';

describe('builder injection byte contracts', () => {
  it.each([false, true])('keeps generic focus=%s independent of the storage switch', (focusGuard) => {
    for (const storageShim of [undefined, false, true]) {
      const options = { baseHref, focusGuard, ...(storageShim === undefined ? {} : { storageShim }) };
      const expected = '<!doctype html><html><head data-host="1">'
        + (storageShim === false ? '' : DOCUMENT_STORAGE) + BASE
        + '<title>Report: Q3</title><script>"</head>"</script>'
        + (focusGuard ? DOCUMENT_FOCUS : '') + '</head><body><p>hi</p></body></html>';
      expect(buildSandboxedDocument(input, options)).toEqual({ html: expected, isFullDocument: true });
    }
  });

  it.each([undefined, false, true])('keeps srcdoc focus=%s and mandatory storage in their original order', (previewFocusGuard) => {
    const expected = '<!doctype html><html><head data-host="1">'
      + (previewFocusGuard ? SRCDOC_FOCUS : '') + SRCDOC_STORAGE + BASE + CSP
      + '<title>Report- Q3</title><script>"</head>"</script></head><body><p>hi</p>'
      + ACTIVATION + '</body></html>';
    expect(buildSrcDoc(input, { baseHref, previewFocusGuard })).toBe(expected);
  });

  it('pins the default fragment shells and their different CSP and transport behavior', () => {
    const shell = (head: string, tail = '') => `<!doctype html>
<html>
  <head>${head}
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body><p>hi</p>${tail}</body>
</html>`;
    expect(buildSandboxedDocument('<p>hi</p>')).toEqual({ html: shell(DOCUMENT_STORAGE), isFullDocument: false });
    expect(buildSrcDoc('<p>hi</p>')).toBe(shell(SRCDOC_STORAGE + CSP, ACTIVATION));
    expect(buildSrcDoc('<p>hi</p>', { csp: true })).toBe(shell(SRCDOC_STORAGE + CSP, ACTIVATION));
  });

  it.each([false, '', "default-src 'none'; connect-src https://example.com?a=1&b=2"])('preserves custom/disabled CSP %j', (csp) => {
    const meta = csp ? '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src https://example.com?a=1&amp;b=2">' : '';
    expect(buildSrcDoc('<html><head></head><body></body></html>', { csp })).toBe(
      '<html><head>' + SRCDOC_STORAGE + meta + '</head><body>' + ACTIVATION + '</body></html>',
    );
  });

  it('keeps body fallback injection separate from generic string-only prepending', () => {
    const html = '<html><body>hi</body></html>';
    expect(buildSandboxedDocument(html)).toEqual({ html: DOCUMENT_STORAGE + html, isFullDocument: true });
    expect(buildSrcDoc(html, { csp: false, previewFocusGuard: true })).toBe(
      '<html><body>' + SRCDOC_FOCUS + SRCDOC_STORAGE + 'hi' + ACTIVATION + '</body></html>',
    );
  });

  it('synthesizes the same base-only head before injection in both builders', () => {
    const html = '<html><body>hi</body></html>';
    expect(buildSandboxedDocument(html, { baseHref, focusGuard: true })).toEqual({
      html: '<html><head>' + DOCUMENT_STORAGE + BASE + DOCUMENT_FOCUS + '</head><body>hi</body></html>',
      isFullDocument: true,
    });
    expect(buildSrcDoc(html, { baseHref, csp: false, previewFocusGuard: true })).toBe(
      '<html><head>' + SRCDOC_FOCUS + SRCDOC_STORAGE + BASE + '</head><body>hi' + ACTIVATION + '</body></html>',
    );
  });

  it('passes complete safety injections through bridges in order and adds activation afterward', () => {
    const safe = '<html><head>' + SRCDOC_FOCUS + SRCDOC_STORAGE + BASE + CSP + '</head><body></body></html>';
    const seen: Array<{ doc: string; ctx: Record<string, unknown> }> = [];
    const out = buildSrcDoc('<html><head></head><body></body></html>', {
      baseHref, previewFocusGuard: true, bridgeContext: { baseHref: 'bridge override', token: 'context' },
      bridges: [
        { id: 'first', inject(doc, ctx) { seen.push({ doc, ctx }); return doc + '<!-- first -->'; } },
        { id: 'broken', inject() { throw new Error('bridge failure'); } },
        { id: 'last', inject(doc, ctx) { seen.push({ doc, ctx }); return doc + '<!-- last -->'; } },
      ],
    });
    const ctx = { baseHref: 'bridge override', token: 'context' };
    expect(seen).toEqual([{ doc: safe, ctx }, { doc: safe + '<!-- first -->', ctx }]);
    expect(out).toBe(safe.replace('</body>', ACTIVATION + '</body>') + '<!-- first --><!-- last -->');
  });

  it('returns the exact lazy transport shell without running document or bridge injections', () => {
    let bridgeCalls = 0;
    expect(buildSrcDoc(input, {
      lazyTransport: true, baseHref, previewFocusGuard: true, csp: 'custom',
      bridges: [{ id: 'must-not-run', inject(doc) { bridgeCalls++; return doc; } }],
    })).toBe(LAZY_SHELL);
    expect(bridgeCalls).toBe(0);
  });
});
