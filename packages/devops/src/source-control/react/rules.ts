import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import type { AdminPublishTargetField, PublishCredentialSubmitFailure } from "../../deploy/react/rules.js";

export type AdminSourceControlProviderId = string;
export interface AdminSourceControlProviderDescriptor { id: string; label: string; credential?: { help?: string; tokenPageUrl?: string; tokenField: string; fields: AdminPublishTargetField[] }; i18n?: Record<string, Record<string, string>> }
export interface AdminSourceControlCredentialSummary { readonly tokenHint?: CredentialTokenHint | null; readonly id: string; readonly providerId: string; readonly label: string; readonly configured: true; readonly isDefault: boolean; readonly createdAt: string; readonly updatedAt: string }
export type AdminSourceControlConnectionInput = { providerId: string; token: string } & Record<string, string>;
export interface AdminSourceControlProvidersSnapshot { providers: AdminSourceControlProviderDescriptor[]; switchedOff: { id: string; pluginId: string }[]; refusals: string[] }

/**
 * @file Pure data and computation for the Source Control page — no React, no fetch, no `t()` calls
 * (every function here returns a dictionary key for a caller to translate). Same
 * `rules.ts`-holds-the-logic convention `deployment/rules.ts`/`integrations/rules.ts` follow.
 *
 * This page is a CONNECTION page, not git integration — see `SourceControl.tsx`'s own header for
 * the scope boundary. The hosts are data: each comes from a plugin's `jini-source-control.json`
 * (`GET .../system/source-control/providers`), which also declares its credential form and guidance.
 * This file turns those descriptors into rows and holds the same connect/validate/build trio the
 * publish credential form needs.
 */

/** One host row this page can render, built from its plugin's descriptor. A saved connection whose
 *  host is not listed (its plugin off or missing) gets a bare `listed: false` entry named by its id:
 *  it stays visible, but takes no new token here. */
export interface SourceControlProviderInfo {
  readonly id: AdminSourceControlProviderId;
  /** Proper noun — rendered verbatim, never translated. */
  readonly label: string;
  /** Where to create a token; `""` when the host names none (no link is rendered). */
  readonly tokenPageUrl: string;
  /** The host's own guidance (which token, which scopes), passed through the translator; `""` when none. */
  readonly scopeGuidanceKey: string;
  /** The declared field that holds the token. */
  readonly tokenField: string;
  /** The token input's label from the descriptor; absent means the generic "Access token". */
  readonly tokenLabel?: string;
  /** The host's other declared credential fields; a `required` one gates Save. */
  readonly fields: readonly AdminPublishTargetField[];
  readonly listed: boolean;
}

/** One listed host's entry. A descriptor with no credential form takes just a token.
 *  @complexity O(f) in its declared field count. */
export function sourceControlProviderInfoFromDescriptor({ descriptor }: { descriptor: AdminSourceControlProviderDescriptor }, _optional: Record<string, never> = {}): SourceControlProviderInfo {
  const credential = descriptor.credential ?? { tokenField: "token", fields: [], tokenPageUrl: "", help: "" };
  // `tokenField` and `fields` are required on a credential form (`AdminPublishTargetCredentialSpec`);
  // only the form itself may be absent, which the fallback above covers.
  const { tokenField } = credential;
  const token = credential.fields.find((field) => field.name === tokenField);
  return {
    id: descriptor.id,
    label: descriptor.label,
    tokenPageUrl: credential.tokenPageUrl ?? "",
    scopeGuidanceKey: credential.help ?? "",
    tokenField,
    ...(token !== undefined ? { tokenLabel: token.label } : {}),
    fields: credential.fields.filter((field) => field.name !== tokenField),
    listed: true,
  };
}

/** The bare entry for a saved connection whose host is not listed. @complexity O(1). */
function unlistedSourceControlProviderInfo(id: AdminSourceControlProviderId): SourceControlProviderInfo {
  return { id, label: id, tokenPageUrl: "", scopeGuidanceKey: "", tokenField: "token", fields: [], listed: false };
}

/**
 * This page's rows: every listed host in the server's order, then one `listed: false` entry per
 * saved connection's unlisted host (IRON RULE: a saved credential never drops off the page).
 * @complexity O(p + c * p) in the host and saved-connection counts (both small).
 */
export function sourceControlProviders(
  { descriptors, credentials }: { descriptors: readonly AdminSourceControlProviderDescriptor[] | undefined; credentials: readonly Pick<AdminSourceControlCredentialSummary, "providerId">[] }, _optional = {}
): SourceControlProviderInfo[] {
  const providers = (descriptors ?? []).map(descriptor => sourceControlProviderInfoFromDescriptor({ descriptor }));
  for (const credential of credentials) {
    if (!providers.some((provider) => provider.id === credential.providerId)) providers.push(unlistedSourceControlProviderInfo(credential.providerId));
  }
  return providers;
}

/** One host row's typed fields: the token, plus its other declared fields by name. */
export interface SourceControlCredentialFormFields {
  readonly providerId: AdminSourceControlProviderId;
  readonly token: string;
  readonly values: Readonly<Record<string, string>>;
}

/**
 * Builds the wire {@link AdminSourceControlConnectionInput}: `providerId`, the unchanged token, and
 * each non-blank declared field. Ordinary fields are trimmed; secret fields reach the store
 * unchanged so its admission policy can reject whitespace-only input. Always includes `token`, even when blank —
 * detecting "no new token typed" is {@link sourceControlCredentialRowReadyToSave}'s job.
 * @complexity O(f + c) time, O(f + c) space for f declared fields containing c characters.
 */
export function buildSourceControlConnectionInput(
  { fields, declaredFields }: { fields: SourceControlCredentialFormFields; declaredFields: readonly Pick<AdminPublishTargetField, "name" | "secret">[] },
  _optional: Record<string, never> = {},
): AdminSourceControlConnectionInput {
  const values: Record<string, string> = {};
  for (const field of declaredFields) {
    const raw = fields.values[field.name] ?? "";
    const value = field.secret ? raw : raw.trim();
    if (value !== "") values[field.name] = value;
  }
  return { ...values, providerId: fields.providerId, token: fields.token };
}

/** The single fixed label every connection saved through this page's flat per-provider row list
 *  uses — same "there is no picker left to order, every provider gets its own always-visible row,
 *  so there is nothing left to name" reasoning `PUBLISH_CREDENTIAL_ROW_LABEL` documents. If the
 *  backing table keeps a `(workspace_id, provider_id, label)` UNIQUE constraint the way
 *  `publish_credential_sets` does, this satisfies it without ever asking an operator to type one. */
export const SOURCE_CONTROL_CREDENTIAL_ROW_LABEL = "default";

/**
 * Every saved credential for one provider, in the order the server returned them.
 * @complexity O(n) in this workspace's total saved-credential count (small).
 */
export function sourceControlCredentialsForProvider(
  { credentials, providerId }: { credentials: readonly AdminSourceControlCredentialSummary[]; providerId: AdminSourceControlProviderId },
  _optional: Record<string, never> = {},
): AdminSourceControlCredentialSummary[] {
  return credentials.filter((credential) => credential.providerId === providerId);
}

/** Which saved connection (if any) a provider's flat row should treat as "connected" — the group's
 *  DEFAULT row. Falls back to the first saved row only as a defensive read; mirrors
 *  `defaultCredentialForProvider`'s exact reasoning in `deployment/rules.ts`.
 *  @complexity O(n) in this provider's own (small) saved-connection count. */
export function defaultSourceControlCredentialForProvider(
  { credentials, providerId }: { credentials: readonly AdminSourceControlCredentialSummary[]; providerId: AdminSourceControlProviderId },
  _optional: Record<string, never> = {},
): AdminSourceControlCredentialSummary | undefined {
  const forProvider = sourceControlCredentialsForProvider({ credentials, providerId });
  return forProvider.find((credential) => credential.isDefault) ?? forProvider[0];
}

/**
 * Whether one host's row has enough typed to save: a token, and every required declared field. A
 * blank token always means "nothing to save", connected or not (leaving it blank on a connected row
 * keeps the stored secret untouched). An unlisted host takes no new token.
 * @complexity O(f) in the declared field count.
 */
export function sourceControlCredentialRowReadyToSave({ fields, info }: { fields: SourceControlCredentialFormFields; info: SourceControlProviderInfo }, _optional: Record<string, never> = {}): boolean {
  if (!info.listed || fields.token.trim() === "") return false;
  return info.fields.every((field) => field.required !== true || (fields.values[field.name] ?? "").trim() !== "");
}

/** What a rejected credential create/update means for the FORM — a dictionary-key-shaped result to
 *  translate and apply, mirroring `PublishCredentialSubmitFailure` exactly. `"generic"` is the
 *  catch-all every other kind falls back to. */
export type SourceControlCredentialSubmitFailure = PublishCredentialSubmitFailure;

/**
 * Classifies a rejected create/update call. Checks BOTH `e.code` and `e.message` for the two known
 * markers, same reasoning `classifyPublishCredentialSubmitError` documents in `deployment/rules.ts`
 * — this page's own backend slice (not yet built, see this feature's handoff note) is expected to
 * follow the same `409 -> { error: "DUPLICATE_LABEL" }` / `400 -> { error: "VALIDATION", detail }`
 * shape every other admin write route in this app uses.
 * @complexity O(1).
 */
export function classifySourceControlCredentialSubmitError({ e, classifyCredentialSubmitError }: { e: unknown; classifyCredentialSubmitError(required: { error: unknown }): SourceControlCredentialSubmitFailure }, _optional = {}): SourceControlCredentialSubmitFailure {
  return classifyCredentialSubmitError({ error: e });
}

/** Why the Providers tab lists fewer hosts than expected: one sentence plus the server's reasons. */
export interface SourceControlProvidersNotice {
  readonly message: string;
  readonly reasons: readonly string[];
}

/**
 * The Providers tab's read-only explanation (open-bugs pending bug 1 / combine-23 bug 6). Why: the
 * tab showed an empty list with no reason while the GitHub plugin read Enabled — a failed providers
 * load was swallowed and the route's load refusals were never sent — so the owner had nothing to act
 * on. Returns `null` when every installed host loaded; never offers an action of its own, only the
 * next step to take in Agent Plugins.
 *
 * @complexity O(r + s) in refusals and switched-off hosts.
 */
export function sourceControlProvidersNotice(
  { snapshot, failed, t }: { snapshot: AdminSourceControlProvidersSnapshot | undefined; failed: boolean; t: (key: string) => string },
  _optional = {},
): SourceControlProvidersNotice | null {
  if (failed) return { message: t("The source-control hosts could not be loaded from Agent Plugins. Reload the page to try again."), reasons: [] };
  if (snapshot === undefined) return null;
  const empty = snapshot.providers.length === 0;
  // A switched-off plugin beside a working host is a choice, not a fault; it only explains an empty list.
  const switchedOff = empty ? snapshot.switchedOff.map(({ id, pluginId }) => `${id}: ${pluginId} ${t("is turned off")}`) : [];
  const reasons = [...snapshot.refusals, ...switchedOff];
  if (reasons.length === 0) {
    return empty ? { message: t("No enabled Agent Plugin provides a source-control host. Install or turn one on in Agent Plugins."), reasons } : null;
  }
  return {
    message: empty
      ? t("No source-control host was loaded. Reinstall or turn on the plugin in Agent Plugins.")
      : t("Some source-control hosts were not loaded. Reinstall or turn on the plugin in Agent Plugins."),
    reasons,
  };
}

