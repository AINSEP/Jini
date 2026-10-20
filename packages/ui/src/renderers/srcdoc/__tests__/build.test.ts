import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('preserves every source character outside title content, including tag case and quoted > attributes', () => {
    const before = "<!DOCTYPE html>\n<html><head data-note='>'><!-- İ --><TITLE data-note='>'>";
    const after = "</TITLE  >\n<style>p { color: red; }</style></head><body data-x='&amp;'>Hi</body></html>";
    expect(sanitizeTitleInDoc(before + '  Q3: &eacute;?  ' + after)).toBe(before + 'Q3- é-' + after);
  });

  it('uses the full HTML entity set and accepts semicolon-free numeric references', () => {
    const doc = '<title>A&nbsp;B &NotEqualTilde; &#65 &#x42</title>';
    expect(sanitizeTitleInDoc(doc)).toBe('<title>A\u00a0B ≂̸ A B</title>');
  });

  it('decodes character references once rather than interpreting decoded ampersands again', () => {
    expect(sanitizeTitleInDoc('<title>&amp;lt;</title>')).toBe('<title>-lt;</title>');
  });

  it('uses HTML replacement rules for nulls, surrogates and legacy numeric references', () => {
    expect(sanitizeTitleInDoc('<title>&#0;&#xD800;&#128;</title>')).toBe('<title>��€</title>');
  });

  it('ignores fake titles in styles, templates and attributes before the real head title', () => {
    const before = '<head><meta data-note="<title>Fake: Attribute</title>"><style>p::before { content: "<title>Fake: Style</title>"; }</style><template><title>Fake: Template</title></template>';
    const after = '</head><body>Original</body>';
    expect(sanitizeTitleInDoc(before + '<title>Real: Title</title>' + after)).toBe(before + '<title>Real- Title</title>' + after);
  });

  it('sanitizes only the first head title and leaves subsequent titles unchanged', () => {
    expect(sanitizeTitleInDoc('<head><title>First: Title</title><title>Second: Title</title></head>'))
      .toBe('<head><title>First- Title</title><title>Second: Title</title></head>');
  });

  it('leaves titles outside the head untouched', () => {
    const doc = '<html><head></head><body><title>Body: Title</title><svg><title>SVG: Title</title></svg></body></html>';
    expect(sanitizeTitleInDoc(doc)).toBe(doc);
  });

  it('locates a title under an implicit head without adding missing document markup', () => {
    expect(sanitizeTitleInDoc('<html><title>Implicit: Head</title><body>Hi</body>'))
      .toBe('<html><title>Implicit- Head</title><body>Hi</body>');
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
    // Truncated markup must remain unchanged rather than yield a guessed
    // title range or throw while the streaming source is incomplete.
    const doc = '<html><script>x</script';
    expect(sanitizeTitleInDoc(doc)).toBe(doc);
  });

  it('preserves a title after leading body text containing Turkish dotted capital I', () => {
    // U+0130 expands when lowercased, so case-folded string offsets cannot
    // safely address the source. Leading text also places this title outside
    // the head; the parser must leave it untouched.
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

describe('buildSrcDoc byte-for-byte output pins', () => {
  const marker: SrcDocBridge = {
    id: 'marker',
    inject: (doc, ctx) => doc.replace('</body>', `<i data-ctx="${String(ctx.baseHref)}|${String(ctx.extra)}"></i></body>`),
  };

  it('pins a bare fragment with default options', () => {
    expect(buildSrcDoc('<p>hi</p>')).toMatchInlineSnapshot(`
      "<!doctype html>
      <html>
        <head><script data-jini-sandbox-shim>(function(){
        function makeStore(){
          var data = {};
          var api = {
            getItem: function(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
            setItem: function(k, v){ data[k] = String(v); },
            removeItem: function(k){ delete data[k]; },
            clear: function(){ data = {}; },
            key: function(i){ return Object.keys(data)[i] || null; }
          };
          Object.defineProperty(api, 'length', { get: function(){ return Object.keys(data).length; } });
          return api;
        }
        function tryShim(name){
          var works = false;
          try { works = !!window[name] && typeof window[name].getItem === 'function'; void window[name].length; }
          catch (_) { works = false; }
          if (works) return;
          try { Object.defineProperty(window, name, { configurable: true, value: makeStore() }); }
          catch (_) { try { window[name] = makeStore(); } catch (__) {} }
        }
        tryShim('localStorage');
        tryShim('sessionStorage');
        document.addEventListener('click', (e) => {
          if (!e.target || !(e.target instanceof Element)) return;
          var link = e.target.closest('a[href]');
          if (!link) return;
          var href = link.getAttribute('href');
          if (href === null) return;
          var isAnchor = href.startsWith('#') || href === '';
          if (isAnchor) {
            e.preventDefault();
            if (href === '' || href === '#') {
              window.scrollTo({ top: 0 });
              history.replaceState(null, '', ' ');
            } else {
              var targetId = href.slice(1);
              var target = targetId ? document.getElementById(targetId) : null;
              if (target) {
                target.scrollIntoView();
                location.hash === href && history.replaceState(null, '', ' ');
                location.hash = href;
              }
            }
          } else if (link.getAttribute('target') === '_blank') {
            e.preventDefault();
            let safe = false;
            try {
              var url = new URL(href, location.href);
              safe =
                url.protocol === 'http:' ||
                url.protocol === 'https:' ||
                url.protocol === 'mailto:';
            } catch (_) {}
            safe && window.open(href, '_blank', 'noopener,noreferrer');
          }
        });
      })();</script><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'unsafe-inline'; img-src * data: blob:; font-src * data:; media-src * data: blob:; connect-src *; frame-src *; child-src *; object-src 'none'; base-uri 'none'; form-action 'none';">
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body><p>hi</p><script data-jini-srcdoc-transport-activation>(function(){
        window.addEventListener('message', function(ev){
          var data = ev && ev.data;
          if (!data || data.type !== 'jini:srcdoc-transport-activate' || typeof data.html !== 'string') return;
          document.open();
          document.write(data.html);
          document.close();
        });
      })();</script></body>
      </html>"
    `);
  });

  it('pins a full document with title, base href, focus guard, custom CSP and a bridge', () => {
    expect(
      buildSrcDoc('<!doctype html><html><head><title>Q3: Plan</title></head><body><p>x</p></body></html>', {
        baseHref: '/a/b/',
        previewFocusGuard: true,
        csp: "default-src 'self' \"q\"",
        bridges: [marker],
        bridgeContext: { extra: 'e' },
      }),
    ).toMatchInlineSnapshot(`
      "<!doctype html><html><head><script data-jini-preview-focus-guard>(function(){
        var lastTrustedInputAt = 0;
        function userActivated(){
          return Date.now() - lastTrustedInputAt < 1000;
        }
        function markTrustedInput(event){
          if (event && event.isTrusted) lastTrustedInputAt = Date.now();
        }
        document.addEventListener('pointerdown', function(event){
          markTrustedInput(event);
        }, true);
        document.addEventListener('keydown', function(event){
          markTrustedInput(event);
        }, true);
        try {
          var nativeWindowFocus = window.focus && window.focus.bind(window);
          Object.defineProperty(window, 'focus', {
            configurable: true,
            writable: true,
            value: function(){
              if (userActivated() && nativeWindowFocus) return nativeWindowFocus();
            }
          });
        } catch (_) {}
        try {
          var nativeElementFocus = HTMLElement.prototype.focus;
          Object.defineProperty(HTMLElement.prototype, 'focus', {
            configurable: true,
            writable: true,
            value: function(options){
              if (userActivated()) return nativeElementFocus.call(this, options);
            }
          });
        } catch (_) {}
      })();</script><script data-jini-sandbox-shim>(function(){
        function makeStore(){
          var data = {};
          var api = {
            getItem: function(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
            setItem: function(k, v){ data[k] = String(v); },
            removeItem: function(k){ delete data[k]; },
            clear: function(){ data = {}; },
            key: function(i){ return Object.keys(data)[i] || null; }
          };
          Object.defineProperty(api, 'length', { get: function(){ return Object.keys(data).length; } });
          return api;
        }
        function tryShim(name){
          var works = false;
          try { works = !!window[name] && typeof window[name].getItem === 'function'; void window[name].length; }
          catch (_) { works = false; }
          if (works) return;
          try { Object.defineProperty(window, name, { configurable: true, value: makeStore() }); }
          catch (_) { try { window[name] = makeStore(); } catch (__) {} }
        }
        tryShim('localStorage');
        tryShim('sessionStorage');
        document.addEventListener('click', (e) => {
          if (!e.target || !(e.target instanceof Element)) return;
          var link = e.target.closest('a[href]');
          if (!link) return;
          var href = link.getAttribute('href');
          if (href === null) return;
          var isAnchor = href.startsWith('#') || href === '';
          if (isAnchor) {
            e.preventDefault();
            if (href === '' || href === '#') {
              window.scrollTo({ top: 0 });
              history.replaceState(null, '', ' ');
            } else {
              var targetId = href.slice(1);
              var target = targetId ? document.getElementById(targetId) : null;
              if (target) {
                target.scrollIntoView();
                location.hash === href && history.replaceState(null, '', ' ');
                location.hash = href;
              }
            }
          } else if (link.getAttribute('target') === '_blank') {
            e.preventDefault();
            let safe = false;
            try {
              var url = new URL(href, location.href);
              safe =
                url.protocol === 'http:' ||
                url.protocol === 'https:' ||
                url.protocol === 'mailto:';
            } catch (_) {}
            safe && window.open(href, '_blank', 'noopener,noreferrer');
          }
        });
      })();</script><base href="/a/b/"><meta http-equiv="Content-Security-Policy" content="default-src 'self' &quot;q&quot;"><title>Q3- Plan</title></head><body><p>x</p><i data-ctx="/a/b/|e"></i><script data-jini-srcdoc-transport-activation>(function(){
        window.addEventListener('message', function(ev){
          var data = ev && ev.data;
          if (!data || data.type !== 'jini:srcdoc-transport-activate' || typeof data.html !== 'string') return;
          document.open();
          document.write(data.html);
          document.close();
        });
      })();</script></body></html>"
    `);
  });

  it('pins csp:false with an empty bridge list', () => {
    expect(buildSrcDoc('<html><body>b</body></html>', { csp: false, bridges: [] })).toMatchInlineSnapshot(`
      "<html><body><script data-jini-sandbox-shim>(function(){
        function makeStore(){
          var data = {};
          var api = {
            getItem: function(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
            setItem: function(k, v){ data[k] = String(v); },
            removeItem: function(k){ delete data[k]; },
            clear: function(){ data = {}; },
            key: function(i){ return Object.keys(data)[i] || null; }
          };
          Object.defineProperty(api, 'length', { get: function(){ return Object.keys(data).length; } });
          return api;
        }
        function tryShim(name){
          var works = false;
          try { works = !!window[name] && typeof window[name].getItem === 'function'; void window[name].length; }
          catch (_) { works = false; }
          if (works) return;
          try { Object.defineProperty(window, name, { configurable: true, value: makeStore() }); }
          catch (_) { try { window[name] = makeStore(); } catch (__) {} }
        }
        tryShim('localStorage');
        tryShim('sessionStorage');
        document.addEventListener('click', (e) => {
          if (!e.target || !(e.target instanceof Element)) return;
          var link = e.target.closest('a[href]');
          if (!link) return;
          var href = link.getAttribute('href');
          if (href === null) return;
          var isAnchor = href.startsWith('#') || href === '';
          if (isAnchor) {
            e.preventDefault();
            if (href === '' || href === '#') {
              window.scrollTo({ top: 0 });
              history.replaceState(null, '', ' ');
            } else {
              var targetId = href.slice(1);
              var target = targetId ? document.getElementById(targetId) : null;
              if (target) {
                target.scrollIntoView();
                location.hash === href && history.replaceState(null, '', ' ');
                location.hash = href;
              }
            }
          } else if (link.getAttribute('target') === '_blank') {
            e.preventDefault();
            let safe = false;
            try {
              var url = new URL(href, location.href);
              safe =
                url.protocol === 'http:' ||
                url.protocol === 'https:' ||
                url.protocol === 'mailto:';
            } catch (_) {}
            safe && window.open(href, '_blank', 'noopener,noreferrer');
          }
        });
      })();</script>b<script data-jini-srcdoc-transport-activation>(function(){
        window.addEventListener('message', function(ev){
          var data = ev && ev.data;
          if (!data || data.type !== 'jini:srcdoc-transport-activate' || typeof data.html !== 'string') return;
          document.open();
          document.write(data.html);
          document.close();
        });
      })();</script></body></html>"
    `);
  });

  it('pins an empty-string csp as no CSP meta', () => {
    expect(buildSrcDoc('<html><head></head><body></body></html>', { csp: '' })).toMatchInlineSnapshot(`
      "<html><head><script data-jini-sandbox-shim>(function(){
        function makeStore(){
          var data = {};
          var api = {
            getItem: function(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
            setItem: function(k, v){ data[k] = String(v); },
            removeItem: function(k){ delete data[k]; },
            clear: function(){ data = {}; },
            key: function(i){ return Object.keys(data)[i] || null; }
          };
          Object.defineProperty(api, 'length', { get: function(){ return Object.keys(data).length; } });
          return api;
        }
        function tryShim(name){
          var works = false;
          try { works = !!window[name] && typeof window[name].getItem === 'function'; void window[name].length; }
          catch (_) { works = false; }
          if (works) return;
          try { Object.defineProperty(window, name, { configurable: true, value: makeStore() }); }
          catch (_) { try { window[name] = makeStore(); } catch (__) {} }
        }
        tryShim('localStorage');
        tryShim('sessionStorage');
        document.addEventListener('click', (e) => {
          if (!e.target || !(e.target instanceof Element)) return;
          var link = e.target.closest('a[href]');
          if (!link) return;
          var href = link.getAttribute('href');
          if (href === null) return;
          var isAnchor = href.startsWith('#') || href === '';
          if (isAnchor) {
            e.preventDefault();
            if (href === '' || href === '#') {
              window.scrollTo({ top: 0 });
              history.replaceState(null, '', ' ');
            } else {
              var targetId = href.slice(1);
              var target = targetId ? document.getElementById(targetId) : null;
              if (target) {
                target.scrollIntoView();
                location.hash === href && history.replaceState(null, '', ' ');
                location.hash = href;
              }
            }
          } else if (link.getAttribute('target') === '_blank') {
            e.preventDefault();
            let safe = false;
            try {
              var url = new URL(href, location.href);
              safe =
                url.protocol === 'http:' ||
                url.protocol === 'https:' ||
                url.protocol === 'mailto:';
            } catch (_) {}
            safe && window.open(href, '_blank', 'noopener,noreferrer');
          }
        });
      })();</script></head><body><script data-jini-srcdoc-transport-activation>(function(){
        window.addEventListener('message', function(ev){
          var data = ev && ev.data;
          if (!data || data.type !== 'jini:srcdoc-transport-activate' || typeof data.html !== 'string') return;
          document.open();
          document.write(data.html);
          document.close();
        });
      })();</script></body></html>"
    `);
  });

  it('pins the lazy transport shell regardless of html', () => {
    expect(buildSrcDoc('<p>ignored</p>', { lazyTransport: true, csp: 'x' })).toBe(buildLazySrcDocTransport());
  });
});

describe('head/body splicers without a usable DOMParser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('injectBeforeHeadEnd prepends when DOMParser does not exist', () => {
    vi.stubGlobal('DOMParser', undefined);
    expect(injectBeforeHeadEnd('<p>frag</p>', '<X/>')).toBe('<X/><p>frag</p>');
  });

  it('injectBeforeBodyEnd appends when DOMParser does not exist', () => {
    vi.stubGlobal('DOMParser', undefined);
    expect(injectBeforeBodyEnd('<p>frag</p>', '<X/>')).toBe('<p>frag</p><X/>');
  });

  it('injectBeforeHeadEnd serializes the parsed document unchanged when it has no head element', () => {
    class HeadlessDOMParser {
      parseFromString(): Document {
        const parsed = document.implementation.createHTMLDocument('');
        parsed.documentElement.removeChild(parsed.head);
        return parsed;
      }
    }
    vi.stubGlobal('DOMParser', HeadlessDOMParser);
    expect(injectBeforeHeadEnd('<p>frag</p>', '<X/>')).toBe('<!doctype html>\n<html><body></body></html>');
  });
});
