import assert from "node:assert/strict";
import { test } from "vitest";

import type { FormDeliveryStatusPort, FormDeliveryStatusRow } from "../contracts/headless/form-delivery-status.js";
import type { PluginExportCatalogPort, PluginExportCatalogRow } from "../contracts/headless/plugin-export-catalog.js";
import type {
  AgentPluginHostCapability, AgentPluginLayout, AgentPluginUninstallToolDeps, AgentPluginWorkspaceLayout,
  OperatorLocaleDeps, PluginHostPort, PluginLookupPort, PluginProvider, SetAgentPluginEnabledInput,
} from "../contracts/headless/plugin-host.js";
import type { ConsentPluginContribution, ConsentPluginHttp, SiteCookieConsentDeps } from "../contracts/headless/site-cookie-consent.js";
import type { GetEffectiveSetting, OperatorLocaleDeps as ReExportedOperatorLocaleDeps } from "../contracts/headless/operator-locale.js";
import type { SettingsRepoPort } from "../settings/ports.js";
import type { AssistantSurfaceDeps } from "../contracts/site/daemon-surface-exchanges.js";
import type { ToolExecutionContext, ToolExecutionOptions } from "../tool-registry.js";

/**
 * @file Type fixtures for the host-neutral headless contracts. `pnpm typecheck` compiles this file, so
 * renaming, dropping or retyping a field of any moved contract fails here. The runtime asserts only check
 * that each fixture hands its values through unchanged; the contracts themselves carry no runtime code.
 */

const row: FormDeliveryStatusRow = {
  bindingId: "b1", adapterId: "webhook", formId: "f1", submissionId: "s1",
  status: "retrying", attempts: 2, nextRetryAt: "2026-01-01T00:00:00.000Z", errorCode: "rate-limited",
};
const delivery: FormDeliveryStatusPort = {
  notificationSummary: async () => ({ failed: 0, pending: 1 }),
  forSubmission: async ({ workspaceId, submissionId }) => (workspaceId === "w1" && submissionId === "s1" ? [row] : []),
  recentUnfinished: async (_required, optional) => [row].slice(0, optional?.limit ?? 10),
};

const catalogRow: PluginExportCatalogRow = {
  plugin: "acme", displayName: "Acme", component: "card", version: 2, minVersion: 1,
  props: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  consent: "functional", availability: "available", snippet: null,
};
const catalog: PluginExportCatalogPort = { catalog: async () => new Map([["acme", [catalogRow]]]) };

const workspaceLayout: AgentPluginWorkspaceLayout = {
  root: "/i/ws/w1", packages: "/i/ws/w1/packages/sha256", staging: "/i/ws/w1/staging",
  pluginRootDir: ({ pluginId }) => `/i/ws/w1/${pluginId}`,
  pluginPackagesDir: ({ pluginId }) => `/i/ws/w1/${pluginId}/packages`,
  pluginMemoryDir: ({ pluginId, kind }) => `/i/ws/w1/${pluginId}/memory/${kind}`,
  pluginDataDir: ({ pluginId }) => `/i/ws/w1/${pluginId}/data`,
};
const layout: AgentPluginLayout = { root: "/i", workspacesDir: "/i/ws", forWorkspace: () => workspaceLayout };
const settingsRepo = {} as SettingsRepoPort;
const localeDeps: OperatorLocaleDeps = { settingsRepo };
const reExportedLocaleDeps: ReExportedOperatorLocaleDeps = localeDeps;
const uninstallDeps: AgentPluginUninstallToolDeps = {
  settingsRepo, agentPluginLayout: layout, workspaceId: "w1",
  authorize: async () => ({ allowed: true, reason: "owner" }),
  uninstallAgentPlugin: async (input, options) => ({ pluginId: input.pluginId, removedDigests: options?.deleteMemory ? ["d1"] : [] }),
};
const enableInput: SetAgentPluginEnabledInput = { workspaceId: "w1", pluginId: "acme", enabled: true, actor: "p1", agentPluginLayout: layout };

const provider: PluginProvider = { id: "acme", version: "1.0.0", enabled: true, family: "agent", localId: "acme", keywords: [], provides: ["cards"] };
const lookup: PluginLookupPort = { getPlugin: async ({ id }) => (id === provider.id ? provider : null), findProviders: async () => [provider] };
const capability: AgentPluginHostCapability = {
  inactivePluginIds: async () => new Set(["off"]),
  previewEnableAccess: async ({ pluginId }) => ({ key: `k:${pluginId}`, resources: [{ id: "r1", label: "Repo", previous: null, proposed: true, revision: null }] }),
  recordDeclinedAccess: async () => undefined,
  listInstalled: async () => [],
  preferInstalled: async ({ installed }) => installed,
  assertWritable: async () => undefined,
  setEnabled: async ({ pluginId, enabled }) => ({ pluginId, enabled, warnings: [] }),
  provisionMcp: async () => undefined,
  uninstall: async (required: { surfaces: AssistantSurfaceDeps; ctx: ToolExecutionContext; pluginId: string; executionOptions: ToolExecutionOptions }) => required.pluginId,
};
const host: PluginHostPort = {
  ...lookup,
  withInstallIdentity: async ({ candidate, run }) => (candidate.localId === "acme" ? run() : Promise.reject(new Error("taken"))),
  getHostCapability: ({ capability: name }) => (name === "agent-plugin-lifecycle" ? capability : undefined),
};

const getEffective: GetEffectiveSetting = async ({ namespace, key }) => (namespace === "ui" && key === "locale" ? { value: "fr" } : null);

const http: ConsentPluginHttp = {
  path: "/_consent/analytics",
  handle: async ({ analyticsLevel }) => ({ status: 200, body: analyticsLevel ?? "none", contentType: "text/plain", cacheControl: "no-store" }),
};
const contribution: ConsentPluginContribution = { adapter: { id: "a1", kind: "analytics-adapter" }, http };
const consent: SiteCookieConsentDeps = {
  embedConsentOff: () => false,
  refresh: async () => undefined,
  exportAssets: async () => ["/consent.js"],
  exportWarning: async () => undefined,
  regionResolvers: async () => [{ id: "header", kind: "region-resolver", resolve: ({ request }) => (request.header("x-region") === "us" ? "us" : "strict") }],
  browserPlugins: async () => [contribution.adapter],
  scriptDeclarations: async () => ({ scripts: [{ src: "/a.js", consent: ["analytics"] }], problems: [] }),
};

test("form delivery status port returns the outbox-derived rows unchanged", async () => {
  assert.deepEqual(await delivery.forSubmission({ workspaceId: "w1", submissionId: "s1" }), [row]);
  assert.deepEqual(await delivery.recentUnfinished({ workspaceId: "w1" }, { limit: 0 }), []);
  assert.deepEqual(await delivery.notificationSummary?.({ workspaceId: "w1", submissionId: "s1" }), { failed: 0, pending: 1 });
});

test("plugin export catalog groups model-safe rows by plugin", async () => {
  assert.deepEqual([...(await catalog.catalog({ workspaceId: "w1" })).entries()], [["acme", [catalogRow]]]);
});

test("plugin host fixtures route workspace layout, lifecycle capability and lookup", async () => {
  assert.equal(layout.forWorkspace({ workspaceId: "w1" }).pluginDataDir({ pluginId: "acme" }), "/i/ws/w1/acme/data");
  assert.equal(reExportedLocaleDeps.settingsRepo, settingsRepo);
  assert.deepEqual(await uninstallDeps.uninstallAgentPlugin?.({ layout, workspaceId: "w1", pluginId: "acme" }, { deleteMemory: true }), { pluginId: "acme", removedDigests: ["d1"] });
  assert.deepEqual(await host.getHostCapability({ capability: "agent-plugin-lifecycle" })?.setEnabled(enableInput), { pluginId: "acme", enabled: true, warnings: [] });
  assert.equal(await host.withInstallIdentity({ candidate: provider, run: async () => "published" }), "published");
  assert.deepEqual(await host.findProviders({ capability: "cards" }), [provider]);
});

test("operator locale reader and cookie consent deps hand values through", async () => {
  assert.deepEqual(await getEffective({ deps: { repo: settingsRepo }, namespace: "ui", key: "locale", scopeContext: { workspaceId: "w1", principalId: "p1" } }), { value: "fr" });
  const [resolver] = await consent.regionResolvers();
  assert.equal(await resolver?.resolve({ request: { header: () => "us", ip: null } }), "us");
  assert.deepEqual(await http.handle({ method: "POST", path: http.path, body: new Uint8Array(), contentType: "application/json", analyticsLevel: "anonymous" }), { status: 200, body: "anonymous", contentType: "text/plain", cacheControl: "no-store" });
});
