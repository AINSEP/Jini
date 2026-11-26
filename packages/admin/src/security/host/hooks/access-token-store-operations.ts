import { withoutUndefined } from "@jini-ai/core/records";
import type { Translate } from "@jini-ai/core/text";
import type { AdminPublishConnectionInput, AdminPublishCredentialSummary } from "../../api/security-api.types.js";
import type { AdminSourceControlConnectionInput, AdminSourceControlCredentialSummary } from "../../../source-control/api/source-control-api.types.js";
import { accessTokenDuplicateNameMessage, accessTokenSaveErrorMessage, accessTokensLoadErrorMessage } from "../../security-i18n.js";
import { type AccessTokenKind } from "../../access-token-rows.js";
import type { AccessTokensPort } from "./access-tokens-port.hooks.js";
import type { AccessTokensDependencies } from "./use-access-tokens.hooks.js";

const UNKNOWN_ERROR = "unknown error";

/** Translates a rejected create/update/delete into a form-ready string — pulled out of the hook body
 *  for the same complexity-budget reason `publishCredentialSubmitErrorMessage` documents in its own
 *  file. @complexity O(1). */
export function accessTokenSubmitErrorMessage(
  { err, t, locale, providerLabel, attemptedName, deps }: {
    deps: AccessTokensDependencies;
    err: unknown;
    t: Translate;
    locale: string;
    providerLabel: string;
    attemptedName: string;
  },
  _optional: Record<string, never> = {},
): string {
  const { classifyAccessTokenSubmitError, isApiError, translateCredentialMessage, describeApiError } = deps;
  const classified = classifyAccessTokenSubmitError({ isApiError, e: err });
  if (classified.kind === "duplicate-label") return accessTokenDuplicateNameMessage({ locale, name: attemptedName, provider: providerLabel });
  if (classified.kind === "validation") return accessTokenSaveErrorMessage({ locale, error: translateCredentialMessage({ message: classified.detail, locale }) });
  return accessTokenSaveErrorMessage({ locale, error: describeApiError({ e: err, fallback: t(UNKNOWN_ERROR) }) });
}

/** Translates a rejected remove/make-default into a row-ready string via `template` — the
 *  Remove/Make-default counterpart of {@link accessTokenSubmitErrorMessage}, kept separate rather
 *  than widened onto it: neither action has a "duplicate name"/"validation" failure mode to
 *  classify (`classifyAccessTokenSubmitError`'s two special cases are Create/Replace-only), so this
 *  is the plain `describeApiError` extraction alone, worded per-action by the caller's own template
 *  (Terra audit MEDIUM finding, 2026-08-19: neither action surfaced a rejected call at all before
 *  this fix). @complexity O(1). */
export function accessTokenActionErrorMessage(
  { err, t, locale, template, deps }: {
    err: unknown;
    t: Translate;
    locale: string;
    deps: AccessTokensDependencies;
    template: (input: { locale: string; error: string }) => string;
  },
  _optional: Record<string, never> = {},
): string {
  const { describeApiError } = deps;
  return template({ locale, error: describeApiError({ e: err, fallback: t(UNKNOWN_ERROR) }) });
}

/** Combines the three independent list-fetch failures (publish, source-control, custom) into one
 *  user-facing message, publish taking priority — pulled out of the hook body for the same
 *  complexity-budget reason {@link accessTokenSubmitErrorMessage} documents. */
export function accessTokensLoadError(
  { publishError, sourceControlError, customError, t, locale, deps }: {
    deps: AccessTokensDependencies;
    publishError: unknown;
    sourceControlError: unknown;
    customError: unknown;
    t: Translate;
    locale: string;
  },
  _optional: Record<string, never> = {},
): string | null {
  const { describeApiError } = deps;
  if (publishError) return accessTokensLoadErrorMessage({ locale, error: describeApiError({ e: publishError, fallback: t(UNKNOWN_ERROR) }) });
  if (sourceControlError) return accessTokensLoadErrorMessage({ locale, error: describeApiError({ e: sourceControlError, fallback: t(UNKNOWN_ERROR) }) });
  if (customError) return accessTokensLoadErrorMessage({ locale, error: describeApiError({ e: customError, fallback: t(UNKNOWN_ERROR) }) });
  return null;
}

/** Returns the first rejected settlement's reason among `results`, or `undefined` if every one
 *  fulfilled — lets {@link reloadAllStores} surface a background reload's per-store failure to the
 *  user without going back to a `Promise.all` that would discard the OTHER two stores' successfully
 *  refreshed data just because one rejected (2026-09-05 Gemini audit, verified: a just-revoked token
 *  in a store that itself reloaded fine could keep rendering as active, because the ONE other
 *  store's transient failure erased all three). Priority matches {@link accessTokensLoadError}'s own
 *  publish-then-source-control-then-custom order, since `results` is always built in that order.
 *  @complexity O(n) in the settled-result count (always 3 here). */
export function firstRejectionReason(results: readonly PromiseSettledResult<unknown>[]): unknown {
  return results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
}

/** Normalizes one store's update payload into the exact `{label?, connection?, isDefault?}` shape
 *  each port method wants, dispatching on `kind` — the one place a `connection`'s union type is cast
 *  down to the specific store's own type (see `rules.ts`'s `buildAccessTokenConnectionInput` doc for
 *  why this is safe). Split out of {@link useAccessTokens}'s action functions purely to keep each of
 *  those under this repo's complexity gate. */
export async function writeCredential(
  { port, kind, mode, patch }: {
    port: AccessTokensPort;
    kind: AccessTokenKind;
    mode: { readonly type: "create"; readonly label: string } | { readonly type: "update"; readonly id: string };
    patch: { label?: string; connection?: AdminPublishConnectionInput | AdminSourceControlConnectionInput; isDefault?: boolean; worksFor?: string[] };
  },
  _optional: Record<string, never> = {},
): Promise<AdminPublishCredentialSummary | AdminSourceControlCredentialSummary> {
  if (kind === "publish") {
    const connection = patch.connection as AdminPublishConnectionInput | undefined;
    if (mode.type === "create") {
      if (!connection) throw new Error("new publish credential has no connection");
      return port.publish.create({ label: mode.label, connection, ...withoutUndefined({ source: { isDefault: patch.isDefault, worksFor: patch.worksFor } }) });
    }
    return port.publish.update({ id: mode.id, input: withoutUndefined({ source: { ...patch, connection } }) });
  }
  const connection = patch.connection as AdminSourceControlConnectionInput | undefined;
  if (mode.type === "create") {
    if (!connection) throw new Error("new source control credential has no connection");
    return port.sourceControl.create({ label: mode.label, connection, ...withoutUndefined({ source: { isDefault: patch.isDefault } }) });
  }
  return port.sourceControl.update({ id: mode.id, input: withoutUndefined({ source: { ...patch, connection } }) });
}

/** @complexity O(n) in the provider's own (small) saved-row count. */
export function mergeRaw<T extends { id: string }>({ list, result, isNew }: { list: readonly T[]; result: T; isNew: boolean }, _optional: Record<string, never> = {}): T[] {
  return isNew ? [...list, result] : list.map((item) => (item.id === result.id ? result : item));
}
