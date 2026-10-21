// Hand-written fakes for the web-clone CLI scripts' tests: a tiny DOM (just
// the members the scripts' in-page callbacks read), a Playwright-shaped
// page/browser pair whose `evaluate` runs the callback in Node against that
// DOM, and helpers for temp dirs and captured output. No real browser.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Fresh temp dir under the OS temp root. */
export function tempDir(prefix = "wc2-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Captures log/error lines in place of console.log / console.error. */
export function createOutput() {
  const out = { logs: [], errors: [] };
  out.log = (...parts) => out.logs.push(parts.join(" "));
  out.warn = (...parts) => out.errors.push(parts.join(" "));
  out.error = (...parts) => out.errors.push(parts.join(" "));
  return out;
}

/**
 * A fake element. `matches` lists the simple selectors (besides its tag) the
 * element satisfies; the fake document matches a comma-separated selector
 * against those tokens, which is all these scripts' selectors need.
 */
const elementDefaults = () => ({
  tag: "div",
  id: "",
  attrs: {},
  text: "",
  rect: { x: 0, y: 0, width: 100, height: 20 },
  style: {},
  matches: [],
  children: [],
});

export function el(spec = {}) {
  const { tag, id, attrs, text, rect, style, matches, children, ...props } = { ...elementDefaults(), ...spec };
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id,
    textContent: text,
    parentElement: null,
    children,
    style,
    _matches: new Set([tag.toLowerCase(), ...matches]),
    getAttribute: (name) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
    getBoundingClientRect: () => rect,
    ...props,
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function flatten(nodes, list = []) {
  for (const node of nodes) {
    list.push(node);
    flatten(node.children || [], list);
  }
  return list;
}

/** A fake `document` over a tree of `el()` nodes rooted under <html>. */
export function fakeDocument({ body = [], title = "", html = {}, ...props } = {}) {
  const bodyEl = el({ tag: "body", children: body, innerText: body.map((n) => n.textContent).join(" ") });
  const documentElement = el({ tag: "html", children: [bodyEl], outerHTML: "<html></html>", scrollHeight: 0, lang: "", ...html });
  const all = () => flatten(documentElement.children);
  return {
    title,
    body: bodyEl,
    documentElement,
    forms: [],
    images: [],
    styleSheets: [],
    activeElement: bodyEl,
    querySelectorAll: (selector) => {
      const parts = selector.split(",").map((part) => part.trim());
      return all().filter((node) => parts.some((part) => node._matches.has(part)));
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    ...props,
  };
}

/** Default computed style: visible, static, unstyled; overlaid by `el.style`. */
export function computedStyle(node) {
  return { visibility: "visible", display: "block", position: "static", ...node.style };
}

/**
 * Browser globals for an in-page callback: `document`, `window`,
 * `location`, `getComputedStyle`, `CSS`, `Node`, plus any `extra`.
 */
export function browserEnv({ document = fakeDocument(), href = "https://example.test/", window = {}, extra = {} } = {}) {
  const url = new URL(href);
  const win = {
    scrollY: 0,
    innerWidth: 1440,
    innerHeight: 900,
    scrolls: [],
    scrollTo(...args) {
      win.scrolls.push(args);
      if (typeof args[0] === "object") win.scrollY = args[0].top;
      else win.scrollY = args[1];
    },
    ...window,
  };
  return {
    document,
    window: win,
    location: { href: url.href, origin: url.origin },
    getComputedStyle: computedStyle,
    CSS: { escape: (value) => value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`) },
    Node: { ELEMENT_NODE: 1 },
    ...extra,
  };
}

/**
 * Install `globals` on globalThis for the duration of `fn` (sync or async),
 * then restore whatever was there before.
 */
export function withGlobals(globals, fn) {
  const saved = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const restore = () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  return Promise.resolve(result).finally(restore);
}

/**
 * A Playwright-shaped page. `env` (an object, or a function returning one)
 * supplies the browser globals `evaluate` runs its callback under. Every
 * call is recorded in `calls`; event handlers registered with `on` can be
 * fired with `emit`. `options.hooks` let a test react to goto/hover/click.
 */
export function createFakePage({ env = browserEnv(), status = 200, gotoError, loadStateError, hooks = {} } = {}) {
  const handlers = {};
  const calls = [];
  const resolveEnv = () => (typeof env === "function" ? env() : env);
  const target = (kind, selector) => async (options) => {
    calls.push([kind, selector, options]);
    if (hooks[kind]) await hooks[kind](selector);
  };
  const page = {
    calls,
    handlers,
    closed: false,
    on(event, handler) {
      (handlers[event] ||= []).push(handler);
    },
    off(event, handler) {
      handlers[event] = (handlers[event] || []).filter((h) => h !== handler);
    },
    async emit(event, payload) {
      for (const handler of handlers[event] || []) await handler(payload);
    },
    async goto(url, options) {
      calls.push(["goto", url, options]);
      if (hooks.goto) await hooks.goto(url, page);
      if (gotoError) throw gotoError;
      return status === null ? null : { status: () => status };
    },
    async waitForLoadState(state, options) {
      calls.push(["waitForLoadState", state, options]);
      if (loadStateError) throw loadStateError;
    },
    async waitForTimeout(ms) {
      calls.push(["waitForTimeout", ms]);
    },
    evaluate: (fn, arg) => withGlobals(resolveEnv(), () => fn(arg)),
    async screenshot(options) {
      calls.push(["screenshot", options]);
      fs.writeFileSync(options.path, "fake-png");
    },
    locator: (selector) => ({
      first: () => ({ hover: target("hover", selector), click: target("click", selector) }),
    }),
    mouse: {
      move: async (...args) => calls.push(["mouse.move", ...args]),
      down: async () => calls.push(["mouse.down"]),
      up: async () => calls.push(["mouse.up"]),
    },
    async close() {
      page.closed = true;
    },
  };
  return page;
}

/** A browser whose `newPage` hands out pages from `makePage(options, index)`. */
export function createFakeBrowser(makePage = () => createFakePage()) {
  const browser = {
    pages: [],
    newPageOptions: [],
    closed: false,
    async newPage(options) {
      browser.newPageOptions.push(options);
      const page = makePage(options, browser.pages.length);
      browser.pages.push(page);
      return page;
    },
    async close() {
      browser.closed = true;
    },
  };
  return browser;
}

/** Playwright ports for a script's `main`: the given browser, no real launch. */
export function playwrightPorts(browser) {
  const chromium = { name: "fake-chromium" };
  return {
    loadPlaywright: () => ({ chromium }),
    launchChromium: async (given) => {
      if (given !== chromium) throw new Error("launchChromium got a different chromium");
      return browser;
    },
  };
}

/** A fake Playwright response/request pair for `page.emit("response", ...)`. */
export function fakeResponse({ url, status = 200, method = "GET", resourceType = "fetch", headers = {}, body, bodyError, postData = null, requestHeaders = {} }) {
  const request = {
    url: () => url,
    method: () => method,
    resourceType: () => resourceType,
    headers: () => requestHeaders,
    postData: () => postData,
  };
  return {
    request: () => request,
    url: () => url,
    status: () => status,
    ok: () => status >= 200 && status < 300,
    headers: () => headers,
    async body() {
      if (bodyError) throw bodyError;
      return Buffer.from(body ?? "");
    },
  };
}
