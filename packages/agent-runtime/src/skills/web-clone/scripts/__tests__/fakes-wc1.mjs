// Hand-written fakes shared by the web-clone script tests (asset-harvest,
// audit-clone, compare-recon, dna-scaffold, init-clone). They implement only
// the members the scripts actually call — no real browser is ever launched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Fresh real temp dir; the scripts' point is file output, so tests use real files. */
export function makeTempDir(prefix = "wc1-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Console/cwd ports that record instead of printing. */
export function makeIo(cwd) {
  const out = { logs: [], warns: [], errors: [] };
  return {
    out,
    io: {
      log: (...args) => out.logs.push(args.join(" ")),
      warn: (...args) => out.warns.push(args.join(" ")),
      error: (...args) => out.errors.push(args.join(" ")),
      cwd: () => cwd,
    },
  };
}

/** A network response as page.on("response") sees it. */
export function fakeNetworkResponse(url, { resourceType = "other", contentType } = {}) {
  return {
    url: () => url,
    request: () => ({ resourceType: () => resourceType }),
    headers: () => (contentType === undefined ? {} : { "content-type": contentType }),
  };
}

/** Body reply table: url -> { status = 200, body = "" }. Unlisted urls 404. */
function reply(table, url) {
  const hit = table[url];
  return hit ? { status: hit.status ?? 200, body: Buffer.from(hit.body ?? "") } : { status: 404, body: Buffer.alloc(0) };
}

/** Fake WHATWG fetch over a reply table; records every call. */
export function fakeFetch(table) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (table[url]?.reject) throw new Error(table[url].reject);
    const { status, body } = reply(table, url);
    return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
  return { impl, calls };
}

/**
 * Fake Playwright browser: one context, one page. `goto` replays `responses`
 * through the registered "response" listener; `evaluate` runs the page-side
 * function against a minimal fake `document`/`window`.
 */
export function fakeBrowser({ responses = [], scrollHeight = 0, gotoError = null, replies = {} } = {}) {
  const state = { closed: false, pageClosed: false, scrolls: [], waits: [], gotos: [], requests: [], contextOptions: null };
  const handlers = {};
  const page = {
    on(event, fn) {
      handlers[event] = fn;
    },
    async goto(url, options) {
      state.gotos.push({ url, options });
      for (const resp of responses) handlers.response?.(resp);
      if (gotoError) throw gotoError;
    },
    async evaluate(fn, arg) {
      const saved = { document: globalThis.document, window: globalThis.window };
      globalThis.document = { documentElement: { scrollHeight } };
      globalThis.window = { scrollTo: (x, y) => state.scrolls.push([x, y]) };
      try {
        return fn(arg);
      } finally {
        globalThis.document = saved.document;
        globalThis.window = saved.window;
      }
    },
    async waitForTimeout(ms) {
      state.waits.push(ms);
    },
    async close() {
      state.pageClosed = true;
    },
  };
  const context = {
    request: {
      async get(url, options) {
        state.requests.push({ url, options });
        const { status, body } = reply(replies, url);
        return { ok: () => status >= 200 && status < 300, status: () => status, body: async () => body };
      },
    },
    async newPage() {
      return page;
    },
  };
  const browser = {
    async newContext(options) {
      state.contextOptions = options;
      return context;
    },
    async close() {
      state.closed = true;
    },
  };
  return { browser, state };
}
