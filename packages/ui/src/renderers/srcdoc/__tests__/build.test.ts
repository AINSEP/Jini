import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SRC_DOC_CSP,
  buildLazySrcDocTransport,
  buildSrcDoc,
  canActivateSrcDocTransport,
  injectAfterHeadOpen,
  injectBeforeBodyEnd,
  injectBeforeHeadEnd,
  sanitizePreviewTitle,
  sanitizeTitleInDoc,
} from '../build.js';
import type { SrcDocBridge } from '../bridge.js';

describe('sanitizePreviewTitle', () => {
  it('replaces filesystem-unsafe characters with a hyphen', () => {
    expect(sanitizePreviewTitle('Q3: Report / Draft')).toBe('Q3- Report - Draft');
  });

  it('strips a leading ~$ lock-file prefix, including doubled prefixes', () => {
    expect(sanitizePreviewTitle('~$~$Invoice')).toBe('Invoice');
  });

  it('leaves an already-safe title untouched', () => {
    expect(sanitizePreviewTitle('Weekly Update')).toBe('Weekly Update');
  });
});

describe('sanitizeTitleInDoc', () => {
  it('sanitizes the real <title> in the head', () => {
    const doc = '<!doctype html><html><head><title>Bad: Title?</title></head><body></body></html>';
    expect(sanitizeTitleInDoc(doc)).toContain('<title>Bad- Title-</title>');
  });

  it('ignores a <title>-like string inside a <script> block', () => {
    const doc =
      '<!doctype html><html><head><script>var s = "<title>fake</title>";</script></head><body></body></html>';
    expect(sanitizeTitleInDoc(doc)).toBe(doc);
  });

  it('decodes HTML entities, then re-sanitizes the decoded result (& is itself a disallowed filename character)', () => {
    const doc = '<html><head><title>Caf&eacute; &amp; Bar</title></head><body></body></html>';
    expect(sanitizeTitleInDoc(doc)).toContain('<title>Café - Bar</title>');
  });

  it('returns the input unchanged when there is no <title>', () => {
    const doc = '<html><head></head><body>hi</body></html>';
    expect(sanitizeTitleInDoc(doc)).toBe(doc);
  });

  it('skips a <title>-like string inside an HTML comment and sanitizes the real title after it', () => {
    const doc = '<html><head><!-- <title>fake</title> --><title>Real: Title</title></head><body></body></html>';
    expect(sanitizeTitleInDoc(doc)).toContain('<title>Real- Title</title>');
  });

  it('returns the input unchanged when an unterminated HTML comment prevents finding any title', () => {
    const doc = '<html><head><!-- never closes<title>Real</title></head><body></body></html>';
    expect(sanitizeTitleInDoc(doc)).toBe(doc);
  });

  it('returns the input unchanged when a <script> block before the title never closes (malformed doc)', () => {
    const doc = '<html><head><script>var s = "<title>fake</title>";';
    expect(sanitizeTitleInDoc(doc)).toBe(doc);
  });

  it('returns the input unchanged when <title> opens but never closes', () => {
    const doc = '<html><head><title>Oops, no closing tag';
    expect(sanitizeTitleInDoc(doc)).toBe(doc);
  });

  it('returns the input unchanged when <title itself never closes with a >', () => {
    const doc = '<title ';
    expect(sanitizeTitleInDoc(doc)).toBe(doc);
  });

  it('decodes numeric and hex character references in the title', () => {
    const doc = '<html><head><title>&#65;&#x42; Report</title></head><body></body></html>';
    expect(sanitizeTitleInDoc(doc)).toContain('<title>AB Report</title>');
  });

  it('replaces an out-of-range numeric character reference with the Unicode replacement character', () => {
    const doc = '<html><head><title>&#99999999;bad</title></head><body></body></html>';
    expect(sanitizeTitleInDoc(doc)).toContain(`<title>�bad</title>`);
  });
});

describe('splice helpers', () => {
  it('injectAfterHeadOpen splices right after <head>', () => {
    expect(injectAfterHeadOpen('<html><head><meta/></head></html>', '<X/>')).toBe(
      '<html><head><X/><meta/></head></html>',
    );
  });

  it('injectAfterHeadOpen prepends when there is no <head>', () => {
    expect(injectAfterHeadOpen('<div/>', '<X/>')).toBe('<X/><div/>');
  });

  it('injectBeforeHeadEnd splices right before the real </head>', () => {
    expect(injectBeforeHeadEnd('<html><head><meta/></head><body></body></html>', '<X/>')).toBe(
      '<html><head><meta/><X/></head><body></body></html>',
    );
  });

  it('injectBeforeHeadEnd ignores a </head> literal inside a <script>', () => {
    const doc = '<html><head><script>"</head>"</script></head><body></body></html>';
    expect(injectBeforeHeadEnd(doc, '<X/>')).toBe(
      '<html><head><script>"</head>"</script><X/></head><body></body></html>',
    );
  });

  it('injectBeforeBodyEnd splices right before the real </body>', () => {
    expect(injectBeforeBodyEnd('<html><body><p>hi</p></body></html>', '<X/>')).toBe(
      '<html><body><p>hi</p><X/></body></html>',
    );
  });

  it('injectBeforeHeadEnd falls back to DOMParser when the doc has no <head> tag and no </head> at all', () => {
    const out = injectBeforeHeadEnd('<html><body>hi</body></html>', '<meta data-probe="1">');
    expect(out.toLowerCase()).toContain('<head>');
    expect(out).toContain('<meta data-probe="1">');
  });

  it('injectBeforeHeadEnd preserves a real <!doctype> through the DOMParser fallback', () => {
    // Exercises `serializeHtmlDocument`'s `doc.doctype ? ... : ''` true
    // branch — the DOMParser-fallback test above uses a doctype-less
    // fragment, which only ever exercises the false ('') side.
    const out = injectBeforeHeadEnd('<!doctype html><html><body>hi</body></html>', '<meta data-probe="1">');
    expect(out.toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<meta data-probe="1">');
  });

  it('injectBeforeHeadEnd falls back to prepending when DOMParser itself throws', async () => {
    const originalDOMParser = globalThis.DOMParser;
    class ThrowingDOMParser {
      parseFromString(): never {
        throw new Error('boom');
      }
    }
    globalThis.DOMParser = ThrowingDOMParser as unknown as typeof DOMParser;
    try {
      const doc = '<html>just a fragment, no head or body tag at all</html>';
      expect(injectBeforeHeadEnd(doc, '<X/>')).toBe(`<X/>${doc}`);
    } finally {
      globalThis.DOMParser = originalDOMParser;
    }
  });

  it('injectBeforeHeadEnd falls back to a regex replace when <head> is open but never closed', () => {
    // No `</head>` anywhere (so the lastIndexOf search misses), but a real
    // `<head>` opening tag is present — takes the regex-replace path rather
    // than falling through to the DOMParser branch at all.
    const out = injectBeforeHeadEnd('<html><head><meta charset="utf-8"></html>', '<X/>');
    expect(out).toBe('<html><head><X/><meta charset="utf-8"></html>');
  });

  it('injectBeforeHeadEnd measures the search limit from the full doc length when there is no <body> at all', () => {
    // With no <body> anywhere, `limit` falls back to `lower.length` rather
    // than a body-relative offset; a normal open+close <head> with no body
    // still splices correctly.
    const out = injectBeforeHeadEnd('<html><head><meta/></head></html>', '<X/>');
    expect(out).toBe('<html><head><meta/><X/></head></html>');
  });

  it('injectBeforeBodyEnd falls back to DOMParser when the doc has no <body> tag and no </body> at all', () => {
    const out = injectBeforeBodyEnd('<html><head></head></html>', '<script data-probe="1"></script>');
    expect(out.toLowerCase()).toContain('<body>');
    expect(out).toContain('<script data-probe="1"></script>');
  });

  it('injectBeforeBodyEnd falls back to appending when DOMParser itself throws', async () => {
    const originalDOMParser = globalThis.DOMParser;
    class ThrowingDOMParser {
      parseFromString(): never {
        throw new Error('boom');
      }
    }
    globalThis.DOMParser = ThrowingDOMParser as unknown as typeof DOMParser;
    try {
      const doc = '<html>just a fragment, no head or body tag at all</html>';
      expect(injectBeforeBodyEnd(doc, '<X/>')).toBe(`${doc}<X/>`);
    } finally {
      globalThis.DOMParser = originalDOMParser;
    }
  });
});

describe('sanitizeTitleInDoc malformed-markup edge cases', () => {
  it('gives up without throwing when a <script> block before the title is missing its closing ">"', () => {
    // `findRealTitleOffset`'s script/style skip-ahead re-searches for the
    // closing tag's own ">"; when the document is truncated mid-tag there is
    // none, and it must fall back to advancing past the closing tag text
    // itself instead of looping forever or throwing.
    const doc = '<html><script>x</script';
    expect(sanitizeTitleInDoc(doc)).toBe(doc);
  });

  it('bails out instead of mis-slicing when a Turkish dotted capital I before <title> desyncs the lowercased search offset from the original string', () => {
    // `sanitizeTitleInDoc` searches for "</title>" inside `html.toLowerCase()`
    // but then re-uses that offset directly against the *original* `html`.
    // `String.prototype.toLowerCase()` maps U+0130 (LATIN CAPITAL LETTER I
    // WITH DOT ABOVE) to a two-code-unit sequence, so each occurrence before
    // the title tag desyncs the lowercased offset from the original by one.
    // With enough of them, the desynced offset walks past the end of the
    // document and the final `html.indexOf('>', closingTagStart)` finds no
    // more ">" at all (returns -1) — this must return the input unchanged
    // rather than produce a garbage slice.
    const doc = 'İ'.repeat(8) + '<title>Foo</title>';
    expect(sanitizeTitleInDoc(doc)).toBe(doc);
  });
});

describe('buildSrcDoc', () => {
  it('wraps a bare fragment in a minimal document', () => {
    const doc = buildSrcDoc('<p>hi</p>');
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<p>hi</p>');
  });

  it('passes a full document through without re-wrapping', () => {
    const doc = buildSrcDoc('<!doctype html><html><head></head><body><p>hi</p></body></html>');
    expect(doc.match(/<html>/g)).toHaveLength(1);
  });

  it('injects the default strict CSP by default', () => {
    const doc = buildSrcDoc('<p>hi</p>');
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain(DEFAULT_SRC_DOC_CSP);
  });

  it('skips CSP injection when csp is false', () => {
    const doc = buildSrcDoc('<p>hi</p>', { csp: false });
    expect(doc).not.toContain('Content-Security-Policy');
  });

  it('accepts a custom CSP string', () => {
    const doc = buildSrcDoc('<p>hi</p>', { csp: "default-src 'self'" });
    expect(doc).toContain("default-src 'self'");
  });

  it('always injects the same-origin sandbox shim', () => {
    expect(buildSrcDoc('<p>hi</p>')).toContain('data-jini-sandbox-shim');
  });

  it('injects the focus guard only when requested', () => {
    expect(buildSrcDoc('<p>hi</p>')).not.toContain('data-jini-preview-focus-guard');
    expect(buildSrcDoc('<p>hi</p>', { previewFocusGuard: true })).toContain('data-jini-preview-focus-guard');
  });

  it('injects a <base href> when provided', () => {
    expect(buildSrcDoc('<p>hi</p>', { baseHref: 'https://example.com/artifact/' })).toContain(
      '<base href="https://example.com/artifact/">',
    );
  });

  it('runs registered bridges in order and tolerates a throwing bridge', () => {
    const ok: SrcDocBridge = { id: 'ok', inject: (doc) => doc.replace('</body>', '<div id="ok"></div></body>') };
    const broken: SrcDocBridge = {
      id: 'broken',
      inject: () => {
        throw new Error('nope');
      },
    };
    const doc = buildSrcDoc('<p>hi</p>', { bridges: [ok, broken] });
    expect(doc).toContain('<div id="ok"></div>');
  });

  it('always ends with the srcdoc-transport-activation listener', () => {
    expect(buildSrcDoc('<p>hi</p>')).toContain('data-jini-srcdoc-transport-activation');
  });

  it('returns the lazy transport shell when lazyTransport is set', () => {
    expect(buildSrcDoc('<p>hi</p>', { lazyTransport: true })).toBe(buildLazySrcDocTransport());
  });

  it('injects the base href/sandbox shim/focus guard into <body> when a full document has no <head> at all', () => {
    // A full document (starts with <html>, so buildSrcDoc passes it through
    // unwrapped) that omits <head> entirely exercises each injector's
    // "<body> but no <head>" fallback branch.
    const doc = buildSrcDoc('<html><body>Hi</body></html>', {
      baseHref: 'https://example.com/artifact/',
      previewFocusGuard: true,
    });
    expect(doc).toContain('<base href="https://example.com/artifact/">');
    expect(doc).toContain('data-jini-sandbox-shim');
    expect(doc).toContain('data-jini-preview-focus-guard');
  });

  it('injects the sandbox shim/focus guard into <body> when there is no <head> and no baseHref (so nothing upstream synthesizes one)', () => {
    // `injectBaseHref`'s own "no <head>" fallback wraps an <html> tag in a
    // synthesized `<head>...</head>`, which — when baseHref *is* set — means
    // by the time injectSandboxShim/injectPreviewFocusGuard run, the doc
    // already has a <head> after all. Omitting baseHref here is the only way
    // to reach their own independent "<body> but no <head>" branch.
    const doc = buildSrcDoc('<html><body>Hi</body></html>', { previewFocusGuard: true });
    expect(doc).not.toContain('<base href');
    expect(doc).toContain('data-jini-sandbox-shim');
    expect(doc).toContain('data-jini-preview-focus-guard');
  });

  it('prepends the base href/sandbox shim/focus guard when a full document has neither <head> nor <body>', () => {
    // Starts with <!doctype so buildSrcDoc treats it as a full document and
    // passes it through unwrapped, but the fragment itself has no <head> or
    // <body> tag anywhere — the last-resort "neither" fallback branch.
    const doc = buildSrcDoc('<!doctype html>just plain content, no head or body tags', {
      baseHref: 'https://example.com/other/',
      previewFocusGuard: true,
    });
    expect(doc).toContain('<base href="https://example.com/other/">');
    expect(doc).toContain('data-jini-sandbox-shim');
    expect(doc).toContain('data-jini-preview-focus-guard');
    expect(doc).toContain('just plain content, no head or body tags');
  });
});

describe('buildLazySrcDocTransport', () => {
  it('builds a shell that listens for the activation message and announces readiness', () => {
    const shell = buildLazySrcDocTransport();
    expect(shell).toContain('jini:srcdoc-transport-activate');
    expect(shell).toContain('jini:srcdoc-transport-ready');
  });
});

describe('canActivateSrcDocTransport', () => {
  const base = { srcDoc: '<p>hi</p>', useUrlLoadPreview: false, useLazyTransport: true, shellReady: true, activatedHtml: null };

  it('activates when every condition is met', () => {
    expect(canActivateSrcDocTransport(base)).toBe(true);
  });

  it('refuses with no srcDoc', () => {
    expect(canActivateSrcDocTransport({ ...base, srcDoc: '' })).toBe(false);
  });

  it('refuses while the URL-load preview is showing', () => {
    expect(canActivateSrcDocTransport({ ...base, useUrlLoadPreview: true })).toBe(false);
  });

  it('refuses when not using the lazy transport', () => {
    expect(canActivateSrcDocTransport({ ...base, useLazyTransport: false })).toBe(false);
  });

  it('refuses before the shell announces readiness', () => {
    expect(canActivateSrcDocTransport({ ...base, shellReady: false })).toBe(false);
  });

  it('refuses to re-activate the same HTML twice', () => {
    expect(canActivateSrcDocTransport({ ...base, activatedHtml: base.srcDoc })).toBe(false);
  });
});
