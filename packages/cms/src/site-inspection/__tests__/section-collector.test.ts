import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { authorizeAndCollectSection, resolveRequestedSections, SectionUnavailableError } from "../section-collector.js";

const spec = {
  workspaceId: "ws-review", principalId: "reviewer", section: "plugins",
  permission: "admin.plugins.read", entityType: "site-profile-section",
  logLabel: "site-profile", timeoutMs: 75, reportFailure: () => {},
};

// F2.5/F4.1: dropping the section identity or leaking the error message must fail.
test("collection waits for authorization, preserves truncation, and scopes the decision", async () => {
  let grant!: (value: { allowed: boolean; reason: string }) => void;
  const permission = new Promise<{ allowed: boolean; reason: string }>((resolve) => { grant = resolve; });
  const seen: unknown[] = [];
  let reads = 0;
  const pending = authorizeAndCollectSection({ ...spec,
    authorize: (params) => { seen.push(params); return permission; },
    collect: async () => { reads++; return { data: ["plugin-9"], truncated: true }; },
  });
  assert.equal(reads, 0);
  assert.deepEqual(seen, [{ principalId: "reviewer", permission: "admin.plugins.read", workspaceId: "ws-review", entityType: "site-profile-section", entityId: "plugins" }]);
  grant({ allowed: true, reason: "matched" });
  assert.deepEqual(await pending, { status: "ok", data: ["plugin-9"], truncated: true });
  assert.equal(reads, 1);
});

test("known unavailable reasons and non-Error throws are safe, and the next read can recover", async () => {
  const authorize = async () => ({ allowed: true, reason: "matched" });
  assert.deepEqual(await authorizeAndCollectSection({ ...spec, authorize, collect: async () => { throw new SectionUnavailableError({ reason: "not-wired" }); } }), { status: "unavailable", reason: "not-wired" });
  assert.deepEqual(await authorizeAndCollectSection({ ...spec, authorize, collect: async () => { throw "SECRET"; } }), { status: "unavailable", reason: "UnknownError" });
  assert.deepEqual(await authorizeAndCollectSection({ ...spec, authorize, collect: async () => ({ data: 0, truncated: false }) }), { status: "ok", data: 0 });
});

// BUG: authorize is outside the error boundary, so one auth-store fault aborts the aggregate.
test("an authorization backend failure becomes unavailable without reading or leaking its message", async () => {
  let reads = 0;
  const result = await authorizeAndCollectSection({ ...spec,
    authorize: async () => { throw new TypeError("SECRET_AUTH_CONNECTION"); },
    collect: async () => { reads++; return { data: "private" }; },
  });
  assert.deepEqual(result, { status: "unavailable", reason: "TypeError" });
  assert.equal(reads, 0);
});

test("requested sections are deduplicated in vocabulary order, and defaults return a fresh list", () => {
  const vocabulary = Object.freeze(["pages", "theme", "plugins"]);
  assert.deepEqual(resolveRequestedSections({ vocabulary, requested: ["plugins", "pages", "plugins"] }), ["pages", "plugins"]);
  assert.deepEqual(resolveRequestedSections({ vocabulary, requested: [] }), ["pages", "theme", "plugins"]);
  const defaults = resolveRequestedSections({ vocabulary, requested: undefined });
  defaults.pop();
  assert.deepEqual(vocabulary, ["pages", "theme", "plugins"]);
});

test("a denied section reports its authorization reason without collecting data", async () => {
  let reads = 0;
  const result = await authorizeAndCollectSection({ ...spec,
    authorize: async () => ({ allowed: false, reason: "missing-plugin-grant" }),
    collect: async () => { reads++; return { data: "private" }; },
  });
  assert.deepEqual(result, { status: "forbidden", reason: "missing-plugin-grant" });
  assert.equal(reads, 0);
});

// F7.1/F6.2: advance to each side of the configured deadline while the read stays held.
test("a held read stays pending before the deadline and reports timed-out at the deadline", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  let finish!: (value: { data: string }) => void;
  const work = new Promise<{ data: string }>((resolve) => { finish = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let settled = false;
  const pending = authorizeAndCollectSection({ ...spec,
    authorize: async () => ({ allowed: true, reason: "matched" }),
    collect: () => { entered(); return work; },
  }).then((result) => { settled = true; return result; });
  await started;
  try {
    vi.advanceTimersByTime(74);
    // Drain the promise chain so an early timeout is observable before asserting.
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(() => queueMicrotask(resolve))));
    assert.equal(settled, false);
    vi.advanceTimersByTime(1);
    assert.deepEqual(await pending, { status: "unavailable", reason: "timed-out" });
  } finally {
    vi.useRealTimers();
    finish({ data: "late read" });
  }
});

test("a failed section reports its label, section and full error to the injected reporter only", async () => {
  const reported: { label: string; section: string; error: unknown }[] = [];
  const error = new RangeError("SECRET_READ_FAILURE");
  const result = await authorizeAndCollectSection({ ...spec,
    reportFailure: (failure) => { reported.push(failure); },
    authorize: async () => ({ allowed: true, reason: "matched" }),
    collect: async () => { throw error; },
  });
  assert.deepEqual(result, { status: "unavailable", reason: "RangeError" });
  assert.deepEqual(reported, [{ label: "site-profile", section: "plugins", error }]);
});

test("a granted, successful section reports nothing", async () => {
  const reported: unknown[] = [];
  await authorizeAndCollectSection({ ...spec,
    reportFailure: (failure) => { reported.push(failure); },
    authorize: async () => ({ allowed: true, reason: "matched" }),
    collect: async () => ({ data: 1 }),
  });
  assert.deepEqual(reported, []);
});
