import { CONSENT_MAX_AGE_MS } from '../types.js';

/** Readable by this runtime only; it holds a denial that is not yet durable evidence. */
const WITHDRAWAL_COOKIE = 'jini_consent_withdrawal';

/** Vanilla enhancement: forms remain ordinary POST forms without this script.
 * Signals are queued before any released tag. A changed choice reloads to stop already-running
 * scripts; a new grant is released only after the server durably saved its receipt.
 * Analytics-only changes may stay live when the host contribution can retire its own SDK and no
 * other analytics resources have run. A withdrawal never waits for evidence: when its save fails it applies at once, a client marker
 * keeps it on later pages (until the receipt lifetime) and the save is retried there.
 * While the first-visit banner is a small-screen bottom sheet, its height is added to body padding so
 * the end of the page stays reachable; host padding is restored when that reserve is cleared.
 * Script release is ordered and each template is consumed once. O(s + l) for s deferred elements and l late listeners. */
export const CONSENT_CLIENT = String.raw`(function () {
  'use strict';
  var node = document.getElementById('jini-consent-config');
  if (!node) return;
  var state = JSON.parse(node.textContent);
  var categories = ['functional', 'analytics', 'marketing'];
  var secure = location.protocol === 'https:';
  var withdrawalCookie = (secure ? '__Host-' : '') + '${WITHDRAWAL_COOKIE}';
  var saveQueue = Promise.resolve();
  var gpc = state.gpc || navigator.globalPrivacyControl === true;
  var withdrawal = readWithdrawal();
  var choices = restrict(gpc ? state.gpcChoices : state.choices, withdrawal && withdrawal.choices);
  var hasChoice = state.hasRecord || Boolean(withdrawal);
  var releasedAnalytics = false;
  function publishConsent() {
    // Consumers observe the effective denial too, even when saving a withdrawal fails.
    window.jiniConsent = { hasChoice: hasChoice, analytics: choices.analytics === true && !gpc, gpc: gpc };
    window.dispatchEvent(new CustomEvent('jini:consent-changed', { detail: window.jiniConsent }));
  }
  function enforceResourcePolicy() {
    if ((gpc || withdrawal) && choices.marketing !== true) {
      // navigator GPC may be absent from the request headers, and an unsaved withdrawal is unknown to the server;
      // enforce resource denial before parsing site styles.
      var policy = document.createElement('meta');
      policy.httpEquiv = 'Content-Security-Policy';
      policy.content = state.resourcePolicies[(choices.functional ? '1' : '0') + (choices.analytics ? '1' : '0')];
      document.head.appendChild(policy);
    }
  }
  enforceResourcePolicy();
  window.dataLayer = window.dataLayer || [];
  function signal(command, signals) {
    // Google consumes gtag-style Arguments entries, not arbitrary arrays/objects.
    (function () { window.dataLayer.push(arguments); })('consent', command, signals);
    if (command === 'update') publishConsent();
  }
  function signalsFor(values) {
    var result = {};
    Object.keys(state.signalCategories).forEach(function (name) { result[name] = state.signalCategories[name] === 'necessary' || values[state.signalCategories[name]] === true ? 'granted' : 'denied'; });
    return result;
  }
  function restrict(current, limit) {
    // A local limit can only remove grants, never add one.
    var result = { necessary: true };
    categories.forEach(function (category) { result[category] = current[category] === true && (!limit || limit[category] === true); });
    return result;
  }
  function withdrawalValue(name) {
    return document.cookie.split(';').map(function (part) { return part.trim(); }).find(function (part) { return part.startsWith(name + '='); });
  }
  function readWithdrawal() {
    var match = withdrawalValue(withdrawalCookie);
    var legacy = false;
    if (!match && secure) { match = withdrawalValue('${WITHDRAWAL_COOKIE}'); legacy = Boolean(match); }
    if (!match) return null;
    var limit = {};
    try {
      var params = new URLSearchParams(decodeURIComponent(match.slice(match.indexOf('=') + 1)));
      categories.forEach(function (category) { limit[category] = params.get(category) === '1'; });
      // Preserve old unsaved withdrawals, but migrate a parent-domain marker only as a denial limit.
      return { choices: limit, retry: !legacy && params.get('retry') === '1', notice: params.get('notice') === '1' };
    } catch (failure) {
      // An unreadable marker still records that something was withdrawn: deny every optional category.
      return { choices: limit, retry: false, notice: false };
    }
  }
  function writeWithdrawal(limit, retry, notice) {
    var params = new URLSearchParams();
    categories.forEach(function (category) { params.set(category, limit[category] ? '1' : '0'); });
    if (retry) params.set('retry', '1');
    if (notice) params.set('notice', '1');
    document.cookie = withdrawalCookie + '=' + encodeURIComponent(params.toString()) + '; Max-Age=${CONSENT_MAX_AGE_MS / 1000}; Path=/; SameSite=Lax' + (secure ? '; Secure' : '');
  }
  function clearWithdrawal() {
    if (secure && withdrawalValue('${WITHDRAWAL_COOKIE}')) {
      // A host cannot delete a planted parent-domain cookie. An unrestricted host marker shadows
      // it after a durable choice; intersecting this marker still cannot grant beyond the receipt.
      writeWithdrawal({ functional: true, analytics: true, marketing: true }, false, false);
      return;
    }
    document.cookie = withdrawalCookie + '=; Max-Age=0; Path=/; SameSite=Lax' + (secure ? '; Secure' : '');
  }
  signal('default', signalsFor({ necessary: true }));
  if (state.hasRecord || state.optOut || withdrawal) signal('update', signalsFor(choices));
  publishConsent();
  function releasedScript(original) {
    var script = document.createElement('script');
    for (var attribute of original.attributes) script.setAttribute(attribute.name, attribute.value);
    if (original.nonce) script.nonce = original.nonce;
    script.textContent = original.textContent;
    script.async = false;
    return script;
  }
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
        if (template.dataset.category === 'analytics') releasedAnalytics = true;
        if (template.hasAttribute('data-jini-consent-resource')) { template.replaceWith(template.content); continue; }
        var original = template.content.querySelector('script');
        if (!original) continue;
        var script = releasedScript(original);
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
        if (element.dataset.jiniConsentCategory === 'analytics') releasedAnalytics = true;
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
  async function save(url, body) {
    var response = await fetch(url, { method: 'POST', credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }, body: new URLSearchParams(body) });
    // A file-only host answers the POST with an HTML error page; show the plain message, not a parse error.
    var result = await response.json().catch(function () { return {}; });
    if (!response.ok || !result.record) {
      var failure = new Error(result.error || 'Cookie preferences could not be saved.');
      // Only throttling and server faults can succeed later; a refused choice (changed policy) cannot.
      failure.retry = response.status === 429 || response.status >= 500;
      throw failure;
    }
    return result;
  }
  function submittedChoices(form, action) {
    // Mirrors createConsentRecord; used only to apply the denial part of a choice that failed to save.
    var result = { necessary: true };
    categories.forEach(function (category) {
      var input = form.querySelector('[name=' + category + ']');
      var fromInput = action === 'save' || (action === 'do-not-sell' && category === 'functional');
      result[category] = action === 'accept' || (fromInput && Boolean(input && input.checked));
    });
    return result;
  }
  function withdrawalMessage(retry) {
    return retry ? 'Your choice applies on this device now, but it could not be saved yet. It will be saved automatically on a later page.'
      : 'Your choice applies on this device now, but it could not be saved. Choose again to save it.';
  }
  function showError(banner, message, open) {
    var error = banner.querySelector('[data-jini-consent-error]');
    error.textContent = message;
    error.hidden = false;
    if (open) openPreferences(banner);
  }
  function syncForm(banner) {
    categories.forEach(function (category) { banner.querySelector('[name=' + category + ']').checked = choices[category] === true; });
  }
  function serializeSave(work) {
    // Reconciliation and explicit choices share one writer; a late retry cannot overwrite a choice.
    var pending = saveQueue.then(work);
    saveQueue = pending.catch(function () {});
    return pending;
  }
  function formAction(form) {
    // Named action buttons shadow form.action; preserve native resolution against the document base.
    return new URL(form.getAttribute('action'), document.baseURI).href;
  }
  function reconciliationBody(form) {
    // A cookie is only a denial limit. Never replay its serialized body or manufacture grants.
    var data = new URLSearchParams();
    data.set('policyVersion', form.querySelector('[name=policyVersion]').value);
    data.set('gpc', gpc ? '1' : '0');
    var granted = categories.filter(function (category) { return choices[category] === true; });
    // Record a full withdrawal as the rejection it was; a partial one is a saved selection.
    data.set('action', granted.length ? 'save' : 'reject');
    granted.forEach(function (category) { data.set(category, 'on'); });
    return data;
  }
  async function reconcile(banner) {
    var retry = withdrawal.retry;
    if (retry) {
      try {
        var result = await save(formAction(banner.querySelector('form')), reconciliationBody(banner.querySelector('form')));
        choices = restrict(choices, result.record.choices);
        syncForm(banner);
        signal('update', signalsFor(choices));
        // Never reload or release grants from an automatic retry. If the receipt disagrees, keep
        // a non-retrying denial marker so a persistent cookie cannot create a save/reload loop.
        if (categories.every(function (category) { return result.record.choices[category] === choices[category]; })) clearWithdrawal();
        else writeWithdrawal(choices, false, false);
        return;
      } catch (failure) { retry = failure.retry !== false; }
    }
    writeWithdrawal(choices, retry, false);
    if (withdrawal.notice || retry) showError(banner, withdrawalMessage(retry), withdrawal.notice);
  }
  function openPreferences(banner) {
    if (banner.dataset.reopen === 'link') location.hash = 'jini-consent';
    banner.querySelectorAll('details').forEach(function (details) { details.open = true; });
  }
  function reserveSpace(banner) {
    // The phone sheet would hide the page end: pad by its height while open (corner card: none).
    // Crossing 640px resizes the banner, so the observer alone re-checks the query.
    if (!window.ResizeObserver || banner.dataset.hasRecord !== 'false') return;
    var small = matchMedia('(max-width:640px)');
    var body = document.body;
    var padding, priority, base;
    function update() {
      var height = small.matches ? banner.offsetHeight : 0;
      if (height) {
        if (padding === undefined) {
          padding = body.style.paddingBottom;
          priority = body.style.getPropertyPriority('padding-bottom');
          base = parseFloat(getComputedStyle(body).paddingBottom) || 0;
        }
        body.style.setProperty('padding-bottom', base + height + 'px', priority);
      } else if (padding !== undefined) {
        body.style.setProperty('padding-bottom', padding, priority);
        padding = undefined;
      }
    }
    new ResizeObserver(update).observe(banner);
  }
  function reloadAfterChoice() {
    // A saved choice must close a fragment-opened panel when the new page loads.
    if (location.hash === '#jini-consent') history.replaceState(null, '', location.pathname + location.search);
    window.location.reload();
  }
  function canSwitchAnalyticsLive(previous, hadChoice) {
    // Arbitrary optional tags cannot be unloaded safely, and a first choice changes the banner's
    // server-rendered structure. Only the trusted analytics contribution promises live teardown.
    if (!hadChoice || window.jiniBrowserAnalyticsLive !== true || releasedAnalytics) return false;
    if (previous.functional !== choices.functional || previous.marketing !== choices.marketing) return false;
    return !document.querySelector('template[data-category="analytics"],[data-jini-consent-category="analytics"],[data-consent-category="analytics"]');
  }
  // Delegation also supports footer controls inserted after the initial document load.
  document.addEventListener('click', function (event) {
    if (!(event.target instanceof Element)) return;
    var control = event.target.closest('[data-jini-consent-open]');
    if (!control) return;
    var banner = document.getElementById('jini-consent');
    if (!banner) return;
    event.preventDefault();
    openPreferences(banner);
    // The first banner buttons are hidden once a choice exists; the category controls never are.
    banner.querySelector('#jini-consent-preferences input:not([disabled])').focus();
  });
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
    syncForm(banner);
    reserveSpace(banner);
    banner.querySelector('form').addEventListener('submit', async function (event) {
      if (!event.submitter) return;
      event.preventDefault();
      var form = event.currentTarget;
      var data = new URLSearchParams(new FormData(form));
      data.set('action', event.submitter.value);
      var buttons = Array.from(form.querySelectorAll('button'));
      buttons.forEach(function (button) { button.disabled = true; });
      banner.querySelector('[data-jini-consent-error]').hidden = true;
      await serializeSave(async function () {
        var previous = choices;
        var hadChoice = hasChoice;
        try {
          var result = await save(formAction(form), data);
          choices = result.record.choices;
          hasChoice = true;
          syncForm(banner);
          clearWithdrawal();
          signal('update', result.signals);
          if (canSwitchAnalyticsLive(previous, hadChoice)) {
            if (location.hash === '#jini-consent') history.replaceState(null, '', location.pathname + location.search);
            buttons.forEach(function (button) { button.disabled = false; });
            return;
          }
          reloadAfterChoice();
        } catch (failure) {
          var next = restrict(choices, submittedChoices(form, event.submitter.value));
          if (categories.some(function (category) { return choices[category] && !next[category]; })) {
            // Withdrawal must not depend on durable evidence: deny now, keep denying on later pages,
            // and reload so optional scripts that already run stop. The save is retried later.
            var retry = failure.retry !== false;
            choices = next;
            hasChoice = true;
            syncForm(banner);
            writeWithdrawal(next, retry, true);
            signal('update', signalsFor(next));
            showError(banner, withdrawalMessage(retry), false);
            window.location.reload();
            return;
          }
          showError(banner, failure.message || 'Cookie preferences could not be saved. Please try again.', false);
          buttons.forEach(function (button) { button.disabled = false; });
        }
      });
    });
    if (withdrawal) serializeSave(function () { return reconcile(banner); });
    release();
  }, { once: true });
})();`;
