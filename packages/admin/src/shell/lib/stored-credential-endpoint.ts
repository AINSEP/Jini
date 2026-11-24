import type { AdminHttpError } from "@jini-ai/core/admin-runtime";
import { trimCharsEnd } from "@jini-ai/core/primitives";
import { type Translate } from "@jini-ai/core/text";

import type { RequestErrorGuard } from "./version-conflict.js";

/**
 * @file Rules for a BYOK key the server holds write-only and will only send to the endpoint it was saved
 * for — the endpoint pin in the server's `stored-credential-probe.ts`.
 *
 * Shared by the host admin's two key screens so both answer "can this stored key be probed here?" the same
 * way: the visitor key form and the admin's own execution-credential form (owner repro 2026-09-13).
 *
 * The probe-error wording reads the host's request-error class through the injected `isRequestError`
 * guard (the one its `createAdminHttp` ports carry); a host binds {@link createProbeErrorDescribers} once.
 */

/** The two fields of a stored-credential view these rules read. `SiteAssistantCredential` and
 *  `AdminExecutionCredential` both carry them. */
export interface StoredCredentialEndpoint {
  isSet: boolean;
  baseUrl: string | null;
}

/** The ask shown when the stored key belongs to another endpoint: the key line's status and, through
 *  {@link ProbeErrorDescribers.describeProbeError}, a probe the server refused for that reason. One constant so the two
 *  cannot drift. Also a dictionary key in the host's assistant dictionary. */
export const STORED_KEY_OTHER_PROVIDER_COPY = "Your saved key is for a different provider. Paste a key for this one.";

/** {@link ProbeErrorDescribers.describeProbeError}'s copy for a stored key with no saved endpoint. Also a dictionary key. */
export const STORED_KEY_NO_ENDPOINT_COPY = "Your saved key has no provider saved with it. Paste the key again to test it.";

/** Mirrors `normalizeEndpoint` in the server's `stored-credential-probe.ts` (trim, strip trailing
 *  slashes, no case folding). The two must agree, or a screen and the server disagree about which
 *  endpoint a stored key belongs to. */
function normalizeEndpoint({ baseUrl }: { baseUrl: string }, _options = {}): string {
  return trimCharsEnd({ text: baseUrl.trim(), chars: "/" });
}

/**
 * True when a key is stored and the server recorded a DIFFERENT endpoint for it than the form's —
 * the provider-switch case. The server only lets a key it holds go to the endpoint it was saved for,
 * so a stored-key probe against the form's endpoint can only be refused.
 *
 * An unknown stored endpoint (`null` or blank) is `false`: it is not provably another endpoint, so the
 * server's own answer stands, translated by {@link ProbeErrorDescribers.describeProbeError}. So is a view that has not
 * loaded yet (`null`).
 *
 * @complexity Time/space: O(n) in the two URL lengths.
 */
export function storedKeyIsForOtherEndpoint({ stored, baseUrl }: { stored: StoredCredentialEndpoint | null; baseUrl: string }, _options = {}): boolean {
  const storedBaseUrl = stored?.isSet ? stored.baseUrl?.trim() : "";
  if (!storedBaseUrl) return false;
  return normalizeEndpoint({ baseUrl: storedBaseUrl }) !== normalizeEndpoint({ baseUrl });
}

/** A key a probe can use HERE — typed into the field, or stored on the server for this endpoint. A
 *  key stored for another endpoint does not count; see {@link storedKeyIsForOtherEndpoint}.
 *
 * @complexity Time/space: O(n) in the two URL lengths.
 */
export function hasUsableKey({ apiKey, stored, baseUrl }: { apiKey: string; stored: StoredCredentialEndpoint | null; baseUrl: string }, _options = {}): boolean {
  if (apiKey.trim()) return true;
  return stored?.isSet === true && !storedKeyIsForOtherEndpoint({ stored, baseUrl });
}

/**
 * True when a probe from this form could only offer the stored key to an endpoint the server did not
 * save it for: nothing is typed, and the stored key belongs to another endpoint. The server refuses
 * that probe, so a screen sends nothing and its key line asks for this provider's key instead.
 *
 * @complexity Time/space: O(n) in the key and URL lengths.
 */
export function storedKeyBlocksProbe({ apiKey, stored, baseUrl }: { apiKey: string; stored: StoredCredentialEndpoint | null; baseUrl: string }, _options = {}): boolean {
  return !apiKey.trim() && storedKeyIsForOtherEndpoint({ stored, baseUrl });
}

/** The two probe-error readers, bound to one host request-error class. */
export interface ProbeErrorDescribers {
  describeProbeError(required: { e: unknown; fallback: string }, _options?: Record<string, never>): string;
  createProbeErrorDescriber(required: { t: Translate }, _optional?: Record<string, never>): (error: unknown) => string;
}

/**
 * Binds the probe-error readers to the host's request-error guard. A host binds once at its composition root.
 *
 * @complexity Time/space: O(1).
 */
export function createProbeErrorDescribers<E extends AdminHttpError>(
  { isRequestError }: { isRequestError: RequestErrorGuard<E> },
  _optional: Record<string, never> = {},
): ProbeErrorDescribers {
  /**
   * The message a failed probe (model list, Test Key, Test connection) shows. The server's two
   * endpoint-pin refusals are written for API callers ("supply an apiKey in this request"), so they are
   * replaced with plain language. Anything else keeps the thrown message, usually the provider's own.
   *
   * @complexity Time/space: O(1).
   */
  function describeProbeError({ e, fallback }: { e: unknown; fallback: string }, _options = {}): string {
    const required = { error: e };
    if (isRequestError(required) && required.error.code === "STORED_CREDENTIAL_ENDPOINT_MISMATCH") return STORED_KEY_OTHER_PROVIDER_COPY;
    if (isRequestError(required) && required.error.code === "STORED_CREDENTIAL_ENDPOINT_UNSET") return STORED_KEY_NO_ENDPOINT_COPY;
    return e instanceof Error ? e.message : fallback;
  }

  /**
   * `@jini-ai/ui` `ExecutionTab`'s `describeProbeError` prop for a screen whose translator is `t`:
   * {@link ProbeErrorDescribers.describeProbeError}'s wording, translated. A provider's own message misses the dictionary and
   * stays as sent; a non-`Error` throw is worded by its string form. Both admin mounts of `ExecutionTab`
   * (Settings -> Execution mode, AI Assistant -> Admin AI Assistant) pass this, so the two cannot word a
   * refused model discovery or Test connection differently.
   *
   * @complexity Time/space: O(1) per call.
   */
  function createProbeErrorDescriber({ t }: { t: Translate }, _optional: Record<string, never> = {}): (error: unknown) => string {
    return (error) => t(describeProbeError({ e: error, fallback: String(error) }));
  }

  return { describeProbeError, createProbeErrorDescriber };
}
