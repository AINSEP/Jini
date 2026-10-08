/**
 * Shared sandbox script generation. The builders have established byte-level
 * contracts: srcdoc uses modern link-handler syntax and a different focus
 * marker/listener spelling. Keep those serialization differences here; each
 * builder still owns its injection positions, defaults, CSP and bridges.
 */
type ScriptFormat = 'sandbox' | 'srcdoc';

/**
 * Script that shims `localStorage`/`sessionStorage` with an in-memory store
 * when the real Storage API throws, and intercepts `<a href>` clicks so
 * hash-only links scroll within the document (instead of attempting a
 * sandboxed top-level navigation) and `target="_blank"` links open via
 * `window.open` behind an `http:`/`https:`/`mailto:` scheme allow-list
 * (instead of being silently blocked by the iframe sandbox).
 */
// Sandboxed iframes (`sandbox="allow-scripts"`, deliberately without
// `allow-same-origin` — see `react/components/SrcDocSandbox.tsx`) raise a
// SecurityError on first `localStorage`/`sessionStorage` access. Many
// freeform-generated artifacts call `localStorage.getItem(...)` at the top
// of an IIFE with no try/catch — when it throws, the whole script aborts
// and the artifact renders blank. Installing a same-origin in-memory shim
// before any user script runs lets those artifacts degrade gracefully
// (position/state just doesn't persist across reloads) instead of crashing.
// The same script also intercepts same-document anchor navigation and
// `target="_blank"` links so they behave sanely inside a sandboxed iframe
// (`allow-popups`/`allow-popups-to-escape-sandbox` still required on the
// iframe itself for the latter to actually open).
export function buildStorageScript(
  { format }: { format: ScriptFormat },
  _optional: Record<string, never> = {},
): string {
  const modern = format === 'srcdoc';
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
  document.addEventListener('click', ${modern ? '(e) => {' : 'function(e){'}
    if (!e.target || !(e.target instanceof Element)) return;
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (href === null) return;
    var isAnchor = ${modern ? "href.startsWith('#')" : "href.indexOf('#') === 0"} || href === '';
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
      ${modern ? 'let' : 'var'} safe = false;
      try {
        var url = new URL(href, location.href);
        ${modern ? `safe =
          url.protocol === 'http:' ||
          url.protocol === 'https:' ||
          url.protocol === 'mailto:';` : "safe = url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';"}
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
export function buildFocusScript(
  { format }: { format: ScriptFormat },
  _optional: Record<string, never> = {},
): string {
  const preview = format === 'srcdoc';
  return `<script ${preview ? 'data-jini-preview-focus-guard' : 'data-jini-focus-guard'}>(function(){
  var lastTrustedInputAt = 0;
  function userActivated(){
    return Date.now() - lastTrustedInputAt < 1000;
  }
  function markTrustedInput(event){
    if (event && event.isTrusted) lastTrustedInputAt = Date.now();
  }
${preview ? `  document.addEventListener('pointerdown', function(event){
    markTrustedInput(event);
  }, true);
  document.addEventListener('keydown', function(event){
    markTrustedInput(event);
  }, true);` : `  document.addEventListener('pointerdown', markTrustedInput, true);
  document.addEventListener('keydown', markTrustedInput, true);`}
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
