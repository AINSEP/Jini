import assert from "node:assert/strict";
import { test } from "vitest";

import { ForbiddenError, InMemorySettingsRepo, type SetValueRequired, type SettingDefinitionRecord } from "@jini-ai/core/settings";

import { PublishContentApplyRowError } from "../../../publish/transfer/apply-errors.js";
import type { PackedEntity } from "../../../publish/transfer/packed-entity.js";

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

async function fixture({ writePolicies = { dedicatedWriters: [] }, includeImage = false }: { writePolicies?: SiteSettingsWritePolicies; includeImage?: boolean } = {}) {
  const repo = new InMemorySettingsRepo({ definitions: [definition("site", "title"), definition("site", "testing"), definition("site.seo", "default_og_image")] });
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
    publishableSettings: { "site:title": "Site title", ...(includeImage ? { "site.seo:default_og_image": "Share image" } : {}) },
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

const ogImageKey = "site.seo:default_og_image";
function packed(id: string, value: unknown): PackedEntity {
  return { id, state: { value }, entityType: "site-setting", schemaVersion: 1, hashVersion: 1, contentHash: "fixture", requiredBlobs: [] };
}

test("a share image reference includes its media UUID, but slugs, URLs and other settings do not", async () => {
  const { config } = await fixture({ includeImage: true });
  const mediaId = "b20cf433-23ef-4fcd-83c3-3eb30e5c6d60";
  assert.deepEqual(config.references({ entity: packed(ogImageKey, `${mediaId}:card`) }), [{ entityType: "media", key: mediaId }]);
  for (const entity of [
    packed(ogImageKey, "photography:card"), packed(ogImageKey, "https://images.example.test/card.png"),
    packed(ogImageKey, null), packed("site:title", `${mediaId}:card`),
  ]) assert.deepEqual(config.references({ entity }), []);
});

test("outbound inclusion and inbound publish reject local or malformed image URLs but allow public URLs", async () => {
  const { config, ports, deps } = await fixture({ includeImage: true });
  const row = { key: ogImageKey, label: "Share image", version: 9 };
  const reason = "site-setting 'site.seo:default_og_image' points at this computer";
  for (const value of ["http://127.0.0.1/card", "https://192.168.1.8/card", "https://studio.local/card", "https://[::1]/card", "https://["]) {
    assert.equal(config.include({ row: { ...row, value } }), false);
    assert.equal(await config.validate({ ports, workspaceId: WS, entity: packed(ogImageKey, value) }), reason);
    await assert.rejects(config.write({ ports, deps, workspaceId: WS, id: ogImageKey, state: { value }, principalId: "owner" }),
      (error: unknown) => error instanceof PublishContentApplyRowError && error.rowOutcome === "blocked" && error.message === reason);
  }
  assert.equal(await config.find({ ports, workspaceId: WS, id: ogImageKey }), null);
  for (const value of [" https://images.example.test/card ", "card-image:small", null]) {
    assert.equal(config.include({ row: { ...row, value } }), true);
    assert.equal(await config.validate({ ports, workspaceId: WS, entity: packed(ogImageKey, value) }), null);
  }
});

test("applying a cleared source value clears the existing destination and packs its new revision", async () => {
  const { config, ports, deps } = await fixture();
  const id = "site:title";
  assert.equal((await config.find({ ports, workspaceId: WS, id }))?.value, "title-value");
  const result = await config.write({ ports, deps, workspaceId: WS, id, state: { cleared: true, value: null }, principalId: "owner" });
  assert.deepEqual(await config.find({ ports, workspaceId: WS, id }), {
    key: id, label: "Site title", value: null, cleared: true, version: result.version,
  });
  assert.equal((await ports.settings.getWorkspaceValue({ workspaceId: WS, settingId: "site.title" }))?.state, "cleared");
});
