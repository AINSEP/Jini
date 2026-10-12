/** Shared render leases against injected launch/timer ports; no browser process or module mocks. */
import { expect, test } from "vitest";
import { createRenderBrowserPool, type LazyBrowserTimers } from "../web-evidence/lazy-browser.js";
import type { RenderBrowser } from "../web-evidence/render-page.js";
import { renderPublicPage } from "../web-evidence/public-page.js";

function fixture() {
  const events: string[] = [];
  const timers = new Map<number, () => void>(); let next = 0;
  const timerPort: LazyBrowserTimers = { setTimeout: work => { timers.set(++next, work); return next; }, clearTimeout: id => { timers.delete(id as number); } };
  const browser: RenderBrowser = {
    close: async () => { events.push("browser-close"); },
    newContext: async () => {
      events.push("context-open");
      return {
        route: async () => {}, close: async () => { events.push("context-close"); },
        newPage: async () => ({ goto: async () => ({ status: () => 200 }), title: async () => "Live", waitForTimeout: async () => {},
          evaluate: async () => ({ text: "Live", html: "<p>Live</p>", title: "Live", images: [], imagesTruncated: false, truncated: false }),
        }),
      };
    },
  };
  const launch = async () => { events.push("launch"); return browser; };
  return { events, timers, timerPort, browser, launch };
}

test("two concurrent leases share one process, refuse a third and never close an active sibling on idle", async () => {
  const fake = fixture(); const pool = createRenderBrowserPool({ launch: fake.launch }, { timers: fake.timerPort });
  const [first, second] = await Promise.all([pool.acquire({}), pool.acquire({})]);
  expect(first.browser).toBe(second.browser); expect(fake.events).toEqual(["launch"]);
  await expect(pool.acquire({})).rejects.toMatchObject({ code: "WEB_RENDER_BUSY" });
  first.release(); first.release(); expect(fake.timers.size).toBe(0);
  const third = await pool.acquire({}); third.release(); expect(fake.timers.size).toBe(0);
  second.release(); expect(fake.timers.size).toBe(1);
  for (const work of fake.timers.values()) work();
  await Promise.resolve(); await Promise.resolve();
  expect(fake.events).toEqual(["launch", "browser-close"]);
  await pool.close(); expect(fake.events.filter(event => event === "browser-close")).toHaveLength(1);
});

test("a failed launch frees capacity and is retried; cancelled late acquisition releases its lease", async () => {
  const fake = fixture(); let attempts = 0;
  const pool = createRenderBrowserPool({ launch: async () => { if (++attempts === 1) throw new Error("launch failed"); return fake.launch(); } }, { maxConcurrent: 1, timers: fake.timerPort });
  await expect(pool.acquire({})).rejects.toThrow("launch failed");
  const lease = await pool.acquire({}); lease.release(); await pool.close();
  expect(attempts).toBe(2);
  const abort = new AbortController(); let finish!: (browser: RenderBrowser) => void;
  const late = createRenderBrowserPool({ launch: () => new Promise(resolve => { finish = resolve; }) }, { maxConcurrent: 1, timers: fake.timerPort });
  const acquisition = late.acquire({}, { signal: abort.signal });
  await Promise.resolve(); abort.abort(new Error("cancelled"));
  await expect(acquisition).rejects.toThrow("cancelled");
  finish(fake.browser); await Promise.resolve(); await Promise.resolve();
  const next = await late.acquire({}); next.release(); await late.close();
  await expect(late.acquire({}, { signal: abort.signal })).rejects.toThrow("cancelled");
  expect(() => createRenderBrowserPool({ launch: fake.launch }, { maxConcurrent: 0 })).toThrow("positive integer");
});

test("public rendering borrows the same lazy process across calls and closes only its own contexts", async () => {
  const fake = fixture(); const pool = createRenderBrowserPool({ launch: fake.launch }, { timers: fake.timerPort });
  for (let n = 0; n < 2; n++) {
    const result = await renderPublicPage({ input: { url: "https://public.example/", maxChars: 100, waitFor: 0 }, httpClient: { send: async () => { throw new Error("fake page performs no requests"); } } }, { browserPool: pool });
    expect(result.text).toBe("Live");
  }
  expect(fake.events).toEqual(["launch", "context-open", "context-close", "context-open", "context-close"]);
  await pool.close(); expect(fake.events.at(-1)).toBe("browser-close");
});

test("borrowed launch failures expose availability, while busy capacity retains its retry code", async () => {
  const input = { url: "https://public.example/", maxChars: 100, waitFor: 0 };
  const httpClient = { send: async () => { throw new Error("no requests expected"); } };
  const unavailable = createRenderBrowserPool({ launch: async () => { throw new Error("sandbox launch failed"); } });
  await expect(renderPublicPage({ input, httpClient }, { browserPool: unavailable })).rejects.toMatchObject({ code: "WEB_RENDER_UNAVAILABLE" });
  const fake = fixture(); const busy = createRenderBrowserPool({ launch: fake.launch }, { maxConcurrent: 1, timers: fake.timerPort });
  const held = await busy.acquire({});
  await expect(renderPublicPage({ input, httpClient }, { browserPool: busy })).rejects.toMatchObject({ code: "WEB_RENDER_BUSY" });
  held.release(); await busy.close();
});
