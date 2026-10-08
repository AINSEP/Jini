/** Frozen pre-refactor wire bytes. Do not derive expectations from the production builders. */
export const DOCUMENT_STORAGE = `<script data-jini-sandbox-shim>(function(){
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

export const DOCUMENT_FOCUS = `<script data-jini-focus-guard>(function(){
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

export const SRCDOC_STORAGE = `<script data-jini-sandbox-shim>(function(){
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
})();</script>`;

export const SRCDOC_FOCUS = `<script data-jini-preview-focus-guard>(function(){
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
})();</script>`;

export const ACTIVATION = `<script data-jini-srcdoc-transport-activation>(function(){
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'jini:srcdoc-transport-activate' || typeof data.html !== 'string') return;
    document.open();
    document.write(data.html);
    document.close();
  });
})();</script>`;

export const LAZY_SHELL = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script data-jini-lazy-srcdoc-transport>(function(){
      window.addEventListener('message', function(ev){
        var data = ev && ev.data;
        if (!data || data.type !== 'jini:srcdoc-transport-activate' || typeof data.html !== 'string') return;
        document.open();
        document.write(data.html);
        document.close();
      });
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'jini:srcdoc-transport-ready' }, '*');
        }
      } catch (_) { /* sandboxed parent — host falls back to onLoad */ }
    })();</script>
  </head>
  <body></body>
</html>`;

