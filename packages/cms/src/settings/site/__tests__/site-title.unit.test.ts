import assert from "node:assert/strict";
import { test } from "vitest";

import { ensureSettingDefinitions, getEffective, InMemorySettingsRepo, resolveDefinitionRaw, set } from "@jini-ai/core/settings";
import { nowIso } from "@jini-ai/core/primitives";

import {
  ensureSiteTitleSettingDefinition,
  InMemorySiteTitlePreservationStore,
  preserveLegacySiteTitles,
  resolveSiteTitle,
  SITE_TITLE_KEY,
  SITE_TITLE_NAMESPACE,
  type PreserveLegacySiteTitlesResult,
  type SiteTitleFailureEvent,
} from "../site-title.js";

/**
 * @file The legacy title is host-supplied: the value passed as `legacySiteTitle` is the stored
 * definition default, the workspace pin, and every render fallback. The ledger functions arrive
 * through the deps, so a spy passed in is the one called.
 */

const LEGACY = "Example Legacy Title";
const SYSTEM = "system-principal";
const clock = { nowIso: () => "2026-11-23T00:00:00.000Z", nowMs: () => Date.parse("2026-11-23T00:00:00.000Z") };
let n = 0;
const ids = { newId: () => `site-title-${++n}` };
const principals = { findActiveById: async ({ id }: { id: string }) => ({ id }) };

function ledger(pending: string[] = []) {
  const settingsRepo = new InMemorySettingsRepo();
  const calls: string[] = [];
  const failures: SiteTitleFailureEvent[] = [];
  const summaries: PreserveLegacySiteTitlesResult[] = [];
  return {
    calls,
    failures,
    summaries,
    reportSiteTitleFailure: (event: SiteTitleFailureEvent) => { failures.push(event); },
    reportPreservationSummary: (result: PreserveLegacySiteTitlesResult) => { summaries.push(result); },
    settingsRepo,
    clock,
    ids,
    principals,
    preservationStore: new InMemorySiteTitlePreservationStore(pending),
    ensureSettingDefinitions: ((...args) => (calls.push("ensure"), ensureSettingDefinitions(...args))) as typeof ensureSettingDefinitions,
    set: ((...args) => (calls.push("set"), set(...args))) as typeof set,
    resolveDefinitionRaw: ((...args) => (calls.push("resolveDefinitionRaw"), resolveDefinitionRaw(...args))) as typeof resolveDefinitionRaw,
    nowIso,
    getEffective: ((...args) => (calls.push("getEffective"), getEffective(...args))) as typeof getEffective,
  };
}

function resolveDeps(l: ReturnType<typeof ledger>, siteName?: string) {
  return {
    settingsRepo: l.settingsRepo,
    preservationStore: l.preservationStore,
    workspaceRepo: { findById: async () => ({ name: "Workspace Row Name" }) },
    siteDisplayName: { read: () => siteName },
    getEffective: l.getEffective,
    legacySiteTitle: LEGACY,
    reportSiteTitleFailure: l.reportSiteTitleFailure,
  };
}

async function effective(l: ReturnType<typeof ledger>, workspaceId: string) {
  const resolved = await getEffective({ deps: { repo: l.settingsRepo }, namespace: SITE_TITLE_NAMESPACE, key: SITE_TITLE_KEY, scopeContext: { workspaceId } });
  return { value: resolved?.value, sourceLayer: resolved?.sourceLayer };
}

test("registration stores the host's legacy title as the definition default, through the injected registrar", async () => {
  const l = ledger();
  await ensureSiteTitleSettingDefinition(l, { systemPrincipalId: SYSTEM, legacySiteTitle: LEGACY });
  assert.deepEqual(await effective(l, "ws"), { value: LEGACY, sourceLayer: "default" });
  assert.deepEqual(l.calls, ["ensure"]);
});

test("preservation pins each pending workspace to the host's legacy title through the injected set", async () => {
  const l = ledger(["ws-pre"]);
  await ensureSiteTitleSettingDefinition(l, { systemPrincipalId: SYSTEM, legacySiteTitle: "Different Default" });
  const result = await preserveLegacySiteTitles(l, { systemPrincipalId: SYSTEM, legacySiteTitle: LEGACY });
  assert.deepEqual(result, { pinnedWorkspaceIds: ["ws-pre"], skippedWorkspaceIds: [], failedWorkspaceIds: [] });
  assert.deepEqual(await effective(l, "ws-pre"), { value: LEGACY, sourceLayer: "workspace" });
  assert.deepEqual(l.calls, ["ensure", "resolveDefinitionRaw", "set"]);
});

test("render falls back to the host's legacy title while pending, unregistered, or unreadable, and to the display name otherwise", async () => {
  const l = ledger(["ws-pre"]);
  assert.equal(await resolveSiteTitle(resolveDeps(l, "Site Name"), { workspaceId: "ws-new" }), LEGACY, "unregistered");
  await ensureSiteTitleSettingDefinition(l, { systemPrincipalId: SYSTEM, legacySiteTitle: "Different Default" });
  assert.equal(await resolveSiteTitle(resolveDeps(l, "Site Name"), { workspaceId: "ws-pre" }), LEGACY, "pending");
  assert.equal(await resolveSiteTitle(resolveDeps(l, "Site Name"), { workspaceId: "ws-new" }), "Site Name", "resolved, display name");
  assert.equal(await resolveSiteTitle(resolveDeps(l), { workspaceId: "ws-new" }), "Workspace Row Name", "no site directory");
  l.preservationStore.isPending = async () => {
    throw new Error("marker read failed");
  };
  assert.equal(await resolveSiteTitle(resolveDeps(l, "Site Name"), { workspaceId: "ws-new" }), LEGACY, "failed read");
  assert.ok(l.calls.includes("getEffective"));
});

test("failures reach the injected reporter as fixed text plus workspace id and error class, never the error's message", async () => {
  const secret = "postgres://admin:hunter2-SECRET@db.internal/site";
  const unregistered = ledger(["ws-a"]);
  await preserveLegacySiteTitles(unregistered, { systemPrincipalId: SYSTEM, legacySiteTitle: LEGACY });
  const l = ledger(["ws-b"]);
  await ensureSiteTitleSettingDefinition(l, { systemPrincipalId: SYSTEM, legacySiteTitle: LEGACY });
  l.settingsRepo.saveWorkspaceValue = async () => { throw new TypeError(`write failed for ${secret}`); };
  const result = await preserveLegacySiteTitles(l, { systemPrincipalId: SYSTEM, legacySiteTitle: LEGACY });
  l.preservationStore.isPending = async () => { throw new Error(`read failed for ${secret}`); };
  assert.equal(await resolveSiteTitle(resolveDeps(l), { workspaceId: "ws-new" }), LEGACY);

  assert.deepEqual(unregistered.failures, [
    { message: "preserveLegacySiteTitles: workspace stays pending, pin failed: core.site/title is not registered", workspaceId: "ws-a" },
  ]);
  assert.deepEqual(l.failures, [
    { message: "preserveLegacySiteTitles: workspace stays pending, pin failed", workspaceId: "ws-b", errorClass: "TypeError" },
    { message: "resolveSiteTitle: falling back to the legacy title", workspaceId: "ws-new", errorClass: "Error" },
  ]);
  assert.deepEqual(l.summaries, [result]);
  assert.deepEqual(result, { pinnedWorkspaceIds: [], skippedWorkspaceIds: [], failedWorkspaceIds: ["ws-b"] });
  assert.equal(JSON.stringify([unregistered.failures, l.failures]).includes("hunter2"), false);
});
