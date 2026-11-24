import type { AdminHttpError } from "@jini-ai/core/admin-runtime";

import type { RequestErrorGuard } from "./version-conflict.js";

/**
 * @file Classifies a rejected credential create/update into a dictionary-key-shaped result. The
 * host's request-error class is injected as the same `isRequestError` guard its `createAdminHttp`
 * ports already carry, so the classifier never imports a host error class.
 */

/** A dictionary-key-shaped result; callers translate it and handle generic errors themselves. */
export type CredentialSubmitFailure = { kind: "duplicate-label" } | { kind: "validation"; detail: string } | { kind: "generic" };

/** The bound classifier a host exports once. */
export type ClassifyCredentialSubmitError = (required: { error: unknown }, optional?: Record<string, never>) => CredentialSubmitFailure;

/**
 * Builds the classifier for a rejected `createCredential`/`updateCredential` call. Reads `error.code`, falling back
 * to `error.message`, for the two known markers (`DUPLICATE_LABEL`, `VALIDATION`):
 * this app's usual server shape is `{ error: <human message>, code: <MACHINE_CODE> }` (see
 * `workspace/rules.ts`'s own `describeApiError` override for the precedent), but the dispatched API
 * contract for this route writes `409 -> { error: "DUPLICATE_LABEL" }` and
 * `400 -> { error: "VALIDATION", detail }` with no separate `code` field at all — `request()`
 * (`lib/api.ts`) puts `body.error` into `error.message` and `body.code` into `error.code`, so
 * either server shape can carry the marker. A present code takes precedence over the message.
 * Source-control's backend slice follows the same 409/400 contract.
 * @complexity O(1) to build; each classification O(1).
 */
export function createCredentialSubmitErrorClassifier<E extends AdminHttpError>(
  { isRequestError }: { isRequestError: RequestErrorGuard<E> },
  _optional: Record<string, never> = {},
): ClassifyCredentialSubmitError {
  return (required, _options = {}) => {
    if (!isRequestError(required)) return { kind: "generic" };
    const { error } = required;
    const marker = error.code ?? error.message;
    if (marker === "DUPLICATE_LABEL") return { kind: "duplicate-label" };
    if (marker === "VALIDATION") {
      const detail = typeof error.body?.detail === "string" ? error.body.detail : error.message;
      return { kind: "validation", detail };
    }
    return { kind: "generic" };
  };
}
