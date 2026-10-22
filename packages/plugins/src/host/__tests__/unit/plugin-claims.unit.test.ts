import assert from "node:assert/strict";
import { test } from "vitest";

import type { PluginActivationRecord } from "../../activation.js";
import type { PluginDiscoveryRecord } from "../support/discovery.js";
import type { PluginManifest } from "../support/manifest.js";
import {
  describeBootConflictQuarantine,
  describePluginConflicts,
  PluginConflictError,
  pluginClaimsFromManifest,
  resolvePluginConflicts,
} from "../support/plugin-claims.js";

/**
 * @file Tovu's adapter over the neutral detector (`plugin-claims.ts`): what a `tovu.plugin.json`
 * claims, who wins (earliest-enabled; the candidate being enabled is always newest), and the
 * human/agent message.
 */

const WORKSPACE = "ws-1";

function manifest(id: string, contributes: PluginManifest["contributes"] = {}, extra: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id, name: `Plugin ${id}`, version: "1.0.0", sdkRange: "^0.1.0", engine: 1, tier: "tier-3",
    capabilities: ["hooks.attach"], hooks: [], fields: [], integrity: {}, contributes, ...extra,
  };
}

function record(m: PluginManifest, source: PluginDiscoveryRecord["source"] = "site"): PluginDiscoveryRecord {
  return { id: m.id, name: m.name, version: m.version, source, tier: m.tier, status: "valid", errors: [], manifest: m };
}

function enabledAt(pluginId: string, iso: string, enabled = true): PluginActivationRecord {
  return { workspaceId: WORKSPACE, pluginId, version: "1.0.0", enabled, updatedAt: iso };
}

test("pluginClaimsFromManifest: every declared contribution becomes an exclusive claim of its kind", () => {
  const claims = pluginClaimsFromManifest({
    manifest: manifest("shop", {
      routes: ["GET /shop"], tools: ["shop_list"], tables: ["p_shop__items"],
      settings: ["shop.currency"], widgets: ["shop-cart"], permissions: ["shop.manage"],
    }),
  });
  assert.deepEqual(claims, [
    { kind: "route", key: "GET /api/p/shop/shop", mode: "exclusive" },
    { kind: "tool", key: "p_shop__shop_list", mode: "exclusive" },
    { kind: "table", key: "p_shop__items", mode: "exclusive" },
    { kind: "setting", key: "shop.currency", mode: "exclusive" },
    { kind: "widget", key: "shop-cart", mode: "exclusive" },
    { kind: "permission", key: "shop.manage", mode: "exclusive" },
  ]);
});

test("pluginClaimsFromManifest: beforeSave is a shared pipeline hook; a hook with no known semantics is exclusive (fail safe)", () => {
  const shared = pluginClaimsFromManifest({ manifest: manifest("a", {}, { hooks: ["content.entry.beforeSave"] }) });
  assert.deepEqual(shared, [{ kind: "hook", key: "content.entry.beforeSave", mode: "shared" }]);
  const unknown = pluginClaimsFromManifest({ manifest: manifest("a", {}, { hooks: ["render.page"] }) });
  assert.deepEqual(unknown, [{ kind: "hook", key: "render.page", mode: "exclusive" }]);
});

test("pluginClaimsFromManifest: a plugin with declared fields claims its generated capability tool id", () => {
  const claims = pluginClaimsFromManifest({ manifest: manifest("word-count", {}, { fields: [{ path: "ext.word-count.words", type: "integer", queryable: false }] }) });
  assert.deepEqual(claims, [{ kind: "tool", key: "plugin_capability_word_count", mode: "exclusive" }]);
});

test("pluginClaimsFromManifest: every declared content type claims its key, so two plugins cannot both declare 'faq'", () => {
  const faq = { key: "faq", label: "FAQ", fields: [{ name: "answer", kind: "text" }] };
  const claims = pluginClaimsFromManifest({ manifest: manifest("faq-a", {}, { tier: "tier-1", capabilities: [], contentTypes: [faq, { ...faq, key: "testimonial" }] }) });
  assert.deepEqual(claims, [
    { kind: "content-type", key: "faq", mode: "exclusive" },
    { kind: "content-type", key: "testimonial", mode: "exclusive" },
  ]);
  const conflicts = resolvePluginConflicts(
    { workspaceId: WORKSPACE, discovery: [record(manifest("faq-a", {}, { contentTypes: [faq] })), record(manifest("faq-b", {}, { contentTypes: [faq] }))], activations: [enabledAt("faq-a", "2026-09-01T00:00:00.000Z")], coreClaims: [] },
    { candidateId: "faq-b" },
  );
  assert.deepEqual(conflicts.get("faq-b")?.map((c) => `${c.kind}:${c.key}<-${c.heldBy}`), ["content-type:faq<-faq-a"]);
});

test("resolvePluginConflicts (boot order): the plugin enabled LATER is refused, whatever its id", () => {
  const older = manifest("zeta", { widgets: ["shop-cart"] });
  const newer = manifest("alpha", { widgets: ["shop-cart"] });
  const conflicts = resolvePluginConflicts({
    workspaceId: WORKSPACE,
    discovery: [record(newer), record(older)],
    activations: [enabledAt("alpha", "2026-10-02T00:00:00.000Z"), enabledAt("zeta", "2026-10-01T00:00:00.000Z")],
    coreClaims: [],
  });
  assert.deepEqual([...conflicts.keys()], ["alpha"]);
  assert.deepEqual(conflicts.get("alpha"), [{ kind: "widget", key: "shop-cart", heldBy: "zeta", heldByName: "Plugin zeta", heldKey: "shop-cart" }]);
});

test("resolvePluginConflicts (enable time): the candidate is newest even when timestamps tie", () => {
  const a = manifest("a", { widgets: ["banner"] });
  const b = manifest("b", { widgets: ["banner"] });
  const same = "2026-10-01T00:00:00.000Z";
  const conflicts = resolvePluginConflicts(
    { workspaceId: WORKSPACE, discovery: [record(a), record(b)], activations: [enabledAt("a", same), enabledAt("b", same)], coreClaims: [] },
    { candidateId: "a" },
  );
  assert.deepEqual([...conflicts.keys()], ["a"]);
});

test("resolvePluginConflicts: core claims always win, including reserved prefixes", () => {
  const plugin = manifest("shop", { routes: ["GET /api/shop"] });
  const conflicts = resolvePluginConflicts({
    workspaceId: WORKSPACE,
    discovery: [record(plugin)],
    activations: [enabledAt("shop", "2026-10-01T00:00:00.000Z")],
    coreClaims: [{ kind: "route", key: "/api/*", mode: "exclusive" }],
  });
  assert.deepEqual(conflicts.get("shop"), [{ kind: "route", key: "GET /api/p/shop/api/shop", heldBy: "core", heldByName: "Tovu core", heldKey: "/api/*" }]);
});

test("resolvePluginConflicts: a DISABLED plugin is reported with the conflicts it would have if enabled now", () => {
  const running = manifest("a", { permissions: ["shop.manage"] });
  const waiting = manifest("b", { permissions: ["shop.manage"] });
  const conflicts = resolvePluginConflicts({
    workspaceId: WORKSPACE,
    discovery: [record(running), record(waiting)],
    activations: [enabledAt("a", "2026-10-01T00:00:00.000Z"), enabledAt("b", "2026-09-01T00:00:00.000Z", false)],
    coreClaims: [],
  });
  assert.deepEqual([...conflicts.keys()], ["b"]);
  assert.equal(conflicts.get("b")?.[0]?.heldBy, "a");
});

test("resolvePluginConflicts: other workspaces' activations and invalid records claim nothing", () => {
  const a = manifest("a", { tools: ["x"] });
  const b = manifest("b", { tools: ["x"] });
  const conflicts = resolvePluginConflicts({
    workspaceId: WORKSPACE,
    discovery: [record(a), { ...record(b), status: "invalid", manifest: undefined }],
    activations: [{ ...enabledAt("a", "2026-10-01T00:00:00.000Z"), workspaceId: "other" }, enabledAt("b", "2026-09-01T00:00:00.000Z")],
    coreClaims: [],
  });
  // `a` is not enabled HERE, so only its would-be conflicts matter — and `b` is invalid, so holds nothing.
  assert.equal(conflicts.size, 0);
});

test("describePluginConflicts / PluginConflictError: one human sentence naming what clashes, who holds it, and what to do", () => {
  const message = describePluginConflicts({
    pluginId: "b",
    conflicts: [
      { kind: "tool", key: "shop_list", heldBy: "a", heldByName: "Shop A", heldKey: "shop_list" },
      { kind: "route", key: "GET /api/shop", heldBy: "core", heldByName: "the host core", heldKey: "/api/*" },
    ],
  });
  assert.equal(
    message,
    "Plugin 'b' was not turned on because it claims things already in use: tool 'shop_list' is provided by plugin 'a' (Shop A); route 'GET /api/shop' is reserved by the host core ('/api/*'). Turn off the other plugin first, or keep 'b' off.",
  );
  const error = new PluginConflictError({ pluginId: "b", conflicts: [{ kind: "tool", key: "x", heldBy: "a", heldByName: "A", heldKey: "x" }] });
  assert.equal(error.name, "PluginConflictError");
  assert.equal(error.pluginId, "b");
  assert.equal(error.conflicts.length, 1);
  assert.match(error.message, /^Plugin 'b' was not turned on/);
});


test('plugin-local route and tool names coexist with each other and raw core names', () => {
  const a = manifest('shop-a', { routes: ['GET /items', 'ANY /things/:id'], tools: ['search'] });
  const b = manifest('shop-b', { routes: ['GET /items'], tools: ['search'] });
  const conflicts = resolvePluginConflicts({ workspaceId: WORKSPACE, discovery: [record(a), record(b)],
    activations: [enabledAt(a.id, '2026-10-01'), enabledAt(b.id, '2026-10-02')],
    coreClaims: [{ kind: 'tool', key: 'search', mode: 'exclusive' }, { kind: 'route', key: 'GET /items', mode: 'exclusive' }],
  });
  assert.equal(conflicts.size, 0);
  const claims = pluginClaimsFromManifest({ manifest: a });
  assert.equal(claims.filter(claim => claim.kind === 'tool').length, 1);
  assert.ok(claims.some(claim => claim.key === 'POST /api/p/shop-a/things/:'));
  const reserved = resolvePluginConflicts({ workspaceId: WORKSPACE, discovery: [record(a)],
    activations: [enabledAt(a.id, '2026-10-01')], coreClaims: [{ kind: 'tool', key: 'p_shop_a__search', mode: 'exclusive' }],
  });
  assert.equal(reserved.get(a.id)?.[0]?.key, 'p_shop_a__search');
});

test("pluginClaimsFromManifest: a manifest with no contributes block claims only its hooks and generated tools", () => {
  const { contributes: _contributes, ...bare } = manifest("bare", {}, { hooks: ["content.entry.beforeSave"] });
  assert.deepEqual(pluginClaimsFromManifest({ manifest: bare }), [{ kind: "hook", key: "content.entry.beforeSave", mode: "shared" }]);
});

test("resolvePluginConflicts: same-moment enables fall back to built-in before site, then to id order", () => {
  const same = "2026-10-01T00:00:00.000Z";
  const builtIn = manifest("zz-core-widget", { widgets: ["banner"] });
  const siteA = manifest("a-site", { widgets: ["banner"] });
  const siteB = manifest("b-site", { widgets: ["banner"] });
  const conflicts = resolvePluginConflicts({
    workspaceId: WORKSPACE,
    discovery: [record(siteB), record(siteA), record(builtIn, "built-in")],
    activations: [enabledAt("b-site", same), enabledAt("a-site", same), enabledAt("zz-core-widget", same)],
    coreClaims: [],
  });
  assert.deepEqual([...conflicts.keys()].sort(), ["a-site", "b-site"]);
  assert.equal(conflicts.get("a-site")?.[0]?.heldBy, "zz-core-widget", "the built-in wins the tie despite its later id");
  assert.equal(conflicts.get("b-site")?.[0]?.heldBy, "zz-core-widget");
});

test("resolvePluginConflicts: an earlier enable wins over a later one regardless of source", () => {
  const conflicts = resolvePluginConflicts({
    workspaceId: WORKSPACE,
    discovery: [record(manifest("first", { widgets: ["x"] })), record(manifest("second", { widgets: ["x"] })), record(manifest("third", { widgets: ["x"] }), "built-in")],
    activations: [enabledAt("third", "2026-10-03T00:00:00.000Z"), enabledAt("first", "2026-10-01T00:00:00.000Z"), enabledAt("second", "2026-10-02T00:00:00.000Z")],
    coreClaims: [],
  });
  assert.deepEqual([...conflicts.keys()].sort(), ["second", "third"]);
  assert.equal(conflicts.get("third")?.[0]?.heldBy, "first");
});

test("resolvePluginConflicts: caller-supplied hook semantics override the SDK binding's", () => {
  const a = manifest("a", {}, { hooks: ["content.entry.beforeSave"] });
  const b = manifest("b", {}, { hooks: ["content.entry.beforeSave"] });
  const input = { workspaceId: WORKSPACE, discovery: [record(a), record(b)], activations: [enabledAt("a", "2026-10-01T00:00:00.000Z"), enabledAt("b", "2026-10-02T00:00:00.000Z")], coreClaims: [] };
  assert.equal(resolvePluginConflicts(input).size, 0, "beforeSave is shared by default");
  const exclusive = resolvePluginConflicts(input, { hookSemantics: { "content.entry.beforeSave": "exclusive" } });
  assert.deepEqual(exclusive.get("b"), [{ kind: "hook", key: "content.entry.beforeSave", heldBy: "a", heldByName: "Plugin a", heldKey: "content.entry.beforeSave" }]);
});

test("describeBootConflictQuarantine: the admin-row reason names the clash and the fix; a core claim on the same key is not repeated", () => {
  assert.equal(
    describeBootConflictQuarantine({ conflicts: [{ kind: "tool", key: "search", heldBy: "core", heldByName: "the host core", heldKey: "search" }] }),
    "Turned off at startup because it claims things already in use: tool 'search' is reserved by the host core. Turn off the other plugin, then turn this one back on.",
  );
});
