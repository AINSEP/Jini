import type { ProviderKeyUsage } from "@jini-ai/core/contracts/site/plugins-host";
import { requireInputRecord, requireString, ToolInputError, type ToolExecutionContext, type ToolExecutionOptions, type ToolHandler } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { PluginProviderSettingField } from "@jini-ai/core/contracts/plugin-sdk";
import type { SecretCardField, SecretCardForm, SurfaceCardApp, SurfaceOutcomeSpec } from "@jini-ai/core/contracts/cards";
import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";

import type { CustomCredentialSecretCards } from "../credentialed-http/tools/credential-tool-host.js";

/**
 * @file The assistant's key card for a PROVIDER plugin's settings (2026-10-25): an agent plugin
 * declares a credential card with `saveKind: "provider-settings"` and `saveTarget: <provider plugin
 * id>`, and `credential_save` (kind plugin-provider) opens it. The form's fields are the provider
 * plugin's own manifest-declared settings (public values, declared defaults and choices, masked
 * secrets); the agent plugin only supplies the copy (title, intro, help link). A submission saves
 * through the host's shared provider-settings save rule (the admin Settings card's rule and store),
 * so a key typed here lands in the same row, never in a credential row, the transcript or model input.
 * Core names no vendor: every word on the card comes from the two manifests.
 */

/** Host ports, bound by the composition root to the shared save rule and `ProviderConfigSource`. */
export interface ProviderSettingsCardPorts {
  readonly usage?: (required: { pluginId: string }) => Promise<ProviderKeyUsage>;
  /** The provider plugin's declared settings; undefined when it is not installed or declares none. */
  readonly fields: (required: { pluginId: string }) => Promise<readonly PluginProviderSettingField[] | undefined>;
  /** Saved public values and the NAMES of saved secrets; null when nothing is saved or it is unreadable. */
  readonly readSettings: (required: { pluginId: string }) => Promise<{ settings: Readonly<Record<string, string>>; secretNames: readonly string[] } | null>;
  /** The shared save rule: writes, or returns the refusal text without writing. */
  readonly save: (required: { pluginId: string; values: Readonly<Record<string, string>> }) => Promise<Saved | { refusal: string }>;
  /** The admin Settings card's save permission (`admin.plugins.enable`). */
  readonly authorize: (ctx: ToolExecutionContext) => Promise<void>;
}

/** The host's identity for the provider-settings card: the tool id it answers as (`credential_save`),
 *  its `ui://` namespace and the app names its form and outcome report. */
export interface ProviderSettingsCardIdentity {
  readonly toolId: string;
  readonly uriNamespace: string;
  readonly formApp: SurfaceCardApp;
  readonly outcomeApp: SurfaceCardApp;
}

type SavedView = Awaited<ReturnType<ProviderSettingsCardPorts["readSettings"]>>;
type Prep = { pluginId: string; card?: PluginCredentialCard | undefined; fields: readonly PluginProviderSettingField[]; saved: SavedView; usage?: ProviderKeyUsage | undefined };
type Saved = { configured?: boolean; store: "project" | "site"; keyId?: string; usedByThisSite?: boolean; usedBy?: readonly string[]; appliesAt?: "now" | "restart" | "failed"; message?: string };
export type ProviderSettingsSaveResult =
  | { saved: true; pluginId: string; store: "project" | "site"; configured?: boolean; appliesAt: "now" | "restart" | "failed"; message?: string; keyId?: string; usedByThisSite?: boolean; usedBy?: readonly string[]; ask?: string }
  | { saved: false; reason: string; message?: string | undefined };

/** The select option that reveals a field's free-text twin (`allowCustom`). */
const CUSTOM = "__custom";
const customName = ({ name }: { name: string }, _optional = {}) => `${name}__custom`;

/** All controls retain the provider's conditional requirement metadata. */
function fieldRequirements({ field }: { field: PluginProviderSettingField }, _options = {}) {
  return {
    ...(field.requiredUnless ? { requiredUnless: field.requiredUnless } : {}),
    ...(field.requiredWhen ? { requiredWhen: field.requiredWhen } : {}),
  };
}

/** A declared public field with choices: a select (plus "Custom…" and its text field when allowed). */
function choiceFields({ field, value }: { field: PluginProviderSettingField; value?: string | undefined }): SecretCardField[] {
  const custom = isCustomChoice({ field, value });
  const select = choiceSelectOf({ field, selected: custom && field.allowCustom ? CUSTOM : value ?? field.default });
  if (!field.allowCustom) return [select];
  return [select, customTextOf({ field, value: custom ? value : undefined })];
}

/** A saved value that is none of the declared choices (so it was typed into "Custom…"). */
function isCustomChoice({ field, value }: { field: PluginProviderSettingField; value?: string | undefined }, _optional = {}): boolean {
  return Boolean(value) && !(field.options ?? []).some((option) => option.value === value);
}

/** The select over the declared choices, plus the "Custom…" choice when allowed. */
function choiceSelectOf({ field, selected }: { field: PluginProviderSettingField; selected?: string | undefined }, _optional = {}): SecretCardField {
  const options = field.options ?? [];
  return { kind: "enum", name: field.name, label: field.label, required: field.required === true,
    ...fieldRequirements({ field }),
    options: [...options, ...(field.allowCustom ? [{ value: CUSTOM, label: "Custom…" }] : [])], ...(selected !== undefined ? { value: selected } : {}) };
}

/** The free-text twin of a select that allows a custom value; `value` is set only for a custom choice. */
function customTextOf({ field, value }: { field: PluginProviderSettingField; value?: string | undefined }, _optional = {}): SecretCardField {
  return { kind: "string", name: customName({ name: field.name }), label: `Custom ${field.label.toLowerCase()}`, ...(field.hint ? { hint: field.hint } : {}), ...(value ? { value } : {}) };
}

/** A secret control never carries its value; conditional blanks reach the shared server save rule. */
function secretFieldOf({ field, saved, required }: { field: PluginProviderSettingField; saved: SavedView; required: boolean }): SecretCardField {
  const kept = saved?.secretNames.includes(field.name) === true;
  const hint = [field.hint, kept ? "Leave blank to keep the saved one." : undefined].filter(Boolean).join(" ");
  return { kind: "string", name: field.name, label: field.label, secret: true, required, ...(kept ? { hasSavedValue: true } : {}),
    ...(field.requiredUnless ? { requiredUnless: field.requiredUnless } : {}),
    ...(field.requiredWhen ? { requiredWhen: field.requiredWhen } : {}),
    allowBlank: !required || kept || Boolean(field.requiredUnless || field.requiredWhen), ...(hint ? { hint } : {}) };
}

/** One declared field → its form controls. A saved secret may be left blank to keep it. */
function formFieldsOf({ field, saved }: { field: PluginProviderSettingField; saved: SavedView }): SecretCardField[] {
  // Conditional fields keep their base requirement; the form evaluates it as the public choice changes.
  const required = field.required === true;
  if (field.secret) return [secretFieldOf({ field, saved, required })];
  const value = saved?.settings[field.name] || undefined;
  if (field.options?.length) return choiceFields({ field, value });
  const initial = value ?? field.default;
  return [{ kind: "string", name: field.name, label: field.label, required, ...fieldRequirements({ field }),
    ...(field.hint ? { hint: field.hint } : {}), ...(initial ? { value: initial } : {}) }];
}

/** The declared card's help, key-entry hint and purposes; values never come from saved settings. */
function providerCardDetails({ card }: { card?: PluginCredentialCard | undefined }, _optional = {}) {
  const details: { label: string; value: string }[] = [];
  if (!card) return details;
  if (card.helpUrl) details.push({ label: card.helpLabel ?? "Help", value: card.helpUrl });
  if (card.keyHint) details.push({ label: "Where to find it", value: card.keyHint });
  if (card.usedFor?.length) details.push({ label: "Used for", value: card.usedFor.join("; ") });
  return details;
}

/** Explain a site-only replacement before the person enters a different project's key. */
function otherSiteKeyNotice({ usage, label }: { usage?: ProviderKeyUsage | undefined; label: string }, _optional = {}): string {
  if (!usage || usage.store !== "project" || usage.usedByThisSite || usage.usedBy.length === 0) return "";
  return ` Your project's saved ${label} key is used by ${usage.usedBy.join(", ")}. A key entered here is used by this site only.`;
}

/** The card: plugin copy over the provider's declared fields. @complexity O(f) declared fields. */
export function buildProviderSettingsForm({ prep, app }: { prep: Prep; app: SurfaceCardApp }, _optional = {}): SecretCardForm {
  const { card } = prep;
  const otherUse = otherSiteKeyNotice({ usage: prep.usage, label: card?.label ?? "provider" });
  return {
    title: card?.title ?? "Connect provider",
    description: `${card?.intro ? card.intro + " " : ""}Keys are sealed on the server the moment you submit — the assistant never sees them.${otherUse}`,
    details: providerCardDetails({ card }),
    submitLabel: "Save",
    fields: prep.fields.flatMap((field) => formFieldsOf({ field, saved: prep.saved })),
    app,
  };
}

/** Submitted controls → declared setting values (a "Custom…" choice takes its text field). @complexity O(f). */
export function readProviderSettingsValues({ fields, values }: { fields: readonly PluginProviderSettingField[]; values: Readonly<Record<string, unknown>> }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const chosen = values[field.name] === CUSTOM ? values[customName({ name: field.name })] : values[field.name];
    if (typeof chosen === "string") out[field.name] = chosen;
  }
  return out;
}

/** Model-facing projection: where it saved and when it applies, never a value. */
function resultOf({ run, pluginId }: { run: { status: string; saved?: Saved; safeMessage?: string }; pluginId: string }): ProviderSettingsSaveResult {
  if (run.status === "saved" && run.saved) return { saved: true, pluginId, ...run.saved, appliesAt: run.saved.appliesAt ?? "restart" };
  if (run.status === "failed") return { saved: false, reason: "error", message: run.safeMessage };
  if (run.status === "blank") return { saved: false, reason: "invalid", message: "A required key was left blank. Nothing was saved." };
  return { saved: false, reason: run.status };
}

/** A committed save can need browser reload or provider startup without becoming a failed save. */
function savedMessage({ result }: { result: Extract<ProviderSettingsSaveResult, { saved: true }> }, _optional = {}): string {
  if (result.appliesAt === "failed") return result.message ?? "Saved, but the provider could not start. Check the plugin settings and save again.";
  let location = "Saved for this site.";
  if (result.store !== "site") {
    location = result.usedBy?.length
      ? `Saved. Used by ${result.usedBy.join(", ")}. Other sites pick it up within 30 seconds.`
      : "Saved to your project — not used by any site yet.";
  }
  if (!result.configured) return location;
  return location + (result.appliesAt === "now" ? " Now sending." : " Reload open pages or restart this site to finish applying the saved settings.");
}

function outcomeOf({ result, title, app }: { result: ProviderSettingsSaveResult; title: string; app: SurfaceCardApp }): SurfaceOutcomeSpec | undefined {
  const message = result.saved ? savedMessage({ result }) : result.message;
  if (message === undefined) return undefined;
  return { title, state: result.saved && result.appliesAt !== "failed" ? "success" : "failure", app,
    message };
}

/** Thrown with fixed refusal text from the shared rule (names fields, never values). */
class ProviderSettingsRefusedError extends Error {}

/**
 * The `provider-settings` save adapter for `credential_save`. Input: `{ pluginId }` (the card's
 * saveTarget), resolved by `routePluginCard`; never a value.
 * @complexity O(f) per card plus one settings read and one save.
 */
export function buildProviderSettingsCredentialHandler({ ports, surfaces, loadCards, cards, identity }: {
  ports: ProviderSettingsCardPorts; surfaces: AssistantSurfaceDeps; loadCards: () => Promise<readonly PluginCredentialCard[]>;
  /** The host's secret-card engine and its ask-then-report exchange helper. */
  cards: CustomCredentialSecretCards;
  identity: ProviderSettingsCardIdentity;
}, _optional = {}): ToolHandler {
  return async (ctx: ToolExecutionContext, options: ToolExecutionOptions = {}) => {
    const pluginId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "pluginId" });
    const card = cards.defineSecretCardTool<Prep, Saved, ProviderSettingsSaveResult>({
      toolId: identity.toolId,
      prepare: async () => {
        await ports.authorize(ctx);
        const fields = await ports.fields({ pluginId });
        if (!fields) throw new ToolInputError({ message: `The provider plugin '${pluginId}' is not installed or declares no settings. Install and enable it first (plugins_list, plugins_set_enabled).` });
        const declared = (await loadCards()).find((entry) => entry.saveKind === "provider-settings" && entry.saveTarget === pluginId);
        return { pluginId, fields, usage: await ports.usage?.({ pluginId }), saved: await ports.readSettings({ pluginId }), ...(declared ? { card: declared } : {}) };
      },
      form: ({ prep }) => buildProviderSettingsForm({ prep, app: identity.formApp }),
      save: async ({ values, prep }) => {
        const outcome = await ports.save({ pluginId, values: readProviderSettingsValues({ fields: prep.fields, values }) });
        if ("refusal" in outcome) throw new ProviderSettingsRefusedError(outcome.refusal);
        return outcome;
      },
      result: ({ run }) => resultOf({ run, pluginId }),
      outcome: ({ prep, run }) => outcomeOf({ result: resultOf({ run, pluginId }), title: prep.card?.title ?? "Provider settings", app: identity.outcomeApp }),
    }, { uriHost: identity.uriNamespace, frameSize: ["100%", "460px"],
      // The refusal names fields only (shared rule); every other failure keeps the engine's fixed text.
      safeError: (error) => error instanceof ProviderSettingsRefusedError ? error.message : "Saving failed. Nothing was saved." });
    return card.handler({ surfaceExchanges: surfaces.surfaceExchanges, askThenReport: cards.askThenReport })(ctx, options);
  };
}
