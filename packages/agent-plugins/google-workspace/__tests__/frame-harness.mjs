/**
 * @file jsdom harness for the plugin's browser entry scripts (`ui/connection-panel.mjs`,
 * `ui/picker.mjs`, `ui/destination-panel.mjs`, `ui/picker-flow.mjs`, `ui/dom.mjs`).
 *
 * Each test gets a fresh frame: a jsdom window whose `parent` is a fake host window speaking the
 * real admin-surface protocol (the message shapes `ui/surface-client.mjs` sends and accepts), with
 * its window/document installed as the globals the frame scripts use. The fake host answers each
 * `action-request` from a per-action responder and records every message the frame posts, so a test
 * can assert exactly which declared actions went out, to which origin, for which mount.
 *
 * No network: jsdom loads no external resources, nothing here fetches, and Google's Picker script is
 * a stub (`createFakePickerApi`) that the test drives by hand.
 */
import { readFileSync } from 'node:fs';

import { JSDOM } from 'jsdom';

export const HOST_ORIGIN = 'https://admin.tovu.test';
export const MOUNT_ID = 'mount-1';
export const PICKER_SCRIPT = 'https://apis.google.com/js/api.js';
export const SPREADSHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';
/** Built at runtime: never a literal secret-shaped string in the repo. */
export const PICKER_TOKEN = 'ya' + '29.' + 'p'.repeat(40);
/** Server and user text that would run if any panel parsed it as markup. */
export const MARKUP = '<img src="x" onerror="globalThis.__pwned = true">';
const PROTOCOL = 'jini.admin-surface';
const VERSION = 1;

const SURFACES = JSON.parse(readFileSync(new URL('../tovu-admin-surfaces.json', import.meta.url), 'utf8')).surfaces;

/**
 * The action names a surface declares in the plugin's `tovu-admin-surfaces.json`.
 * @param {{ surfaceId: string }} required
 * @returns {string[]}
 */
export function declaredActions(required) {
  return SURFACES.find((surface) => surface.id === required.surfaceId).actions.map((action) => action.name);
}

/** A host refusal in the protocol's failure shape (what `withSurfaceFailures` sends). */
export function refusal(message, optional = {}) {
  return { code: optional.code ?? 'refused', message, retryable: optional.retryable ?? false };
}

/** Lets queued microtasks and the message round trips settle (setImmediate is never mocked here). */
export async function flush() {
  for (let round = 0; round < 25; round += 1) await new Promise((resolve) => { setImmediate(resolve); });
}

/**
 * A fresh frame whose window/document are the globals the frame scripts use. Call `close()` after.
 * Responders: `respond.set(action, (payload) => result)`; a responder that throws a `refusal(...)`
 * makes the host answer `ok: false`; an action with no responder stays pending until `answer(...)`.
 * @returns {{ window: Window, document: Document, posted: Array<{ message: object, targetOrigin: string }>,
 *   respond: Map<string, Function>, init: Function, answer: Function, deliver: Function, requests: Function, close: Function }}
 */
export function createFrame() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main id="app"></main></body></html>', { url: 'https://surface.tovu.test/ui/panel.html' });
  const { window } = dom;
  const posted = [];
  const respond = new Map();
  const parent = {
    postMessage(message, targetOrigin) {
      posted.push({ message, targetOrigin });
      queueMicrotask(() => { autoAnswer(message); });
    },
  };
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = window;
  globalThis.document = window.document;

  /** Dispatches a message on the frame window as if `source` posted it from `origin`. */
  function deliver(data, optional = {}) {
    window.dispatchEvent(new window.MessageEvent('message', { data, origin: optional.origin ?? HOST_ORIGIN, source: optional.source ?? parent }));
  }

  function answer(message, outcome) {
    const base = { protocol: PROTOCOL, version: VERSION, kind: 'action-response', mountId: MOUNT_ID, requestId: message.requestId };
    deliver('error' in outcome ? { ...base, ok: false, error: outcome.error } : { ...base, ok: true, result: outcome.result });
  }

  async function autoAnswer(message) {
    const key = message.kind === 'open-link' ? 'open-link' : message.action;
    const responder = respond.get(key);
    if (responder === undefined) return;
    try {
      answer(message, { result: await responder(message.kind === 'open-link' ? message.url : message.payload) });
    } catch (error) {
      answer(message, { error });
    }
  }

  return {
    window,
    document: window.document,
    posted,
    respond,
    /** The host's init: `bootstrap` is the surface's bootstrap data (omitted = none sent). */
    init(optional = {}) {
      const envelope = 'bootstrap' in optional ? { expiresAt: Date.now() + 60_000, data: optional.bootstrap } : undefined;
      deliver({ protocol: PROTOCOL, version: VERSION, kind: 'init', mountId: MOUNT_ID, bootstrap: envelope });
    },
    answer,
    deliver,
    /** The `action-request`s posted so far, as `{ action, payload }`. */
    requests() {
      return posted.filter((entry) => entry.message.kind === 'action-request').map((entry) => ({ action: entry.message.action, payload: entry.message.payload }));
    },
    close() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      window.close();
    },
  };
}

/** Every visible text of the frame, for "is this text on screen" checks. */
export function screenText(frame) {
  return frame.document.getElementById('app').textContent;
}

/** The button whose text is exactly `label` (throws a named error when the panel did not render it). */
export function button(frame, label) {
  const found = [...frame.document.querySelectorAll('button')].find((element) => element.textContent === label);
  if (found === undefined) throw new Error(`no "${label}" button; buttons: ${[...frame.document.querySelectorAll('button')].map((element) => element.textContent).join(' | ')}`);
  return found;
}

/** The labels of every rendered button, in order. */
export function buttonLabels(frame) {
  return [...frame.document.querySelectorAll('button')].map((element) => element.textContent);
}

/**
 * A stand-in for Google's Picker API (`window.google.picker`), shaped like the parts the frame uses:
 * `DocsView`, `PickerBuilder`, `ViewId`, `Response`, `Action`, `Document`. Records every build and
 * lets the test fire the Picker's callback with `api.fire(data)`.
 */
export function createFakePickerApi() {
  const api = {
    builds: [],
    ViewId: Object.freeze({ SPREADSHEETS: 'spreadsheets-view' }),
    Response: Object.freeze({ ACTION: 'action', DOCUMENTS: 'docs' }),
    Action: Object.freeze({ PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' }),
    Document: Object.freeze({ ID: 'id' }),
    /** Fires the most recent Picker's callback, as Google does on load, pick or cancel. */
    fire(data) { api.builds.at(-1).callback(data); },
  };
  api.DocsView = class {
    constructor(viewId) { this.viewId = viewId; this.mimeTypes = undefined; }
    setMimeTypes(mimeTypes) { this.mimeTypes = mimeTypes; return this; }
  };
  api.PickerBuilder = class {
    constructor() { this.config = { views: [], visible: false }; }
    setDeveloperKey(value) { this.config.developerKey = value; return this; }
    setAppId(value) { this.config.appId = value; return this; }
    setOAuthToken(value) { this.config.oauthToken = value; return this; }
    addView(view) { this.config.views.push(view); return this; }
    setCallback(callback) { this.config.callback = callback; return this; }
    build() {
      const { config } = this;
      api.builds.push(config);
      return { setVisible(visible) { config.visible = visible; } };
    }
  };
  return api;
}

/**
 * Installs `window.gapi` (the loader Google's script defines) on the current frame window, resolving
 * `load('picker')` with `pickerApi`, or calling its `onerror` when `optional.failLoad` is set.
 */
export function installGapi(required, optional = {}) {
  const { window, pickerApi } = required;
  window.gapi = {
    load(name, callbacks) {
      if (name !== 'picker') throw new Error(`unexpected gapi module ${name}`);
      if (optional.failLoad) callbacks.onerror();
      else { window.google = { picker: pickerApi }; callbacks.callback(); }
    },
  };
}

/** The `<script>` elements the frame added for Google's Picker library. */
export function pickerScripts(frame) {
  return [...frame.document.head.querySelectorAll('script')].filter((element) => element.src === PICKER_SCRIPT);
}
