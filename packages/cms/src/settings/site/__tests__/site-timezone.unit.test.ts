import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";

import { ensureSettingDefinitions, getEffective, InMemorySettingsRepo, set, type AuthorizeFn, type SettingsRepoPort } from "@jini-ai/core/settings";

import {
  createSiteTimeZonePort,
  ensureSiteTimeZoneSettingDefinition,
  resolveSiteTimeZone,
  SITE_TIME_ZONE_FALLBACK_MESSAGE,
  type SiteTimeZoneFallbackEvent,
  SITE_TIMEZONE_KEY,
  SITE_TIMEZONE_NAMESPACE,
} from "../site-timezone.js";

/**
 * @file Characterization of `core.site.timezone` resolution, written when the module moved from the
 * host. Only a workspace-layer value counts as the owner's choice; without one the zone detected when
 * the site was created applies, else the server's local zone. A failed settings read never throws.
 */

const clock = { nowIso: () => "2026-10-22T00:00:00.000Z", nowMs: () => Date.parse("2026-10-22T00:00:00.000Z") };
let idCounter = 0;
const ids = { newId: () => `site-tz-id-${++idCounter}` };
const allowAll: AuthorizeFn = async () => ({ allowed: true, reason: "test" });
const principals = { findActiveById: async () => null };

const ignoreFallback = (): void => {};

let previousTimeZone: string | undefined;
beforeEach(() => { previousTimeZone = process.env.TZ; process.env.TZ = "UTC"; });
afterEach(() => {
  if (previousTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimeZone;
});

async function makeRepo(): Promise<InMemorySettingsRepo> {
  const settingsRepo = new InMemorySettingsRepo();
  await ensureSiteTimeZoneSettingDefinition({ settingsRepo, clock, ids, principals, ensureSettingDefinitions }, { systemPrincipalId: "system" });
  return settingsRepo;
}

async function ownerSet(repo: SettingsRepoPort, workspaceId: string, value: string): Promise<void> {
  await set({
    deps: { repo, clock, ids, authorize: allowAll, principals },
    input: { namespace: SITE_TIMEZONE_NAMESPACE, key: SITE_TIMEZONE_KEY, scope: "workspace", workspaceId, value, callerPrincipalId: "owner" },
  });
}

test("an owner-set workspace zone wins over the creation zone", async () => {
  const settingsRepo = await makeRepo();
  await ownerSet(settingsRepo, "ws-1", "Asia/Tokyo");
  const zone = await resolveSiteTimeZone({ getEffective, reportFallback: ignoreFallback, settingsRepo, creationTimeZone: { read: () => "Europe/Paris" } }, { workspaceId: "ws-1" });
  assert.equal(zone, "Asia/Tokyo");
});

test("without an owner value the creation zone applies, and an invalid creation zone falls to the server zone", async () => {
  const settingsRepo = await makeRepo();
  assert.equal(await resolveSiteTimeZone({ getEffective, reportFallback: ignoreFallback, settingsRepo, creationTimeZone: { read: () => "Europe/Paris" } }, { workspaceId: "ws-2" }), "Europe/Paris");
  assert.equal(await resolveSiteTimeZone({ getEffective, reportFallback: ignoreFallback, settingsRepo, creationTimeZone: { read: () => "Not/AZone" } }, { workspaceId: "ws-2" }), "UTC");
});

test("an invalid owner value is ignored in favour of the creation zone", async () => {
  const settingsRepo = await makeRepo();
  await ownerSet(settingsRepo, "ws-3", "Not/AZone");
  const zone = await resolveSiteTimeZone({ getEffective, reportFallback: ignoreFallback, settingsRepo, creationTimeZone: { read: () => "America/New_York" } }, { workspaceId: "ws-3" });
  assert.equal(zone, "America/New_York");
});

test("a failed settings read uses the creation zone instead of throwing; the port delegates", async () => {
  const failing = new InMemorySettingsRepo();
  failing.findActiveDefinition = async () => { throw new Error("db down"); };
  const zone = await resolveSiteTimeZone({ getEffective, reportFallback: ignoreFallback, settingsRepo: failing, creationTimeZone: { read: () => "Asia/Kolkata" } }, { workspaceId: "ws-4" });
  assert.equal(zone, "Asia/Kolkata");
  const port = createSiteTimeZonePort({ getEffective, reportFallback: ignoreFallback, settingsRepo: failing, creationTimeZone: { read: () => "Asia/Kolkata" } });
  assert.equal(await port.resolveTimeZone({ workspaceId: "ws-4" }), "Asia/Kolkata");
});

test("a failed read reports fixed text and safe fields only: an error echoing a secret never reaches the report", async () => {
  const secret = "postgres://admin:hunter2-SECRET@db.internal/site";
  const failing = new InMemorySettingsRepo();
  failing.findActiveDefinition = async () => { throw new TypeError(`connect failed for ${secret}`); };
  const reports: SiteTimeZoneFallbackEvent[] = [];
  const zone = await resolveSiteTimeZone(
    { getEffective, reportFallback: (event) => { reports.push(event); }, settingsRepo: failing, creationTimeZone: { read: () => "Asia/Kolkata" } },
    { workspaceId: "ws-5" },
  );
  assert.equal(zone, "Asia/Kolkata");
  assert.deepEqual(reports, [{ message: SITE_TIME_ZONE_FALLBACK_MESSAGE, workspaceId: "ws-5", errorClass: "TypeError" }]);
  assert.equal(JSON.stringify(reports).includes("hunter2"), false);
});

test("the injected getEffective is the reader used, with the site timezone key and workspace", async () => {
  const reads: Array<[string, string, unknown]> = [];
  const spy: typeof getEffective = async (input) => {
    reads.push([input.namespace, input.key, input.scopeContext]);
    return { value: "Asia/Tokyo", sourceLayer: "workspace" } as Awaited<ReturnType<typeof getEffective>>;
  };
  const zone = await resolveSiteTimeZone({ getEffective: spy, reportFallback: ignoreFallback, settingsRepo: new InMemorySettingsRepo() }, { workspaceId: "ws-6" });
  assert.equal(zone, "Asia/Tokyo");
  assert.deepEqual(reads, [[SITE_TIMEZONE_NAMESPACE, SITE_TIMEZONE_KEY, { workspaceId: "ws-6" }]]);
});

test("the injected ensureSettingDefinitions is the registrar used, with the deps it was given", async () => {
  const calls: Array<{ deps: unknown; namespace: string; keys: string[] }> = [];
  const deps = { settingsRepo: new InMemorySettingsRepo(), clock, ids, principals, ensureSettingDefinitions: (async (d, input) => {
    calls.push({ deps: d, namespace: input.namespace, keys: input.definitions.map((definition) => definition.key) });
  }) as typeof ensureSettingDefinitions };
  await ensureSiteTimeZoneSettingDefinition(deps, { systemPrincipalId: "system" });
  assert.deepEqual(calls, [{ deps, namespace: SITE_TIMEZONE_NAMESPACE, keys: [SITE_TIMEZONE_KEY] }]);
});

test("an unregistered site with no creation record uses the server zone", async () => {
  assert.equal(await resolveSiteTimeZone({ getEffective, reportFallback: ignoreFallback, settingsRepo: new InMemorySettingsRepo() }, { workspaceId: "legacy" }), "UTC");
});

test("a non-Error ledger failure reports Unknown and still uses the trimmed creation zone", async () => {
  const reports: SiteTimeZoneFallbackEvent[] = [];
  const result = await resolveSiteTimeZone({
    getEffective: async () => { throw "runtime signal"; },
    reportFallback: (report) => reports.push(report), settingsRepo: new InMemorySettingsRepo(),
    creationTimeZone: { read: () => " Europe/Paris " },
  }, { workspaceId: "legacy" });
  assert.equal(result, "Europe/Paris");
  assert.deepEqual(reports, [{ message: SITE_TIME_ZONE_FALLBACK_MESSAGE, workspaceId: "legacy", errorClass: "Unknown" }]);
});
