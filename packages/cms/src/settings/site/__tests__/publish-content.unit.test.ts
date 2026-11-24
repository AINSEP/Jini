import assert from "node:assert/strict";
import { test } from "vitest";

import { ForbiddenError, InMemorySettingsRepo, type SetValueRequired, type SettingDefinitionRecord } from "@jini-ai/core/settings";

import { contributeSiteSettingPublish, type SiteSettingPublishDeps, type SiteSettingRepoPublishConfig } from "../publish-content.js";
import { set, type SiteSettingsWritePolicies } from "../site-title-write.js";

/**
 * @file `site-setting` publishing reads every host value through its injected bindings: the allowlist
 * (`publishableSettings`, with the labels an operator reads), the gateway's `authorize`, the principal
 * lookup and the dedicated settings writers (`writePolicies`). A fake factory returns the config so
 * each binding is observed directly.
 */

const WS = "ws-publish";
const NOW = "2026-11-23T00:00:00.000Z";

function definition(namespace: string, key: string): SettingDefinitionRecord {
  return {
    settingId: `${namespace}.${key}`, version: 1, workspaceId: null, namespace, key, ownerKind: "core", ownerId: null,
    schema: { type: "json" }, defaultValue: null, scopes: 6, secret: false,
    status: "active", aliasOfNamespace: null, aliasOfKey: null, coercionTag: null, createdAt: NOW, updatedAt: NOW,
  };
}

type Principals = { readonly tag: "host-principals" };
type Deps = SiteSettingPublishDeps<Principals>;

async function fixture({ writePolicies = { dedicatedWriters: [] } }: { writePolicies?: SiteSettingsWritePolicies } = {}) {
  const repo = new InMemorySettingsRepo({ definitions: [definition("site", "title"), definition("site", "testing")] });
  let next = 0;
  const clock = { nowIso: () => NOW, nowMs: () => Date.parse(NOW) } as unknown as SetValueRequired["deps"]["clock"];
  const ids = { newId: () => `00000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}` } as unknown as SetValueRequired["deps"]["ids"];
  const authorizeCalls: unknown[] = [];
  const authorize = (async (request: unknown) => { authorizeCalls.push(request); return { allowed: true, reason: "test" }; }) as unknown as SetValueRequired["deps"]["authorize"];
  const principals = { findActiveById: async () => null } as unknown as SetValueRequired["deps"]["principals"];
  for (const key of ["title", "testing"]) {
    await set({ deps: { repo, clock, ids, authorize, principals }, input: { namespace: "site", key, scope: "workspace", workspaceId: WS, authWorkspaceId: WS, callerPrincipalId: "owner", value: `${key}-value` }, writePolicies: { dedicatedWriters: [] } });
  }
  authorizeCalls.length = 0;
  const ports = { settings: repo, principals: { tag: "host-principals" } as const };
  const deps: Deps = { ports: { "site-setting": ports }, clock, idGen: ids };
  const seen: { gateway: string[]; lookups: Principals[] } = { gateway: [], lookups: [] };
  const config = contributeSiteSettingPublish<Principals, Deps, SiteSettingRepoPublishConfig<Principals, Deps>>({
    createRepoPublishHandler: (cfg) => cfg,
    gatewayDeps: ({ entityType }) => { seen.gateway.push(entityType); return { authorize }; },
    publishableSettings: { "site:title": "Site title" },
    writePolicies,
    principalLookup: ({ repo: principalRepo }) => { seen.lookups.push(principalRepo); return principals; },
  });
  return { config, ports, deps, seen, authorizeCalls };
}

test("only the injected allowlist's keys pack, labelled with the host's label", async () => {
  const f = await fixture();
  const rows = await f.config.list({ ports: f.ports, workspaceId: WS });
  assert.deepEqual(rows.map(row => [row.key, row.label, row.value]), [["site:title", "Site title", "title-value"]]);
  assert.equal(await f.config.find({ ports: f.ports, workspaceId: WS, id: "site:testing" }), null);
  assert.equal(await f.config.validate({ ports: f.ports, workspaceId: WS, entity: { entityType: "site-setting", id: "site:testing", state: {} } as never }),
    "site-setting 'site:testing' is not one this site publishes");
});

test("a write authorizes through the injected gateway and looks principals up through the injected lookup", async () => {
  const f = await fixture();
  const result = await f.config.write({ ports: f.ports, deps: f.deps, workspaceId: WS, id: "site:title", state: { value: "Live" }, principalId: "owner" });
  assert.ok(result.version > 0);
  assert.deepEqual(f.seen.gateway, ["site-setting"]);
  assert.deepEqual(f.seen.lookups, [{ tag: "host-principals" }]);
  assert.equal(f.authorizeCalls.length, 1);
  assert.equal((await f.config.find({ ports: f.ports, workspaceId: WS, id: "site:title" }))?.value, "Live");
});

test("a write goes through the host's injected dedicated writers", async () => {
  const f = await fixture({ writePolicies: { dedicatedWriters: [
    { namespace: "site", key: "title", permissionOverride: "host.manage", reason: "Use the host's dedicated path.", normalize: ({ required }) => required },
  ] } });
  await assert.rejects(f.config.write({ ports: f.ports, deps: f.deps, workspaceId: WS, id: "site:title", state: { value: "Live" }, principalId: "owner" }),
    (error: unknown) => error instanceof ForbiddenError && error.message === "Use the host's dedicated path.");
});
