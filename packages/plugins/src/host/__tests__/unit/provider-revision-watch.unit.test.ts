import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { watchProviderRevisions } from '../../provider-revision-watch.js';

const pluginIdOf = ({ keyId }: { keyId: string }) => /^plugin-state:([a-z0-9-]+):provider\.config$/.exec(keyId)?.[1];

test("one scheduled metadata read notices revision, attachment and detach changes and stops after close", async () => {
  const key = "plugin-state:analytics-example:provider.config";
  let rows = [{ id: key, revision: 1, attached_at: "first" }];
  let check!: () => Promise<void>; let cancelled = 0; const applied: string[] = [];
  const stop = watchProviderRevisions({ read: async () => rows, pluginIdOf, reapply: async ({ pluginId }) => { applied.push(pluginId); return "now"; } }, {
    schedule: ({ run, intervalMs }) => { assert.equal(intervalMs, 30_000); check = run; return () => { cancelled++; }; },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(applied, ["analytics-example"]);
  await check(); assert.equal(applied.length, 1);
  rows = [{ id: key, revision: 2, attached_at: "first" }];
  await check(); assert.equal(applied.length, 2);
  rows = [{ id: key, revision: 2, attached_at: "reattached" }];
  await check(); assert.equal(applied.length, 3);
  rows = []; await check(); assert.equal(applied.length, 4);
  stop(); await check(); assert.equal(applied.length, 4); assert.equal(cancelled, 1);
});

test("site revisions apply without a project store, and identical ids in both stores remain observable", async () => {
  const id = "plugin-state:analytics-example:provider.config";
  let site = [{ id, revision: 1 }];
  let project: { id: string; revision: number; attached_at: string }[] = [];
  let check!: () => Promise<void>;
  const applied: string[] = [];
  const stop = watchProviderRevisions({ read: async () => project, pluginIdOf,
    reapply: async ({ pluginId }) => { applied.push(pluginId); return "now"; },
  }, { readSite: async () => site, schedule: ({ run }) => { check = run; return () => {}; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(applied, ["analytics-example"]);
  site = [{ id, revision: 2 }]; await check();
  assert.equal(applied.length, 2);
  project = [{ id, revision: 1, attached_at: "attached" }]; await check();
  assert.equal(applied.length, 3);
  site = [{ id, revision: 3 }]; await check();
  assert.equal(applied.length, 4, "a project sibling cannot mask the site's changed revision");
  project = [{ id, revision: 2, attached_at: "attached" }]; await check();
  assert.equal(applied.length, 5);
  site = []; await check(); assert.equal(applied.length, 6);
  stop();
});

test("without an injected schedule the watcher polls every 30 s on a real interval and stops polling on close", async () => {
  vi.useFakeTimers();
  try {
    let reads = 0;
    const stop = watchProviderRevisions({ read: async () => { reads += 1; return []; }, pluginIdOf, reapply: async () => "now" });
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(reads, 1, "the first check runs immediately");
    await vi.advanceTimersByTimeAsync(29_999);
    assert.equal(reads, 1);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(reads, 2, "then once per 30 s interval");
    stop();
    await vi.advanceTimersByTimeAsync(90_000);
    assert.equal(reads, 2, "close clears the interval");
  } finally { vi.useRealTimers(); }
});
