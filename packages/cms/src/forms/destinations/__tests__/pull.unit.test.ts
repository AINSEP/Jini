import assert from "node:assert/strict";
import { test } from "vitest";

import type { FormDestinationKit, FormDestinationPage, RemoteFormSubmission } from "../../index.js";
import { FORM_PULL_BUDGET_MS, FORM_PULL_LEASE_MS, FORM_PULL_REQUEST_TIMEOUT_MS, formDestinationKey, pullFromFormDestination } from "../pull.js";

/** @file Page loop, acknowledge-only-committed and key redaction for the generic form destination pull. */

const KEY = "k".repeat(43);
const destination = { url: "https://site.example/", secret: KEY };
const kit = {} as FormDestinationKit;
const item = (seq: number): RemoteFormSubmission => ({ seq, id: `r${seq}`, formSlug: "waitlist", answers: {}, submittedAt: "2026-10-19T10:00:00.000Z", ip: null });

function host(pages: FormDestinationPage[]) {
  const calls: { after?: number; limit?: number }[] = [];
  const acks: string[][] = [];
  return { calls, acks, module: {
    pull: async (_required: unknown, optional?: { after?: number; limit?: number }) => { calls.push(optional ?? {}); return pages.shift() ?? { items: [], nextAfter: 0, hasMore: false }; },
    ack: async ({ ids }: { ids: readonly string[] }) => { acks.push([...ids]); return { acknowledged: ids.length }; },
  } };
}

test("pages are imported in order and only committed ids are acknowledged, once each", async () => {
  const h = host([{ items: [item(1), item(2)], nextAfter: 2, hasMore: true }, { items: [item(3)], nextAfter: 3, hasMore: false }]);
  const seen: string[] = [];
  const result = await pullFromFormDestination({ module: h.module, scope: "host-a", destination, kit, importPage: async ({ items, destinationKey }) => {
    seen.push(destinationKey);
    return { committedIds: items.filter((row) => row.seq !== 2).flatMap((row) => [row.id, row.id]) };
  } }, { pageSize: 2 });
  assert.deepEqual(h.calls, [{ after: 0, limit: 2 }, { after: 2, limit: 2 }]);
  assert.deepEqual(h.acks, [["r1"], ["r3"]], "r2 was not committed, so it stays pending at the host");
  assert.deepEqual(seen, ["host-a:https://site.example", "host-a:https://site.example"]);
  assert.deepEqual({ ...result, pages: result.pages.length }, { destinationKey: "host-a:https://site.example", pulled: 3, acknowledged: 2, hasMore: false, pages: 2 });
});

test("an empty first page ends the pull; a page with nothing committed sends no acknowledgement", async () => {
  const empty = host([]);
  assert.deepEqual(await pullFromFormDestination({ module: empty.module, scope: "t", destination, kit, importPage: async () => ({ committedIds: [] }) }),
    { destinationKey: "t:https://site.example", pulled: 0, acknowledged: 0, hasMore: false, pages: [] });
  const skipped = host([{ items: [item(1)], nextAfter: 1, hasMore: false }]);
  await pullFromFormDestination({ module: skipped.module, scope: "t", destination, kit, importPage: async () => ({ committedIds: [] }) });
  assert.deepEqual(skipped.acks, []);
});

test("the page cap stops the loop and reports that more rows are waiting", async () => {
  const h = host([{ items: [item(1)], nextAfter: 1, hasMore: true }, { items: [item(2)], nextAfter: 2, hasMore: true }]);
  const result = await pullFromFormDestination({ module: h.module, scope: "t", destination, kit, importPage: async ({ items }) => ({ committedIds: items.map((row) => row.id) }) }, { maxPages: 1 });
  assert.equal(result.hasMore, true);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], { after: 0, limit: 50 }, "default page size");
});

test("a scope no installed destination resolves is refused with the next step", async () => {
  await assert.rejects(pullFromFormDestination({ module: {}, scope: "pages-like", destination, kit, importPage: async () => ({ committedIds: [] }) }),
    /no installed form destination returns submissions for pages-like\. Turn on the plugin that provides it/);
});

test("host and import failures name the address and never the key", async () => {
  const h = host([]);
  h.module.pull = async () => { throw new Error(`401 for Bearer ${KEY}`); };
  await assert.rejects(pullFromFormDestination({ module: h.module, scope: "t", destination, kit, importPage: async () => ({ committedIds: [] }) }), (error: Error) => {
    assert.equal(error.message.includes(KEY), false);
    assert.match(error.message, /^pulling form submissions from https:\/\/site\.example stopped: 401 for Bearer \[redacted\]\. Rows not yet acknowledged stay at the host/);
    return true;
  });
  const failing = host([{ items: [item(1)], nextAfter: 1, hasMore: false }]);
  await assert.rejects(pullFromFormDestination({ module: failing.module, scope: "t", destination, kit, importPage: async () => { throw "store offline"; } }), /stopped: store offline\./);
  assert.deepEqual(failing.acks, []);
});

test("destination keys use the origin only", () => {
  assert.equal(formDestinationKey({ scope: "t", url: "https://Site.Example:443/a?b" }), "t:https://site.example");
});

test("without overrides a pull stops after 10 pages of 50, two receiver requests per page (the bound the pull lease relies on)", async () => {
  const pages = Array.from({ length: 12 }, (_, index): FormDestinationPage => ({ items: [item(index + 1)], nextAfter: index + 1, hasMore: true }));
  const h = host(pages);
  const result = await pullFromFormDestination({ module: h.module, scope: "t", destination, kit, importPage: async ({ items }) => ({ committedIds: items.map((row) => row.id) }) });
  assert.equal(h.calls.length, 10);
  assert.equal(h.acks.length, 10);
  assert.ok(h.calls.every((call) => call.limit === 50));
  assert.equal(result.hasMore, true);
});

// ---- Security pin (phase A): the pull lease must outlast the slowest bounded pull. ----

test("security: the pull lease outlasts the worst-case pull (the time budget, one capped request, then local work)", () => {
  assert.equal(FORM_PULL_REQUEST_TIMEOUT_MS, 15_000);
  assert.equal(FORM_PULL_BUDGET_MS, 300_000);
  // No request starts after budget + one request, and none waits past it; the 60 s margin covers
  // the last page's local import and clock drift.
  assert.equal(FORM_PULL_LEASE_MS, FORM_PULL_BUDGET_MS + FORM_PULL_REQUEST_TIMEOUT_MS + 60_000);
});

/** A wall clock a test moves by hand. */
function manualClock() {
  let nowMs = 1_000_000;
  return { now: () => nowMs, advance: (ms: number) => { nowMs += ms; } };
}

test("security: a slow receiver stops paging once the time budget is spent, and more is reported waiting", async () => {
  const clock = manualClock();
  const pages = Array.from({ length: 10 }, (_, index): FormDestinationPage => ({ items: [item(index + 1)], nextAfter: index + 1, hasMore: true }));
  const h = host(pages);
  // Each page's pull takes 100 s of wall clock; the third ends exactly at the 300 s budget.
  const module = { ...h.module, pull: async (required: unknown, optional?: { after?: number; limit?: number }) => { clock.advance(100_000); return h.module.pull(required, optional); } };
  const result = await pullFromFormDestination({ module, scope: "t", destination, kit, importPage: async ({ items }) => ({ committedIds: items.map((row) => row.id) }) }, { now: clock.now });
  assert.equal(h.calls.length, 3);
  assert.deepEqual([result.pulled, result.acknowledged, result.hasMore], [3, 3, true]);
});

test("security: a request waits at most until budget + one request, and none starts after it", async () => {
  const clock = manualClock();
  const asked: number[] = [];
  const kitSpy: FormDestinationKit = { timeouts: {}, fetch: async (_url, _init, options) => { asked.push(options.timeoutMs); return new Response("{}"); } };
  const deadlineMs = FORM_PULL_BUDGET_MS + FORM_PULL_REQUEST_TIMEOUT_MS;
  const module = {
    pull: async ({ kit: given }: { kit: FormDestinationKit }) => {
      clock.advance(deadlineMs - 5_000);
      await given.fetch("https://site.example/pull", {}, { timeoutMs: 15_000 });
      clock.advance(5_000);
      await given.fetch("https://site.example/pull", {}, { timeoutMs: 15_000 });
      return { items: [], nextAfter: 0, hasMore: false };
    },
    ack: async () => ({ acknowledged: 0 }),
  };
  await assert.rejects(pullFromFormDestination({ module, scope: "t", destination, kit: kitSpy, importPage: async () => ({ committedIds: [] }) }, { now: clock.now }),
    { message: "pulling form submissions from https://site.example stopped: the pull used up its 300 s time budget. Rows not yet acknowledged stay at the host; pull again later." });
  assert.deepEqual(asked, [5_000], "the request inside the budget waits only for the time left; the one after it never starts");
});

test("security: a module asking for a longer request timeout is cut to the pull's 15 s cap; a shorter one is kept", async () => {
  const asked: number[] = [];
  const kitSpy: FormDestinationKit = { timeouts: {}, fetch: async (_url, _init, options) => { asked.push(options.timeoutMs); return new Response("{}"); } };
  const module = {
    pull: async ({ kit: given }: { kit: FormDestinationKit }) => {
      await given.fetch("https://site.example/pull", {}, { timeoutMs: 120_000 });
      await given.fetch("https://site.example/pull", {}, { timeoutMs: 5_000 });
      return { items: [], nextAfter: 0, hasMore: false };
    },
    ack: async () => ({ acknowledged: 0 }),
  };
  await pullFromFormDestination({ module, scope: "t", destination, kit: kitSpy, importPage: async () => ({ committedIds: [] }) });
  assert.deepEqual(asked, [FORM_PULL_REQUEST_TIMEOUT_MS, 5_000]);
});

test("the bounded kit hands the module the caller's other kit members and the request's url and init unchanged", async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const timeouts = { request: 9_000 };
  const kitSpy: FormDestinationKit = { timeouts, now: () => 123, fetch: async (url, init) => { sent.push({ url, init }); return new Response("{}"); } };
  const init: RequestInit = { method: "POST", headers: { authorization: "Bearer from-module" } };
  let seen: FormDestinationKit | undefined;
  const module = {
    pull: async ({ kit: given }: { kit: FormDestinationKit }) => { seen = given; await given.fetch("https://site.example/pull?after=0", init, { timeoutMs: 1_000 }); return { items: [], nextAfter: 0, hasMore: false }; },
    ack: async () => ({ acknowledged: 0 }),
  };
  await pullFromFormDestination({ module, scope: "t", destination, kit: kitSpy, importPage: async () => ({ committedIds: [] }) });
  assert.equal(seen?.timeouts, timeouts);
  assert.equal(seen?.now?.(), 123);
  assert.deepEqual(sent, [{ url: "https://site.example/pull?after=0", init }]);
});

test("acknowledgement requests go through the same bounded kit as page requests", async () => {
  const asked: number[] = [];
  const kitSpy: FormDestinationKit = { timeouts: {}, fetch: async (_url, _init, options) => { asked.push(options.timeoutMs); return new Response("{}"); } };
  const module = {
    pull: async () => ({ items: [item(1)], nextAfter: 1, hasMore: false }),
    ack: async ({ kit: given, ids }: { kit: FormDestinationKit; ids: readonly string[] }) => { await given.fetch("https://site.example/ack", {}, { timeoutMs: 60_000 }); return { acknowledged: ids.length }; },
  };
  const result = await pullFromFormDestination({ module, scope: "t", destination, kit: kitSpy, importPage: async ({ items }) => ({ committedIds: items.map((row) => row.id) }) });
  assert.deepEqual(asked, [FORM_PULL_REQUEST_TIMEOUT_MS]);
  assert.equal(result.acknowledged, 1);
});

test("a pull whose budget runs out while the last page imports still acknowledges that page, then stops with more waiting", async () => {
  const clock = manualClock();
  const h = host([{ items: [item(1)], nextAfter: 1, hasMore: true }, { items: [item(2)], nextAfter: 2, hasMore: true }]);
  const result = await pullFromFormDestination({ module: h.module, scope: "t", destination, kit,
    importPage: async ({ items }) => { clock.advance(FORM_PULL_BUDGET_MS); return { committedIds: items.map((row) => row.id) }; } }, { now: clock.now });
  assert.deepEqual(h.acks, [["r1"]]);
  assert.deepEqual([h.calls.length, result.pulled, result.hasMore], [1, 1, true]);
});
