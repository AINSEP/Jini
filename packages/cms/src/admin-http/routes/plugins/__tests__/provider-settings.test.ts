import { describe, expect, it } from "vitest";
import type { PluginProviderSettingField } from "@jini-ai/core/contracts/plugin-sdk";
import {
  pluginProviderSettingsGetRoute, pluginProviderSettingsSaveRoute,
  type ProviderSettingsRecord, type ProviderSettingsRouteDeps, type ProviderSettingsStore,
} from "../provider-settings.js";
import { PRINCIPAL, raw, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file The provider plugin's settings card specs: path pins, authorization (no entity type), every refusal and the card shape. */

const FIELDS: PluginProviderSettingField[] = [
  { name: "endpoint", label: "Endpoint", required: true, hint: "https://…" },
  { name: "host", label: "Host", default: "us", options: [{ value: "us", label: "US" }], allowCustom: true },
  { name: "apiKey", label: "API key", secret: true, required: true, default: "never-shown" } as PluginProviderSettingField,
];
const RECORDS: ProviderSettingsRecord[] = [{ id: "obs", manifest: { contributes: { providers: [{ contract: "observability" }, { contract: "observability" }] } } }, { id: "plain" }];

function store(saved: { settings: Record<string, string>; secretNames: string[]; unreadable?: true } | null = null): ProviderSettingsStore {
  return { scope: "project", usage: async () => ({ store: "project", usedByThisSite: saved !== null, usedBy: [] }), readSettings: async () => saved };
}

/** Recording `authorize` that keeps the exact argument objects (so an `entityType` key would show). */
function recorder(denied: readonly string[] = []) {
  const calls: unknown[] = [];
  return { calls, authorize: async (args: { permission: string; entityType?: string }, ...scope: unknown[]) => {
    calls.push(scope.length ? [args, ...scope] : args);
    if (denied.includes(args.permission)) throw new Error(`denied ${args.permission}`);
  } };
}

function deps(overrides: Partial<ProviderSettingsRouteDeps> = {}) {
  const saves: unknown[] = [];
  let discovered = 0;
  const value: ProviderSettingsRouteDeps = {
    workspaceId: WORKSPACE_ID, tracker: undefined, projectKeys: undefined, providerAppliesAt: undefined, legacyProviderCredential: undefined,
    discoverPlugins: async () => { discovered += 1; return RECORDS; },
    declaredFields: ({ pluginId }) => (pluginId === "obs" ? FIELDS : undefined),
    providerConfig: store(),
    saveProviderSettings: async (args) => { saves.push(args); return { appliesAt: "now" }; },
    ...overrides,
  };
  return { value, saves, discovered: () => discovered };
}

const PATH = "/api/admin/v1/workspaces/:workspaceId/plugins/:pluginId/provider-settings";
const get = (d: ProviderSettingsRouteDeps, authorize = recorder().authorize, pluginId = "obs") => pluginProviderSettingsGetRoute.handle({ input: { pluginId }, deps: d, context: PRINCIPAL, authorize }, { signal });
const put = (d: ProviderSettingsRouteDeps, values: unknown, authorize = recorder().authorize) => pluginProviderSettingsSaveRoute.handle({ input: { pluginId: "obs", values }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("plugin provider settings specs", () => {
  it("pin method, path, default success status, no body cap; parse reads pluginId (?? '') and body.values", () => {
    expect([pluginProviderSettingsGetRoute.method, pluginProviderSettingsSaveRoute.method]).toEqual(["get", "put"]);
    expect([pluginProviderSettingsGetRoute.path, pluginProviderSettingsSaveRoute.path]).toEqual([PATH, PATH]);
    for (const route of [pluginProviderSettingsGetRoute, pluginProviderSettingsSaveRoute]) {
      expect(route.successStatus).toBeUndefined();
      expect(route.maxBodyBytes).toBeUndefined();
    }
    expect(pluginProviderSettingsGetRoute.parse(raw({}))).toEqual({ ok: true, value: { pluginId: "" } });
    expect(pluginProviderSettingsSaveRoute.parse(raw({ pluginId: "obs" }, { values: { a: "b" } }))).toEqual({ ok: true, value: { pluginId: "obs", values: { a: "b" } } });
    expect(pluginProviderSettingsSaveRoute.parse(raw({ pluginId: "obs" }, null))).toEqual({ ok: true, value: { pluginId: "obs", values: undefined } });
  });

  it("GET authorizes admin.plugins.read with no entity type and no scope, then builds the card (secrets write-only, choices only on public fields)", async () => {
    const { authorize, calls } = recorder();
    const d = deps({ providerConfig: store({ settings: { endpoint: "https://x", host: "" }, secretNames: ["apiKey"] }) });
    const result = await get(d.value, authorize);
    expect(calls).toEqual([{ permission: "admin.plugins.read" }]);
    expect(result).toEqual({ ok: true, value: { pluginId: "obs", store: "project", usedByThisSite: true, usedBy: [], projectAvailable: true, appliesAt: "now", fields: [
      { name: "endpoint", label: "Endpoint", hint: "https://…", secret: false, required: true, saved: true, value: "https://x" },
      { name: "host", label: "Host", default: "us", options: [{ value: "us", label: "US" }], allowCustom: true, secret: false, required: false, saved: false, value: "" },
      { name: "apiKey", label: "API key", secret: true, required: true, saved: true },
    ] } });
  });

  it("GET carries appliesAt, the legacy-credential and unreadable notices; a failing legacy check never breaks the card", async () => {
    const legacy = await get(deps({ providerAppliesAt: () => "restart", legacyProviderCredential: async () => true }).value);
    expect(legacy).toMatchObject({ value: { appliesAt: "restart", legacyCredential: true } });
    const failing = await get(deps({ legacyProviderCredential: async () => { throw new Error("vault"); } }).value);
    expect(failing.ok && "legacyCredential" in failing.value).toBe(false);
    const unreadable = await get(deps({ providerConfig: store({ settings: {}, secretNames: [], unreadable: true }), legacyProviderCredential: async () => true }).value);
    expect(unreadable).toMatchObject({ value: { unreadable: true } });
    expect(unreadable.ok && "legacyCredential" in unreadable.value).toBe(false);
  });

  it("refusals: no declared settings 404 PLUGIN_NOT_FOUND, no store 503 (after the 404), denied stops discovery", async () => {
    expect(await refusalOf(() => get(deps().value, undefined, "plain"))).toEqual({ status: 404, body: { error: "this plugin declares no provider settings", code: "PLUGIN_NOT_FOUND" } });
    expect(await refusalOf(() => get(deps({ providerConfig: undefined }).value, undefined, "plain"))).toMatchObject({ status: 404 });
    expect(await refusalOf(() => put(deps({ providerConfig: undefined }).value, {}))).toEqual({ status: 503, body: { error: "provider settings are not available here", code: "PROVIDER_SETTINGS_UNAVAILABLE" } });
    const d = deps();
    await expect(get(d.value, recorder(["admin.plugins.read"]).authorize)).rejects.toThrow("denied");
    await expect(put(d.value, {}, recorder(["admin.plugins.enable"]).authorize)).rejects.toThrow("denied");
    await expect(pluginProviderSettingsGetRoute.handle({ input: { pluginId: "obs" }, deps: d.value, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(d.discovered()).toBe(0);
    expect(d.saves).toEqual([]);
  });

  it("PUT authorizes admin.plugins.enable, saves with the declared fields and telemetry, and answers the fresh card plus apply status", async () => {
    const tracker = { capture: () => undefined } as never;
    const { authorize, calls } = recorder();
    const saves: unknown[] = [];
    const d = deps({ tracker, saveProviderSettings: async (args) => { saves.push(args); return { appliesAt: "failed", message: "could not start" }; } });
    const result = await put(d.value, { endpoint: "https://y" }, authorize);
    expect(calls).toEqual([{ permission: "admin.plugins.enable" }]);
    expect(saves).toEqual([{ pluginId: "obs", fields: FIELDS, config: d.value.providerConfig, values: { endpoint: "https://y" }, telemetry: { tracker, contracts: ["observability", "observability"], userId: PRINCIPAL.id } }]);
    expect(result).toMatchObject({ ok: true, value: { pluginId: "obs", appliesAt: "failed", message: "could not start" } });
    const plain = await put(deps().value, {});
    expect(plain.ok && "message" in plain.value).toBe(false);
  });

  it("PUT routes the save result through the project key store when one is configured", async () => {
    const projectKeys = { savedResult: async () => ({ appliesAt: "restart" }) };
    expect(await put(deps({ projectKeys }).value, {})).toMatchObject({ value: { appliesAt: "restart" } });
  });

  it("PUT answers a save refusal as-is: 503 for an unavailable store, 400 otherwise", async () => {
    const refusing = (code: string) => deps({ saveProviderSettings: async () => ({ refusal: { code, error: `msg ${code}` } }) }).value;
    expect(await refusalOf(() => put(refusing("PROVIDER_SETTINGS_UNAVAILABLE"), {}))).toEqual({ status: 503, body: { code: "PROVIDER_SETTINGS_UNAVAILABLE", error: "msg PROVIDER_SETTINGS_UNAVAILABLE" } });
    expect(await refusalOf(() => put(refusing("PROVIDER_SETTINGS_INVALID"), {}))).toEqual({ status: 400, body: { code: "PROVIDER_SETTINGS_INVALID", error: "msg PROVIDER_SETTINGS_INVALID" } });
  });

  it("an unexpected failure is rethrown unchanged for the host 500, and a missing principal fails closed", async () => {
    await expect(get(deps({ discoverPlugins: async () => { throw new Error("disk"); } }).value)).rejects.toThrow("disk");
    await expect(pluginProviderSettingsSaveRoute.handle({ input: { pluginId: "obs", values: {} }, deps: deps({ tracker: {} as never }).value, authorize: recorder().authorize })).rejects.toThrow(/no authenticated principal/);
  });
});

it("saves settings declared without provider contracts and records an empty telemetry contract list", async () => {
  const tracker = { capture: () => undefined } as NonNullable<ProviderSettingsRouteDeps["tracker"]>;
  const d = deps({ tracker, discoverPlugins: async () => [{ id: "obs", manifest: { contributes: {} } }] });
  expect(await put(d.value, { host: "eu" })).toMatchObject({ ok: true, value: { pluginId: "obs", appliesAt: "now" } });
  expect(d.saves).toEqual([{
    pluginId: "obs", config: d.value.providerConfig, fields: FIELDS, values: { host: "eu" },
    telemetry: { tracker, contracts: [], userId: PRINCIPAL.id },
  }]);
});
