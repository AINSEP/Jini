import assert from "node:assert/strict";
import { test } from "vitest";

import { createLazyBrowser, type LazyBrowserTimers } from "../lazy-browser.js";

/**
 * @file The lazy browser owner: one lazily launched browser, reused, closed on demand or after
 * idle. Fake browser and timers.
 */

function fakeTimers() {
  const scheduled = new Map<number, { work: () => void; ms: number }>();
  let next = 0;
  const timers: LazyBrowserTimers = {
    setTimeout: (work, ms) => { next += 1; scheduled.set(next, { work, ms }); return next; },
    clearTimeout: (handle) => { scheduled.delete(handle as number); },
  };
  return { timers, scheduled, fire: () => { for (const [id, entry] of [...scheduled]) { scheduled.delete(id); entry.work(); } } };
}

function fakeLaunch({ failFirst = false }: { failFirst?: boolean } = {}) {
  const events: string[] = [];
  let launches = 0;
  return {
    events,
    launch: async () => {
      launches += 1;
      events.push(`launch:${launches}`);
      if (failFirst && launches === 1) throw new Error("Executable doesn't exist");
      const id = launches;
      return { id, close: async () => { events.push(`close:${id}`); } };
    },
  };
}

test("launches once, reuses the same browser, and close() closes it exactly once", async () => {
  const { events, launch } = fakeLaunch();
  const browser = createLazyBrowser({ launch });
  const first = await browser.acquire();
  const second = await browser.acquire();
  assert.equal(first, second);
  await browser.close();
  await browser.close();
  assert.deepEqual(events, ["launch:1", "close:1"]);
});

test("a failed launch is not cached: the next acquire launches again", async () => {
  const { events, launch } = fakeLaunch({ failFirst: true });
  const browser = createLazyBrowser({ launch });
  await assert.rejects(browser.acquire(), /Executable doesn't exist/);
  assert.equal((await browser.acquire()).id, 2);
  await browser.close();
  assert.deepEqual(events, ["launch:1", "launch:2", "close:2"]);
});

test("release schedules an idle close; a new acquire before it fires cancels it", async () => {
  const { events, launch } = fakeLaunch();
  const { timers, scheduled, fire } = fakeTimers();
  const browser = createLazyBrowser({ launch }, { idleCloseMs: 60_000, timers });
  await browser.acquire();
  browser.release();
  assert.deepEqual([...scheduled.values()].map((entry) => entry.ms), [60_000]);
  await browser.acquire();
  assert.equal(scheduled.size, 0, "acquiring again must cancel the pending idle close");
  browser.release();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["launch:1", "close:1"]);
  assert.equal((await browser.acquire()).id, 2, "after an idle close the next use relaunches");
});

test("release without idleCloseMs, or with nothing launched, schedules nothing", async () => {
  const { timers, scheduled } = fakeTimers();
  createLazyBrowser({ launch: fakeLaunch().launch }, { idleCloseMs: 10, timers }).release();
  const noIdle = createLazyBrowser({ launch: fakeLaunch().launch }, { timers });
  await noIdle.acquire();
  noIdle.release();
  assert.equal(scheduled.size, 0);
});
