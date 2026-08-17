import { escapeHtmlAttribute, injectAfterHeadOpen, injectBeforeHeadEnd } from './html-utils.js';
import type { SandboxedDocumentOptions, SandboxedDocumentResult } from './types.js';

/** Whether `html` already looks like a full document (starts with `<!doctype>` or `<html>`), vs. a bare fragment. */
export function isFullHtmlDocument(html: string): boolean {
  const head = html.trimStart().slice(0, 64).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

/** Wrap a bare HTML fragment in a minimal document shell. Leaves an already-full document untouched. */
export function wrapFragmentAsDocument(html: string): string {
  if (isFullHtmlDocument(html)) return html;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>${html}</body>
</html>`;
}

/** Inject a `<base href>` tag into the document's `<head>`, synthesizing a `<head>` if none exists. */
export function injectBaseHref(doc: string, baseHref: string): string {
  const tag = `<base href="${escapeHtmlAttribute(baseHref)}">`;
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  if (/<html[^>]*>/i.test(doc)) return doc.replace(/<html[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
  return tag + doc;
}

/**
 * Script that shims `localStorage`/`sessionStorage` with an in-memory store
 * when the real Storage API throws, and intercepts `<a href>` clicks so
 * hash-only links scroll within the document (instead of attempting a
 * sandboxed top-level navigation) and `target="_blank"` links open via
 * `window.open` behind an `http:`/`https:`/`mailto:` scheme allow-list
 * (instead of being silently blocked by the iframe sandbox).
 */
export function buildStorageShimScript(): string {
  return `<script data-jini-sandbox-shim>(function(){
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
  document.addEventListener('click', function(e){
    if (!e.target || !(e.target instanceof Element)) return;
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (href === null) return;
    var isAnchor = href.indexOf('#') === 0 || href === '';
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
      var safe = false;
      try {
        var url = new URL(href, location.href);
        safe = url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
      } catch (_) {}
      safe && window.open(href, '_blank', 'noopener,noreferrer');
    }
  });
})();</script>`;
}

/**
 * Script that suppresses `focus()` calls (on `window` or any element) that
 * aren't the direct result of a real pointer/keyboard event within the
 * last second, so embedded content can't steal keyboard focus away from
 * the host page around it.
 */
export function buildFocusGuardScript(): string {
  return `<script data-jini-focus-guard>(function(){
  var lastTrustedInputAt = 0;
  function userActivated(){
    return Date.now() - lastTrustedInputAt < 1000;
  }
  function markTrustedInput(event){
    if (event && event.isTrusted) lastTrustedInputAt = Date.now();
  }
  document.addEventListener('pointerdown', markTrustedInput, true);
  document.addEventListener('keydown', markTrustedInput, true);
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
})();</script>`;
}

/**
 * Build a sandboxed-iframe-ready HTML document from arbitrary artifact
 * HTML: wraps a bare fragment in a minimal document shell, then optionally
 * injects a `<base href>`, the storage/link-interception shim, and the
 * focus guard. This is the generic core only — it carries no annotation,
 * deck-navigation, or collaboration bridge; those layer their own
 * `postMessage` protocol on top via `useSandboxBridge` in a consuming
 * feature.
 */
export function buildSandboxedDocument(
  html: string,
  options: SandboxedDocumentOptions = {},
): SandboxedDocumentResult {
  const isFullDocument = isFullHtmlDocument(html);
  const wrapped = wrapFragmentAsDocument(html);
  const withBase = options.baseHref ? injectBaseHref(wrapped, options.baseHref) : wrapped;
  const withStorageShim =
    options.storageShim === false ? withBase : injectAfterHeadOpen(withBase, buildStorageShimScript());
  const withFocusGuard = options.focusGuard
    ? injectBeforeHeadEnd(withStorageShim, buildFocusGuardScript())
    : withStorageShim;
  return { html: withFocusGuard, isFullDocument };
}
