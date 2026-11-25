import assert from "node:assert/strict";
import { test } from "vitest";
import {
  AgentPluginNotReadyError,
  assertAgentPluginReady,
  findSoonAgentPlugin,
  lockSoonAgentPlugins,
  readHostPluginMaturity,
  SOON_LOCK_ACTOR,
  type SoonCatalogPort,
} from "../soon-lock.js";

/**
 * @file The "Soon" maturity gate: the manifest flag wins, the host's injected list covers unflagged
 * plugins, any installed Soon revision locks the id, and boot switches off only the affected active ids.
 * Driven against a fake catalog and activation owner.
 */

const HOST_SOON = new Set(["posthog"]);
const SOON = { extensions: { jini: { maturity: "soon" } } };
const UNTESTED = { extensions: { jini: { maturity: "untested" } } };

type Revision = { pluginId: string; displayName?: string; manifest: string };

/** A fake catalog whose revisions carry their raw manifest text; a throwing read models an unreadable file. */
function fakeCatalog(revisions: readonly Revision[]): SoonCatalogPort<Revision> {
  return {
    list: async () => revisions,
    readManifest: async ({ plugin }) => {
      if (plugin.manifest === "<unreadable>") throw new Error("EACCES");
      return plugin.manifest;
    },
  };
}

test("a manifest `untested` flag wins over the host's Soon list", () => {
  assert.equal(readHostPluginMaturity({ manifest: UNTESTED, pluginId: "posthog", hostSoonPluginIds: HOST_SOON }), "untested");
  assert.equal(readHostPluginMaturity({ manifest: {}, pluginId: "posthog", hostSoonPluginIds: HOST_SOON }), "soon");
  assert.equal(readHostPluginMaturity({ manifest: {}, pluginId: "github", hostSoonPluginIds: HOST_SOON }), undefined);
});

test("an untested host-listed revision may be switched on: the manifest decides", async () => {
  const catalog = fakeCatalog([{ pluginId: "posthog", displayName: "PostHog", manifest: JSON.stringify(UNTESTED) }]);
  assert.equal(await findSoonAgentPlugin({ catalog, workspaceRoot: "/ws", pluginId: "posthog", hostSoonPluginIds: HOST_SOON }), undefined);
});

test("a missing or unreadable manifest still consults the host list", async () => {
  const unreadable = fakeCatalog([{ pluginId: "posthog", displayName: "PostHog", manifest: "<unreadable>" }]);
  assert.deepEqual(await findSoonAgentPlugin({ catalog: unreadable, workspaceRoot: "/ws", pluginId: "posthog", hostSoonPluginIds: HOST_SOON }), { name: "PostHog" });
  const malformed = fakeCatalog([{ pluginId: "posthog", manifest: "{not json" }]);
  assert.deepEqual(await findSoonAgentPlugin({ catalog: malformed, workspaceRoot: "/ws", pluginId: "posthog", hostSoonPluginIds: HOST_SOON }), { name: "posthog" });
  const empty = fakeCatalog([]);
  assert.deepEqual(await findSoonAgentPlugin({ catalog: empty, workspaceRoot: "/ws", pluginId: "posthog", hostSoonPluginIds: HOST_SOON }), { name: "posthog" });
  assert.equal(await findSoonAgentPlugin({ catalog: empty, workspaceRoot: "/ws", pluginId: "github", hostSoonPluginIds: HOST_SOON }), undefined);
});

test("any installed Soon revision is enough to lock the id", async () => {
  const catalog = fakeCatalog([
    { pluginId: "notes", manifest: JSON.stringify({}) },
    { pluginId: "notes", displayName: "Notes", manifest: JSON.stringify(SOON) },
  ]);
  assert.deepEqual(await findSoonAgentPlugin({ catalog, workspaceRoot: "/ws", pluginId: "notes", hostSoonPluginIds: HOST_SOON }), { name: "Notes" });
  await assert.rejects(assertAgentPluginReady({ catalog, workspaceRoot: "/ws", pluginId: "notes", hostSoonPluginIds: HOST_SOON }),
    (error: unknown) => error instanceof AgentPluginNotReadyError && error.code === "AGENT_PLUGIN_NOT_READY" && error.pluginId === "notes"
      && error.message === "Notes isn't ready yet, so it can't be turned on. You can still view its files.");
  await assertAgentPluginReady({ catalog, workspaceRoot: "/ws", pluginId: "github", hostSoonPluginIds: HOST_SOON });
});

test("boot switches off only the affected active ids, as the Soon-lock actor", async () => {
  const manifests: Record<string, unknown> = { notes: SOON, posthog: {}, github: {}, quiet: SOON, checked: { ...UNTESTED } };
  const catalog = fakeCatalog(Object.entries(manifests).map(([pluginId, manifest]) => ({ pluginId, manifest: JSON.stringify(manifest) })));
  const writes: unknown[] = [];
  const switched = await lockSoonAgentPlugins({ catalog, workspaceRoot: "/ws", hostSoonPluginIds: new Set(["posthog", "checked"]), activations: {
    resolveAgentPluginActivation: async ({ pluginId }) => ({ verdict: pluginId === "quiet" ? "inactive" : "active" }),
    setAgentPluginActivation: async required => { writes.push(required); },
  } });
  assert.deepEqual(switched, ["notes", "posthog"]);
  assert.deepEqual(writes, [
    { workspaceRoot: "/ws", pluginId: "notes", enabled: false, actor: SOON_LOCK_ACTOR },
    { workspaceRoot: "/ws", pluginId: "posthog", enabled: false, actor: SOON_LOCK_ACTOR },
  ]);
  assert.equal(SOON_LOCK_ACTOR, "system:soon-lock");
});
