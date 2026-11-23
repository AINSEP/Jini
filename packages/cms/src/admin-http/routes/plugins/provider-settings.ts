import type { PluginProviderSettingField } from "@jini-ai/core/contracts/plugin-sdk";
import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type { ProviderKeyUsage } from "@jini-ai/core/contracts/site/plugins-host";
import { orFallback } from "@jini-ai/core/errors/idioms";
import { rejectRoute, RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { pluginActorId, pluginIdParam, type PluginsRoutePrincipal } from "./shared.js";

/**
 * @file `PLUGIN_PROVIDER_SETTINGS` — `GET`/`PUT /api/admin/v1/workspaces/:workspaceId/plugins/:pluginId/provider-settings`
 * (provider wave 2 fix, 2026-10-26). The provider plugin's secure settings card: its manifest-declared
 * fields (`contributes.providers[].settings`), the saved public values, and for secret fields only
 * whether one is saved — a secret is write-only and never leaves the server. Saves go through the
 * host's provider config store (the project store when one is configured, else this site's vault), sealed.
 * A saved provider applies now through the same provider lifecycle as boot.
 *
 * Read needs `admin.plugins.read`; save needs `admin.plugins.enable` (configuring a provider decides
 * where this site's telemetry goes, the same trust as turning the plugin on). A blank secret keeps
 * the saved one while the public fields are unchanged; changing one (an endpoint, a host) needs the
 * saved secrets entered again, so a saved key can never be redirected to another server.
 * That save rule lives in the host's injected `saveProviderSettings`, shared with the assistant's key card.
 */

/** The provider config store fields the card reads (the host's store passes through to the save). */
export interface ProviderSettingsStore {
  readonly scope: "project" | "site";
  usage(required: { pluginId: string }): Promise<ProviderKeyUsage>;
  readSettings(required: { pluginId: string }): Promise<{ readonly settings: Readonly<Record<string, string>>; readonly secretNames: readonly string[]; readonly unreadable?: true } | null>;
}

/** The discovery-record fields the specs read: the id and the declared provider contracts. */
export interface ProviderSettingsRecord {
  readonly id: string;
  readonly manifest?: { readonly contributes?: { readonly providers?: readonly { readonly contract: string }[] | null | undefined } | null | undefined } | null | undefined;
}

/** The resolved card fields a save reuses. */
export interface ProviderSettingsSaveArgs {
  config: ProviderSettingsStore; pluginId: string; fields: readonly PluginProviderSettingField[];
  telemetry?: { tracker: Tracker; contracts: readonly string[]; userId: string };
}

/** What one save hands the host's save rule: the resolved card plus the submitted values. */
export type ProviderSettingsSaveInput = ProviderSettingsSaveArgs & { values: unknown };

/** A committed save's apply status, or the refusal the host's save rule answered instead of writing. */
export type ProviderSettingsSaveResult = { appliesAt: string; message?: string } | { refusal: { code: string; error: string } };

/** The deps these routes read. Absent collaborators are explicit `undefined` (the host decides). Functions are methods so a host may bind ones typed against its full records and store. */
export interface ProviderSettingsRouteDeps {
  workspaceId: string;
  /** Owner-action signals; absent means none are sent. */
  tracker: Tracker | undefined;
  /** The configured store; absent answers 503. */
  providerConfig: ProviderSettingsStore | undefined;
  /** Routes a committed save through the project key store (its attach status), when one is configured. */
  projectKeys: { savedResult(required: { result: unknown }): Promise<unknown> } | undefined;
  providerAppliesAt: ((input: { pluginId: string }) => "now" | "restart" | "failed") | undefined;
  /** Whether a key was saved the retired way (an API credential labelled `plugin:<id>`), read by label only, never decrypted. */
  legacyProviderCredential: ((required: { pluginId: string }) => Promise<boolean>) | undefined;
  discoverPlugins(): Promise<readonly ProviderSettingsRecord[]>;
  /** The plugin's declared settings fields (first declaration of a name wins), or `undefined` when it declares none. */
  declaredFields(required: { records: readonly ProviderSettingsRecord[]; pluginId: string }): readonly PluginProviderSettingField[] | undefined;
  /** The host's save rule (validation, kept secrets, write, live reapply), pre-bound to its reapply hook. */
  saveProviderSettings(required: ProviderSettingsSaveInput): Promise<ProviderSettingsSaveResult>;
}

/** One field row of the card; a secret never carries a value. */
export interface ProviderSettingsCardField {
  name: string; label: string; secret: boolean; required: boolean; saved: boolean;
  hint?: string; default?: unknown; options?: unknown; allowCustom?: true; requiredUnless?: unknown; requiredWhen?: unknown; value?: string;
}

/** The settings card envelope (GET), plus the save's apply status (PUT). */
export interface ProviderSettingsCard extends ProviderKeyUsage {
  pluginId: string; projectAvailable: boolean; appliesAt: string; fields: ProviderSettingsCardField[];
  legacyCredential?: true; unreadable?: true; message?: string;
}

interface ResolvedCard extends ProviderSettingsSaveArgs { deps: ProviderSettingsRouteDeps }

const PATH = "/api/admin/v1/workspaces/:workspaceId/plugins/:pluginId/provider-settings";

/**
 * Wave 2 saved provider keys as API credentials labelled `plugin:<id>`; boot no longer reads them
 * (Codex fix-lane MED). Mapping them into the declared fields would need per-vendor knowledge in the host,
 * which the manifest-driven boot removed, so the card asks for the key again instead: shown while
 * nothing is saved the new way, gone after the first save. A failing check never breaks the card.
 */
async function hasLegacyCredential({ deps, pluginId, saved }: { deps: ProviderSettingsRouteDeps; pluginId: string; saved: unknown }, _optional: Record<string, never> = {}): Promise<boolean> {
  if (saved || !deps.legacyProviderCredential) return false;
  const credentialPromise = deps.legacyProviderCredential({ pluginId });
  return orFallback({ work: () => credentialPromise, fallback: false, step: "Check legacy provider credential" });
}

/** A public field's declared choices (`default`, `options`, `allowCustom`), passed to the card as declared. */
const choicesOf = ({ default: fallback, options, allowCustom }: PluginProviderSettingField) => ({
  ...(fallback === undefined ? {} : { default: fallback }), ...(options ? { options } : {}), ...(allowCustom ? { allowCustom: true as const } : {}),
});

function fieldPresentation({ field }: { field: PluginProviderSettingField }, _optional: Record<string, never> = {}) {
  return { ...(field.hint ? { hint: field.hint } : {}), ...(field.secret === true ? {} : choicesOf(field)) };
}

type SavedView = Awaited<ReturnType<ProviderSettingsStore["readSettings"]>>;

function cardField({ field, saved }: { field: PluginProviderSettingField; saved: SavedView }, _optional: Record<string, never> = {}): ProviderSettingsCardField {
  const secret = field.secret === true;
  const value = secret ? undefined : saved?.settings[field.name];
  return { name: field.name, label: field.label, ...fieldPresentation({ field }), secret, required: field.required === true,
    ...(field.requiredUnless ? { requiredUnless: field.requiredUnless } : {}),
    ...(field.requiredWhen ? { requiredWhen: field.requiredWhen } : {}),
    saved: secret ? (saved?.secretNames.includes(field.name) ?? false) : value !== undefined && value !== "", ...(value === undefined ? {} : { value }) };
}

/** The card: usage, scope, apply timing, notices and one row per declared field. @complexity O(f) plus three store reads. */
async function cardOf({ deps, config, pluginId, fields }: ResolvedCard, _optional: Record<string, never> = {}): Promise<ProviderSettingsCard> {
  const saved = await config.readSettings({ pluginId });
  return {
    pluginId, ...(await config.usage({ pluginId })), projectAvailable: config.scope === "project", appliesAt: deps.providerAppliesAt?.({ pluginId }) ?? "now",
    ...((await hasLegacyCredential({ deps, pluginId, saved })) ? { legacyCredential: true as const } : {}),
    ...(saved?.unreadable ? { unreadable: true as const } : {}),
    fields: fields.map((field) => cardField({ field, saved })),
  };
}

function providerContracts({ records, pluginId }: { records: readonly ProviderSettingsRecord[]; pluginId: string }, _optional: Record<string, never> = {}): string[] {
  return (records.find((record) => record.id === pluginId)?.manifest?.contributes?.providers ?? []).map((provider) => provider.contract);
}

/**
 * Shared guard: principal permission (no entity type: the hand-written check named none), plugin with
 * declared settings, a configured store. A mount without an authorizer is a wiring bug: fail closed.
 * @complexity O(n) in discovered plugins plus the injected authorizer.
 */
async function resolveCard(
  { deps, authorize, context, pluginId, permission }: { deps: ProviderSettingsRouteDeps; authorize: JsonRouteAuthorize | undefined; context: PluginsRoutePrincipal | undefined; pluginId: string; permission: string },
  _optional: Record<string, never> = {},
): Promise<ResolvedCard> {
  const userId = pluginActorId({ context });
  if (!authorize) throw new Error("plugins admin route has no authorizer");
  await authorize({ permission });
  const records = await deps.discoverPlugins();
  const fields = deps.declaredFields({ records, pluginId });
  if (!fields) rejectRoute({ status: 404, error: "this plugin declares no provider settings", code: "PLUGIN_NOT_FOUND" });
  if (!deps.providerConfig) rejectRoute({ status: 503, error: "provider settings are not available here", code: "PROVIDER_SETTINGS_UNAVAILABLE" });
  const contracts = providerContracts({ records, pluginId });
  return { deps, pluginId, fields, config: deps.providerConfig, ...(deps.tracker ? { telemetry: { tracker: deps.tracker, contracts, userId } } : {}) };
}

/** `GET` — the settings card. */
export const pluginProviderSettingsGetRoute = defineJsonRoute<{ pluginId: string }, ProviderSettingsCard, ProviderSettingsRouteDeps, PluginsRoutePrincipal>({
  method: "get",
  path: PATH,
  parse: (raw) => ok({ value: { pluginId: pluginIdParam(raw.params) } }),
  handle: async ({ input, deps, context, authorize }) =>
    ok({ value: await cardOf(await resolveCard({ deps, authorize, context, pluginId: input.pluginId, permission: "admin.plugins.read" })) }),
});

/** `PUT` — one save; a refusal from the save rule is answered as-is (503 for an unavailable store, else 400). */
export const pluginProviderSettingsSaveRoute = defineJsonRoute<{ pluginId: string; values: unknown }, ProviderSettingsCard, ProviderSettingsRouteDeps, PluginsRoutePrincipal>({
  method: "put",
  path: PATH,
  parse: (raw) => ok({ value: { pluginId: pluginIdParam(raw.params), values: (raw.body as { values?: unknown } | null | undefined)?.values } }),
  handle: async ({ input, deps, context, authorize }) => {
    const card = await resolveCard({ deps, authorize, context, pluginId: input.pluginId, permission: "admin.plugins.enable" });
    const { deps: _deps, ...saveArgs } = card;
    const saved = await deps.saveProviderSettings({ ...saveArgs, values: input.values });
    if ("refusal" in saved) throw new RouteRefusalError({ status: saved.refusal.code === "PROVIDER_SETTINGS_UNAVAILABLE" ? 503 : 400, body: saved.refusal });
    const attached = deps.projectKeys ? await deps.projectKeys.savedResult({ result: saved }) as typeof saved : saved;
    return ok({ value: { ...(await cardOf(card)), appliesAt: attached.appliesAt, ...(attached.message ? { message: attached.message } : {}) } });
  },
});
