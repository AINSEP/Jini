import assert from "node:assert/strict";
import { test } from "vitest";

import type { RemoveEntity } from "../../ports.js";
import { InMemoryPluginActivationRepo } from "../support/repo.memory.js";
import type { PluginDiscoveryRecord } from "../support/discovery.js";
import {
  PluginAlreadyInTrashError,
  PluginChangedSincePreviewError,
  PluginEnabledError,
  PluginNotUninstallableError,
  uninstallPlugin,
  previewUninstallPlugin,
  forgetPluginActivations,
  type UninstallPluginRequired,
} from "../support/uninstall.js";

const WS = "ws-1";
const AT = "2026-09-22T00:00:00.000Z";
const ACTOR = { principalId: "principal-1" };

const SITE: PluginDiscoveryRecord = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  source: "site",
  tier: "tier-3",
  status: "valid",
  errors: [],
};

interface RequestHarness {
  required: UninstallPluginRequired;
  removeCalls: Parameters<RemoveEntity>[0][];
}

function requestFor(
  record: PluginDiscoveryRecord,
  repo: InMemoryPluginActivationRepo,
  result: Awaited<ReturnType<RemoveEntity>> = { ok: true, version: null },
): RequestHarness {
  const removeCalls: Parameters<RemoveEntity>[0][] = [];
  const remove: RemoveEntity = async (required) => {
    removeCalls.push(required);
    return result;
  };
  return {
    required: {
      deps: { repo, discovery: [record], remove },
      input: { pluginId: record.id, workspaceId: WS, at: AT, actor: ACTOR },
    },
    removeCalls,
  };
}

async function saveDisabled(repo: InMemoryPluginActivationRepo): Promise<void> {
  await repo.save({
    pluginId: SITE.id,
    workspaceId: WS,
    version: SITE.version,
    enabled: false,
    updatedAt: AT,
  });
}

test("a confirmed preview refuses when the record's version no longer matches", async () => {
  const repo = new InMemoryPluginActivationRepo();
  await saveDisabled(repo);
  const changed: PluginDiscoveryRecord = { ...SITE, version: "2.0.0" };
  const h = requestFor(changed, repo);

  await assert.rejects(
    () => uninstallPlugin(h.required, { confirmedPreview: { pluginId: SITE.id, name: SITE.name, version: SITE.version } }),
    (error: unknown) =>
      error instanceof PluginChangedSincePreviewError &&
      error.message === "plugin 'my-plugin' changed after its uninstall was previewed (previewed My Plugin 1.0.0; now My Plugin 2.0.0) — nothing was removed",
  );
  assert.deepEqual(h.removeCalls, []);
  assert.equal((await repo.listAll()).length, 1);
});

test("a confirmed preview refuses when the record's name changed", async () => {
  const repo = new InMemoryPluginActivationRepo();
  await saveDisabled(repo);
  const renamed: PluginDiscoveryRecord = { ...SITE, name: "Someone Else's Plugin" };
  const h = requestFor(renamed, repo);

  await assert.rejects(
    () => uninstallPlugin(h.required, { confirmedPreview: { pluginId: SITE.id, name: SITE.name, version: SITE.version } }),
    PluginChangedSincePreviewError,
  );
  assert.deepEqual(h.removeCalls, []);
  assert.equal((await repo.listAll()).length, 1);
});

test("an unchanged target delegates to remove with the discovery display and keeps activation rows", async () => {
  const repo = new InMemoryPluginActivationRepo();
  await saveDisabled(repo);
  const h = requestFor(SITE, repo);

  assert.deepEqual(
    await uninstallPlugin(h.required, { confirmedPreview: { pluginId: SITE.id, name: SITE.name, version: SITE.version } }),
    { trashed: true },
  );
  assert.equal(h.removeCalls.length, 1);
  assert.deepEqual(h.removeCalls[0], {
    workspaceId: WS,
    id: SITE.id,
    display: { title: SITE.name, subtitle: `${SITE.id} ${SITE.version}` },
    at: AT,
    expectedVersion: null,
    actor: ACTOR,
  });
  assert.equal((await repo.listAll()).length, 1);
});

test("a built-in plugin is refused before remove", async () => {
  const repo = new InMemoryPluginActivationRepo();
  const h = requestFor({ ...SITE, source: "built-in" }, repo);

  await assert.rejects(() => uninstallPlugin(h.required), PluginNotUninstallableError);
  assert.deepEqual(h.removeCalls, []);
});

test("a plugin enabled in any workspace is refused before remove", async () => {
  const repo = new InMemoryPluginActivationRepo();
  await repo.save({ pluginId: SITE.id, workspaceId: "ws-2", version: SITE.version, enabled: true, updatedAt: AT });
  const h = requestFor(SITE, repo);

  await assert.rejects(() => uninstallPlugin(h.required), PluginEnabledError);
  assert.deepEqual(h.removeCalls, []);
});

test("an already-parked plugin becomes PluginAlreadyInTrashError", async () => {
  const repo = new InMemoryPluginActivationRepo();
  await saveDisabled(repo);
  const h = requestFor(SITE, repo, { ok: false, reason: "blocked", code: "ALREADY_IN_TRASH", count: 1 });

  await assert.rejects(() => uninstallPlugin(h.required), PluginAlreadyInTrashError);
  assert.equal(h.removeCalls.length, 1);
  assert.equal((await repo.listAll()).length, 1);
});

for (const activated of [true, false]) {
  test(`uninstall without preview succeeds for ${activated ? "disabled" : "never-activated"} plugin`, async () => {
    const repo = new InMemoryPluginActivationRepo();
    if (activated) await saveDisabled(repo);
    const before = await repo.listAll();
    const h = requestFor(SITE, repo);
    assert.deepEqual(await uninstallPlugin(h.required), { trashed: true });
    assert.deepEqual(h.removeCalls, [{ workspaceId: WS, id: SITE.id, display: { title: SITE.name, subtitle: `${SITE.id} ${SITE.version}` }, at: AT, expectedVersion: null, actor: ACTOR }]);
    assert.deepEqual(await repo.listAll(), before);
  });
}

test("preview reports exact identity without removing files or changing activation rows", async () => {
  const repo = new InMemoryPluginActivationRepo();
  await saveDisabled(repo);
  const before = await repo.listAll();
  const h = requestFor(SITE, repo);
  assert.deepEqual(await previewUninstallPlugin(h.required), { pluginId: "my-plugin", name: "My Plugin", version: "1.0.0" });
  assert.deepEqual(h.removeCalls, []);
  assert.deepEqual(await repo.listAll(), before);
});

test("permanent purge forgets only the target across every workspace", async () => {
  const repo = new InMemoryPluginActivationRepo();
  await saveDisabled(repo);
  await repo.save({ pluginId: SITE.id, workspaceId: "ws-2", version: SITE.version, enabled: false, updatedAt: AT });
  const other = { pluginId: "other", workspaceId: WS, version: "2.0.0", enabled: true, updatedAt: AT };
  await repo.save(other);
  assert.equal((await repo.listAll()).length, 3);
  await forgetPluginActivations({ pluginId: SITE.id }, { repo });
  assert.deepEqual(await repo.listAll(), [other]);
});
