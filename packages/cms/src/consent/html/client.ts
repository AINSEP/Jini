/** Vanilla enhancement: forms remain ordinary POST forms without this script.
 * Signals are queued before any released tag. A changed choice reloads to stop already-running
 * scripts; a new grant is released only after the server durably saved its receipt.
 * Script release is ordered and each template is consumed once. O(s + l) for s deferred elements and l late listeners. */
export const CONSENT_CLIENT = String.raw`(function () {
  'use strict';
  var node = document.getElementById('jini-consent-config');
  if (!node) return;
  var state = JSON.parse(node.textContent);
  var gpc = state.gpc || navigator.globalPrivacyControl === true;
  var choices = gpc ? state.gpcChoices : state.choices;
  if (gpc && choices.marketing !== true) {
    // navigator GPC may be absent from the request headers; enforce resource denial before parsing site styles.
    var policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = state.resourcePolicies[(choices.functional ? '1' : '0') + (choices.analytics ? '1' : '0')];
    document.head.appendChild(policy);
  }
  window.dataLayer = window.dataLayer || [];
  function signal(command, signals) {
    // Google consumes gtag-style Arguments entries, not arbitrary arrays/objects.
    (function () { window.dataLayer.push(arguments); })('consent', command, signals);
  }
  signal('default', state.deniedSignals);
  if (state.hasRecord || state.optOut) signal('update', gpc ? state.gpcSignals : state.signals);
  async function release() {
    // Released theme scripts may register DCL listeners after the native event has fired.
    // Replay only listeners added during release, so already-running necessary scripts do not run twice.
    var late = [];
    var byCapture = [new Map(), new Map()];
    var add = document.addEventListener;
    var remove = document.removeEventListener;
    document.addEventListener = function (type, listener, options) {
      var capture = typeof options === 'boolean' ? options : Boolean(options && options.capture);
      var tracked = byCapture[Number(capture)];
      if (type === 'DOMContentLoaded' && listener && !tracked.has(listener)) {
        var entry = { listener: listener, options: options, removed: false };
        late.push(entry); tracked.set(listener, entry);
      }
      return add.call(this, type, listener, options);
    };
    document.removeEventListener = function (type, listener, options) {
      var capture = typeof options === 'boolean' ? options : Boolean(options && options.capture);
      var tracked = byCapture[Number(capture)];
      if (type === 'DOMContentLoaded' && tracked.has(listener)) { tracked.get(listener).removed = true; tracked.delete(listener); }
      return remove.call(this, type, listener, options);
    };
    try {
      var scripts = Array.from(document.querySelectorAll('template[data-jini-consent-script],template[data-jini-consent-resource]'));
      for (var template of scripts) {
        if (!['functional', 'analytics', 'marketing'].includes(template.dataset.category) || choices[template.dataset.category] !== true) continue;
        if (template.hasAttribute('data-jini-consent-resource')) { template.replaceWith(template.content); continue; }
        var original = template.content.querySelector('script');
        if (!original) continue;
        var script = document.createElement('script');
        for (var attribute of original.attributes) script.setAttribute(attribute.name, attribute.value);
        if (original.nonce) script.nonce = original.nonce;
        script.textContent = original.textContent;
        script.async = false;
        var completion = Promise.resolve();
        if (script.src || script.type === 'module') {
          completion = new Promise(function (resolve) {
            var timer;
            function finish() { clearTimeout(timer); resolve(); }
            script.addEventListener('load', finish, { once: true });
            script.addEventListener('error', finish, { once: true });
            // A broken external tag must not hold unrelated later tags indefinitely.
            timer = setTimeout(finish, 15000);
          });
        }
        template.replaceWith(script);
        await completion;
      }
      document.querySelectorAll('[data-jini-consent-attributes]').forEach(function (element) {
        if (!['functional', 'analytics', 'marketing'].includes(element.dataset.jiniConsentCategory) || choices[element.dataset.jiniConsentCategory] !== true) return;
        var attributes = JSON.parse(element.dataset.jiniConsentAttributes);
        Object.keys(attributes).forEach(function (name) { element.setAttribute(name, attributes[name]); });
        element.removeAttribute('data-jini-consent-attributes');
      });
    } finally { document.addEventListener = add; document.removeEventListener = remove; }
    var event = new Event('DOMContentLoaded');
    late.forEach(function (entry) {
      if (entry.removed || (entry.options && entry.options.signal && entry.options.signal.aborted)) return;
      if (entry.options && entry.options.once) remove.call(document, 'DOMContentLoaded', entry.listener, entry.options);
      try {
        if (typeof entry.listener === 'function') entry.listener.call(document, event);
        else entry.listener.handleEvent(event);
      } catch (failure) {
        // Native dispatch isolates listener errors; keep later theme initializers running too.
        setTimeout(function () { throw failure; }, 0);
      }
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    var banner = document.getElementById('jini-consent');
    if (gpc) {
      banner.querySelector('[data-jini-gpc-note]').hidden = false;
      banner.querySelector('[name=gpc]').value = '1';
      ['analytics', 'marketing'].forEach(function (category) {
        var input = banner.querySelector('[name=' + category + ']');
        input.checked = false; input.disabled = true;
      });
    }
    var preferences = document.getElementById('jini-consent-preferences');
    banner.querySelector('[data-jini-do-not-sell]').addEventListener('click', function () {
      preferences.open = true;
      banner.querySelector('[data-jini-do-not-sell-button]').focus();
    });
    banner.querySelector('form').addEventListener('submit', async function (event) {
      if (!event.submitter) return;
      event.preventDefault();
      var form = event.currentTarget;
      var data = new URLSearchParams(new FormData(form));
      data.set('action', event.submitter.value);
      var buttons = Array.from(form.querySelectorAll('button'));
      buttons.forEach(function (button) { button.disabled = true; });
      var error = banner.querySelector('[data-jini-consent-error]');
      error.hidden = true;
      try {
        var response = await fetch(form.action, { method: 'POST', credentials: 'same-origin',
          headers: { 'Accept': 'application/json' }, body: data });
        var result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Cookie preferences could not be saved.');
        signal('update', result.signals);
        window.location.reload();
      } catch (failure) {
        error.textContent = failure.message || 'Cookie preferences could not be saved. Please try again.';
        error.hidden = false;
        buttons.forEach(function (button) { button.disabled = false; });
      }
    });
    release();
  }, { once: true });
})();`;
