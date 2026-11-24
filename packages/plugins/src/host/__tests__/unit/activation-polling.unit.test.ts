// Moved from the host composition tests with the polling module; assertions unchanged (node:assert under vitest).
import assert from "node:assert/strict";
import { test } from "vitest";

import { reconcilePluginActivationsOnce, type PluginActivationPollDeps } from "../../activation-polling.js";
import { InMemoryPluginActivationRepo } from "../../repo.memory.js";

/**
 * @file P0b (hooks v2 plan, 2026-09-23) — the agent daemon and the admin process each build their
 * own `composePluginRuntime()`, so each has its own in-memory hook registry. Enabling a plugin
 * through the admin HTTP path never reaches an already-running daemon's registry on its own.
 * `reconcilePluginActivationsOnce` is the one reconciliation pass `startPluginActivationPolling`
 * runs on a timer; these tests exercise it directly, without any real timer.
 */

const WORKSPACE = "ws-1";

function record(pluginId: string, enabled: boolean) {
  return { pluginId, workspaceId: WORKSPACE, version: "1.0.0", enabled, updatedAt: "2026-09-23T00:00:00.000Z" };
}

test("a plugin newly enabled in the durable repo is attached, and its id is added to attachedIds", async () => {
  const repo = new InMemoryPluginActivationRepo({ initialRows: [record("word-count", true)] });
  const enabledCalls: string[] = [];
  const deps: PluginActivationPollDeps = {
    logger: silentLogger,
    workspaceId: WORKSPACE,
    pluginActivationRepo: repo,
    onPluginEnabled: async (pluginId) => {
      enabledCalls.push(pluginId);
    },
    onPluginDisabled: () => assert.fail("must not disable a plugin this pass never attached"),
  };
  const attachedIds = new Set<string>();

  await reconcilePluginActivationsOnce({ deps, attachedIds });

  assert.deepEqual(enabledCalls, ["word-count"]);
  assert.ok(attachedIds.has("word-count"));
});

test("an already-attached plugin is NOT re-attached on a later pass — no redundant reload, no reset quarantine counter", async () => {
  const repo = new InMemoryPluginActivationRepo({ initialRows: [record("word-count", true)] });
  let enabledCallCount = 0;
  const deps: PluginActivationPollDeps = {
    logger: silentLogger,
    workspaceId: WORKSPACE,
    pluginActivationRepo: repo,
    onPluginEnabled: async () => {
      enabledCallCount += 1;
    },
    onPluginDisabled: () => assert.fail("must not disable a plugin that is still enabled"),
  };
  const attachedIds = new Set(["word-count"]);

  await reconcilePluginActivationsOnce({ deps, attachedIds });

  assert.equal(enabledCallCount, 0, "word-count was already in attachedIds — this pass must not call onPluginEnabled again");
});

test("a plugin disabled elsewhere (no longer in the durable enabled set) is detached and dropped from attachedIds", async () => {
  const repo = new InMemoryPluginActivationRepo({ initialRows: [record("word-count", false)] });
  const disabledCalls: string[] = [];
  const deps: PluginActivationPollDeps = {
    logger: silentLogger,
    workspaceId: WORKSPACE,
    pluginActivationRepo: repo,
    onPluginEnabled: async () => assert.fail("must not attach a plugin the durable repo marks disabled"),
    onPluginDisabled: (pluginId) => {
      disabledCalls.push(pluginId);
    },
  };
  const attachedIds = new Set(["word-count"]);

  await reconcilePluginActivationsOnce({ deps, attachedIds });

  assert.deepEqual(disabledCalls, ["word-count"]);
  assert.ok(!attachedIds.has("word-count"));
});

test("a workspace this daemon does not serve is ignored, even if enabled there", async () => {
  const repo = new InMemoryPluginActivationRepo({ initialRows: [{ ...record("word-count", true), workspaceId: "some-other-workspace" }] });
  const deps: PluginActivationPollDeps = {
    logger: silentLogger,
    workspaceId: WORKSPACE,
    pluginActivationRepo: repo,
    onPluginEnabled: async () => assert.fail("must not attach a plugin enabled for a different workspace"),
    onPluginDisabled: () => assert.fail("must not touch attachedIds over a different workspace's row"),
  };
  await reconcilePluginActivationsOnce({ deps, attachedIds: new Set() });
});

test("one plugin's attach failure is logged and skipped, never blocking reconciliation of the rest", async () => {
  const repo = new InMemoryPluginActivationRepo({ initialRows: [record("broken-plugin", true), record("word-count", true)] });
  const enabledCalls: string[] = [];
  const deps: PluginActivationPollDeps = {
    logger: silentLogger,
    workspaceId: WORKSPACE,
    pluginActivationRepo: repo,
    onPluginEnabled: async (pluginId) => {
      if (pluginId === "broken-plugin") throw new Error("package missing from disk");
      enabledCalls.push(pluginId);
    },
    onPluginDisabled: () => assert.fail("must not disable anything on this pass"),
  };
  const attachedIds = new Set<string>();

  await reconcilePluginActivationsOnce({ deps, attachedIds });

  assert.deepEqual(enabledCalls, ["word-count"], "the working plugin must still attach despite the broken one throwing");
  assert.ok(!attachedIds.has("broken-plugin"), "a failed attach must not be recorded as attached");
  assert.ok(attachedIds.has("word-count"));
});

/** A logger port for these tests: each line is the message joined to the error-bag value's own text
 * (formatting the host's logger would do), so the assertions see what reached the bag. */
function recordingLogger() {
  const warnings: string[] = [];
  const infos: string[] = [];
  const line = ({ message }: { message: string }, optional?: { error?: unknown }) =>
    optional !== undefined && "error" in optional ? `${message}: ${optional.error instanceof Error ? optional.error.message : String(optional.error)}` : message;
  const logger = {
    info: (required: { message: string }, optional?: { error?: unknown }) => void infos.push(line(required, optional)),
    warn: (required: { message: string }, optional?: { error?: unknown }) => void warnings.push(line(required, optional)),
    error: (required: { message: string }, optional?: { error?: unknown }) => void warnings.push(line(required, optional)),
  };
  return { warnings, infos, logger };
}
const silentLogger = recordingLogger().logger;

// 2026-11-13: a plugin that kept failing (charts-recharts, INTEGRITY_FAILED) logged the same line on
// every 5 s poll: 5,895 identical lines in one day. One line per distinct failure, then back off.
test("a plugin that keeps failing the same way is logged once, and retried with backoff, not every pass", async () => {
  const { warnings, logger } = recordingLogger();
  const repo = new InMemoryPluginActivationRepo({ initialRows: [record("broken-plugin", true)] });
  let attempts = 0;
  const deps: PluginActivationPollDeps = {
    logger,
    workspaceId: WORKSPACE,
    pluginActivationRepo: repo,
    onPluginEnabled: async () => { attempts += 1; throw new Error("plugin 'broken-plugin' failed to load (INTEGRITY_FAILED)"); },
    onPluginDisabled: () => assert.fail("must not disable anything"),
  };
  const attachedIds = new Set<string>();
  const failures = new Map();

  for (let pass = 0; pass < 20; pass += 1) await reconcilePluginActivationsOnce({ deps, attachedIds, failures });

  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0]!, /failed to attach 'broken-plugin'.*INTEGRITY_FAILED/);
  assert.ok(attempts >= 2 && attempts <= 6, `backoff: expected a few retries in 20 passes, got ${attempts}`);
});

test("a NEW failure for the same plugin is logged again, and a recovery is logged once", async () => {
  const { warnings, infos: logs, logger } = recordingLogger();
  const repo = new InMemoryPluginActivationRepo({ initialRows: [record("flaky", true)] });
  let error: string | undefined = "first problem";
  const deps: PluginActivationPollDeps = {
    logger,
    workspaceId: WORKSPACE,
    pluginActivationRepo: repo,
    onPluginEnabled: async () => { if (error) throw new Error(error); },
    onPluginDisabled: () => assert.fail("must not disable anything"),
  };
  const attachedIds = new Set<string>();
  const failures = new Map();

  await reconcilePluginActivationsOnce({ deps, attachedIds, failures });
  error = "second problem";
  for (let pass = 0; pass < 200 && warnings.length < 2; pass += 1) await reconcilePluginActivationsOnce({ deps, attachedIds, failures });
  error = undefined;
  for (let pass = 0; pass < 200 && !attachedIds.has("flaky"); pass += 1) await reconcilePluginActivationsOnce({ deps, attachedIds, failures });

  assert.equal(warnings.length, 2, warnings.join("\n"));
  assert.match(warnings[1]!, /second problem/);
  assert.ok(attachedIds.has("flaky"), "a later attempt must still succeed: backoff never gives up");
  assert.equal(logs.filter(line => line.includes("'flaky'")).length, 1, logs.join("\n"));
});
