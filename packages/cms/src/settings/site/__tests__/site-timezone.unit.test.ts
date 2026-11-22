import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";

import { InMemorySettingsRepo, set, type AuthorizeFn, type SettingsRepoPort } from "@jini-ai/core/settings";

import {
  createSiteTimeZonePort,
  ensureSiteTimeZoneSettingDefinition,
  resolveSiteTimeZone,
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

let previousTimeZone: string | undefined;
beforeEach(() => { previousTimeZone = process.env.TZ; process.env.TZ = "UTC"; });
afterEach(() => {
  if (previousTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimeZone;
});

async function makeRepo(): Promise<InMemorySettingsRepo> {
  const settingsRepo = new InMemorySettingsRepo();
  await ensureSiteTimeZoneSettingDefinition({ settingsRepo, clock, ids, principals }, { systemPrincipalId: "system" });
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
  const zone = await resolveSiteTimeZone({ settingsRepo, creationTimeZone: { read: () => "Europe/Paris" } }, { workspaceId: "ws-1" });
  assert.equal(zone, "Asia/Tokyo");
});

test("without an owner value the creation zone applies, and an invalid creation zone falls to the server zone", async () => {
  const settingsRepo = await makeRepo();
  assert.equal(await resolveSiteTimeZone({ settingsRepo, creationTimeZone: { read: () => "Europe/Paris" } }, { workspaceId: "ws-2" }), "Europe/Paris");
  assert.equal(await resolveSiteTimeZone({ settingsRepo, creationTimeZone: { read: () => "Not/AZone" } }, { workspaceId: "ws-2" }), "UTC");
});

test("an invalid owner value is ignored in favour of the creation zone", async () => {
  const settingsRepo = await makeRepo();
  await ownerSet(settingsRepo, "ws-3", "Not/AZone");
  const zone = await resolveSiteTimeZone({ settingsRepo, creationTimeZone: { read: () => "America/New_York" } }, { workspaceId: "ws-3" });
  assert.equal(zone, "America/New_York");
});

test("a failed settings read uses the creation zone instead of throwing; the port delegates", async () => {
  const failing = new InMemorySettingsRepo();
  failing.findActiveDefinition = async () => { throw new Error("db down"); };
  const zone = await resolveSiteTimeZone({ settingsRepo: failing, creationTimeZone: { read: () => "Asia/Kolkata" } }, { workspaceId: "ws-4" });
  assert.equal(zone, "Asia/Kolkata");
  const port = createSiteTimeZonePort({ settingsRepo: failing, creationTimeZone: { read: () => "Asia/Kolkata" } });
  assert.equal(await port.resolveTimeZone({ workspaceId: "ws-4" }), "Asia/Kolkata");
});
