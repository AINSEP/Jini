/**
 * Framework-free script asset for data-toolname/data-tooldescription actions.
 * Native tool* forms remain the browser's responsibility. No polyfill, transport,
 * field-value reader, arbitrary selector input or cross-origin exposure is added.
 * The host owns consent copy and its browser preference key. This string asset
 * can be inlined into static exports without importing a DOM runtime on Node.
 */
export function createAnnotatedActionsScript(
  { preferenceKey, confirmationMessage = 'Allow this browser-agent action?', confirmationMessages = {} }: {
    preferenceKey?: string;
    confirmationMessage?: string;
    confirmationMessages?: Readonly<Record<string, string>>;
  },
  _optional: Record<string, never> = {},
): string {
  const config = JSON.stringify({ preferenceKey, confirmationMessage, confirmationMessages }).replace(/</g, '\\u003c');
  return String.raw`(function install(config) {
    'use strict';
    var doc = document;
    var locale = (doc.documentElement.lang || 'en').toLowerCase();
    var messages = config.confirmationMessages;
    var confirmation = Object.keys(messages).find(function (key) { return key.toLowerCase() === locale; });
    var confirmationMessage = messages[confirmation] || messages[locale.split('-')[0]] || config.confirmationMessage;
    var stopped = false;
    var registrations = [];
    var observer;
    function enabled() {
      try { return !config.preferenceKey || localStorage.getItem(config.preferenceKey) !== 'false'; }
      catch (_) { return true; }
    }
    function stripNativeForms() {
      doc.querySelectorAll('form[toolname]').forEach(function (form) {
        ['toolname', 'tooldescription', 'toolautosubmit'].forEach(function (name) { form.removeAttribute(name); });
      });
    }
    function stop(event) {
      stopped = true;
      registrations.forEach(function (controller) { controller.abort(); });
      registrations = [];
      if (observer) observer.disconnect();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', stop);
      // A cached Document executes no scripts when the browser restores it.
      // Reinstall on pageshow, while old callbacks remain permanently stopped.
      if (event && event.persisted) window.addEventListener('pageshow', function () { install(config); }, { once: true });
    }
    function onStorage(event) {
      if (event.key !== null && event.key !== config.preferenceKey) return;
      if (!enabled()) { stripNativeForms(); stop(); }
    }
    if (!enabled()) { stripNativeForms(); return; }
    var context = [doc.modelContext, typeof navigator !== 'undefined' && navigator.modelContext].find(function (value) {
      return value && typeof value.registerTool === 'function';
    });
    if (!context || typeof context.registerTool !== 'function') return;
    function visible(element) {
      if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"], dialog:not([open])')) return false;
      for (var current = element; current; current = current.parentElement) {
        var style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      }
      return true;
    }
    function descriptor(element) {
      var name = element.getAttribute('data-toolname') || '';
      var description = element.getAttribute('data-tooldescription') || '';
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name) || !description.trim() || !visible(element)) return null;
      if (element.matches(':disabled, [aria-disabled="true"]')) return null;
      if (element.tagName === 'A') {
        if (!element.hasAttribute('href') || element.hasAttribute('download')) return null;
        var url;
        try { url = new URL(element.getAttribute('href'), doc.baseURI); } catch (_) { return null; }
        if (!/^https?:$/.test(url.protocol) || url.origin !== window.location.origin || url.username || url.password) return null;
        return { name: name, description: description, href: url.href };
      }
      // Inputs and form submission are intentionally absent: declarative forms
      // preserve native validation and human submission, with no secret fields.
      if (element.tagName !== 'BUTTON' || element.type !== 'button') return null;
      return { name: name, description: description, href: null };
    }
    function refresh() {
      registrations.forEach(function (controller) { controller.abort(); });
      registrations = [];
      if (stopped || !enabled()) { stripNativeForms(); stop(); return; }
      var counts = new Map();
      doc.querySelectorAll('[data-toolname], form[toolname]').forEach(function (element) {
        if (!visible(element)) return;
        var name = element.getAttribute('data-toolname') || element.getAttribute('toolname');
        counts.set(name, (counts.get(name) || 0) + 1);
      });
      doc.querySelectorAll('[data-toolname]').forEach(function (element) {
        var action = descriptor(element);
        if (!action || counts.get(action.name) !== 1) return;
        var controller = new AbortController();
        registrations.push(controller);
        function current() {
          var latest = descriptor(element);
          var matches = Array.from(doc.querySelectorAll('[data-toolname], form[toolname]')).filter(function (candidate) {
            return visible(candidate) && (candidate.getAttribute('data-toolname') || candidate.getAttribute('toolname')) === action.name;
          });
          if (stopped || controller.signal.aborted || !enabled() || !latest ||
              matches.length !== 1 || latest.name !== action.name || latest.description !== action.description || latest.href !== action.href) {
            throw new Error('Browser-agent action is unavailable');
          }
        }
        var tool = {
          name: action.name,
          description: action.description,
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: action.href !== null },
          execute: async function (args) {
            current();
            if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 0) {
              throw new Error('This action takes no arguments');
            }
            if (action.href !== null) {
              // Navigation has no click-handler side effects and cannot forward
              // arbitrary agent-supplied URLs or use a theme's cross-origin base.
              window.location.assign(action.href);
              return { navigationRequested: true };
            }
            if (!window.confirm(confirmationMessage + '\n\n' + action.description)) {
              throw new Error('Browser-agent action declined');
            }
            current();
            element.click();
            // Activation acknowledges the UI event, never business success.
            return { activated: true };
          }
        };
        try {
          Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(function () { controller.abort(); });
        } catch (_) { controller.abort(); }
      });
    }
    window.addEventListener('pagehide', stop);
    window.addEventListener('storage', onStorage);
    refresh();
    observer = new MutationObserver(refresh);
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-toolname', 'data-tooldescription', 'toolname', 'href', 'download', 'type', 'disabled', 'aria-disabled', 'hidden', 'inert', 'aria-hidden', 'style', 'class', 'open'] });
  })(` + config + ');';
}
