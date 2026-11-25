import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import type { AdminMailProviderRefusalDto } from "@jini-ai/core/contracts/site/cms-mail";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { authorizeMail, mailActorId, type MailRoutePrincipal } from "./mail-shared.js";

/**
 * @file Admin mail provider actions beside `./mail-status.ts`: thin adapters over the host's mail
 * provider operations, the same operations the assistant's provider-listing, provider-configuring
 * and provider-switching tools call:
 *
 * - `GET  …/system/mail-providers` — the safe configuration DTO (`admin.forms.manage`, like status).
 * - `GET  …/system/mail-providers/:providerId/credential` — what saving its key takes (label,
 *   category, default endpoint, create vs rotate). `custom-credentials.write`.
 * - `POST …/system/mail-providers/:providerId/activate` — switches BOTH lanes after re-checking the
 *   provider; the click is the person's explicit confirmation. `settings.workspace.write`.
 *
 * - `PUT  …/system/mail-providers/:providerId/credential` — body `{token?, username?, baseUrl?}`:
 *   creates or rotates the key WITHOUT activating the provider; the next send already uses it.
 *   `custom-credentials.write`. Never echoes a secret. Whether a shared key may be replaced depends on
 *   how the request authenticated, which the host binds per request (`requestCredentialKind`).
 *
 * Every route answers its refusals through {@link mailProviderRefusal}, so the host's classifier and
 * the specs share one mapping table.
 */

/** The provider operations' own refusal codes. */
export type MailProviderOperationCode =
  | "MAIL_PROVIDER_CONTROL_UNAVAILABLE" | "MAIL_PROVIDER_NOT_FOUND" | "MAIL_PROVIDER_KEYLESS"
  | "MAIL_PROVIDER_REFUSED" | "MAIL_PROVIDER_INPUT" | "MAIL_PROVIDER_CHANGED";

/** The credential store's refusal codes (the custom-credentials route's codes). */
export type MailProviderStoreErrorCode = "VALIDATION" | "DUPLICATE_LABEL" | "NOT_FOUND" | "SECRET_STORE_UNCONFIGURED";

/** A failure the host recognises: an operation refusal (its message is caller-safe) or a store refusal (only its code is). */
export type MailProviderFailure =
  | { kind: "operation"; code: MailProviderOperationCode; message: string }
  | { kind: "store"; code: MailProviderStoreErrorCode };

const OPERATION_STATUS: Readonly<Record<MailProviderOperationCode, number>> = {
  MAIL_PROVIDER_CONTROL_UNAVAILABLE: 503, MAIL_PROVIDER_NOT_FOUND: 404, MAIL_PROVIDER_KEYLESS: 409, MAIL_PROVIDER_REFUSED: 409, MAIL_PROVIDER_INPUT: 400, MAIL_PROVIDER_CHANGED: 409,
};

/** Store errors keep the custom-credentials route's codes. */
const STORE_STATUS: Readonly<Record<MailProviderStoreErrorCode, number>> = {
  VALIDATION: 400, DUPLICATE_LABEL: 409, NOT_FOUND: 404, SECRET_STORE_UNCONFIGURED: 503,
};

/** The status and flat body a recognised failure answers; a store refusal never echoes the error's text. @complexity O(1). */
export function mailProviderRefusal({ failure }: { failure: MailProviderFailure }, _optional: Record<string, never> = {}): { status: number; body: AdminMailProviderRefusalDto } {
  if (failure.kind === "operation") return { status: OPERATION_STATUS[failure.code], body: { error: failure.message, code: failure.code } };
  return { status: STORE_STATUS[failure.code], body: { error: failure.code, code: failure.code } };
}

/** The one classifier every route here needs: the host's own error classes are not the engine's to know. */
export interface MailProviderFailureDeps {
  workspaceId: string;
  /** Maps a thrown host error to its failure; `undefined` leaves it an unexpected failure (the host's redacted 500). */
  classifyMailProviderError: (required: { error: unknown }) => MailProviderFailure | undefined;
}

/** `GET …/mail-providers`: the host's configuration DTO, answered unchanged. */
export interface MailProvidersListRouteDeps extends MailProviderFailureDeps { readMailProviderConfigurations: () => Promise<object> }
/** `GET …/:providerId/credential`: the host's credential plan for one provider. */
export interface MailProviderCredentialPlanRouteDeps extends MailProviderFailureDeps {
  planMailProviderCredential: (required: { providerId: string }) => Promise<object>;
}
/** `POST …/:providerId/activate`: the host's re-checked switch, run as the acting principal. */
export interface MailProviderActivateRouteDeps extends MailProviderFailureDeps {
  activateMailProvider: (required: { providerId: string; principalId: string }) => Promise<object>;
}

const BASE_PATH = "/api/admin/v1/workspaces/:workspaceId/system/mail-providers";

/**
 * Authorize one permission on `mail`, run the operation and answer its result unchanged, or the
 * mapped refusal. Authorization runs first, so a refused caller reaches no operation.
 * @complexity O(1) plus the injected authorizer and operation.
 */
async function answer<T>(
  { authorize, permission, deps, run }: { authorize: JsonRouteAuthorize | undefined; permission: string; deps: MailProviderFailureDeps; run: () => Promise<T> },
  _optional: Record<string, never> = {},
) {
  await authorizeMail({ authorize, permission, entityType: "mail" });
  try {
    return ok({ value: await run() });
  } catch (error) {
    const failure = deps.classifyMailProviderError({ error });
    if (!failure) throw error;
    const { status, body } = mailProviderRefusal({ failure });
    return rejectRoute({ status, ...body });
  }
}

/** The provider id as the hand-written route read it: `String(...)`, with no fallback. @complexity O(1). */
const providerIdParam = ({ params }: { params: Record<string, unknown> }, _optional: Record<string, never> = {}) => ({ providerId: String(params.providerId) });

export const mailProvidersListRoute = defineJsonRoute<Record<string, never>, object, MailProvidersListRouteDeps, MailRoutePrincipal>({
  method: "get",
  path: BASE_PATH,
  parse: () => ok({ value: {} }),
  handle: ({ deps, authorize }) => answer({ authorize, permission: "admin.forms.manage", deps, run: () => deps.readMailProviderConfigurations() }),
});

export const mailProviderCredentialPlanRoute = defineJsonRoute<{ providerId: string }, object, MailProviderCredentialPlanRouteDeps, MailRoutePrincipal>({
  method: "get",
  path: `${BASE_PATH}/:providerId/credential`,
  parse: (raw) => ok({ value: providerIdParam({ params: raw.params }) }),
  handle: ({ input, deps, authorize }) => answer({ authorize, permission: "custom-credentials.write", deps,
    run: () => deps.planMailProviderCredential({ providerId: input.providerId }) }),
});

export const mailProviderActivateRoute = defineJsonRoute<{ providerId: string }, object, MailProviderActivateRouteDeps, MailRoutePrincipal>({
  method: "post",
  path: `${BASE_PATH}/:providerId/activate`,
  parse: (raw) => ok({ value: providerIdParam({ params: raw.params }) }),
  handle: ({ input, deps, authorize, context }) => answer({ authorize, permission: "settings.workspace.write", deps,
    run: () => deps.activateMailProvider({ providerId: input.providerId, principalId: mailActorId({ context }) }) }),
});

/** The credential parts a save accepts; any other body key is ignored. */
export interface MailProviderCredentialInput { token?: string; username?: string; baseUrl?: string }

/** `PUT …/:providerId/credential`: the host's save (never activates) and how this request authenticated. */
export interface MailProviderCredentialSaveRouteDeps extends MailProviderFailureDeps {
  /** This request's credential kind (`"session"` for a human session); bound per request by the host. */
  requestCredentialKind: () => unknown;
  /** The site owner's principal id. */
  ownerPrincipalId: () => Promise<string>;
  saveMailProviderCredential: (required: { providerId: string; input: MailProviderCredentialInput; allowSharedKeyReplacement: boolean }) => Promise<unknown>;
}

const CREDENTIAL_PARTS = ["token", "username", "baseUrl"] as const;

/** The body's credential parts; any non-string part is refused rather than coerced. @complexity O(1). */
function readCredentialInput({ body }: { body: unknown }, _optional: Record<string, never> = {}): MailProviderCredentialInput {
  const record = (typeof body === "object" && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const input: Record<string, string> = {};
  for (const key of CREDENTIAL_PARTS) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== "string") {
      const { status, body: refusal } = mailProviderRefusal({ failure: { kind: "operation", code: "MAIL_PROVIDER_INPUT", message: `${key} must be a string.` } });
      return rejectRoute({ status, ...refusal });
    }
    input[key] = record[key] as string;
  }
  return input;
}

export const mailProviderCredentialSaveRoute = defineJsonRoute<{ providerId: string; body: unknown }, { provider: unknown }, MailProviderCredentialSaveRouteDeps, MailRoutePrincipal>({
  method: "put",
  path: `${BASE_PATH}/:providerId/credential`,
  // The body is read only after authorization, so a refused caller never learns how its body would be judged.
  parse: (raw) => ok({ value: { ...providerIdParam({ params: raw.params }), body: raw.body } }),
  handle: ({ input, deps, authorize, context }) => answer({ authorize, permission: "custom-credentials.write", deps, run: async () => {
    const principalId = mailActorId({ context });
    // Match the custom-credentials route: only the owner's human session can replace a shared key.
    const ownerSession = deps.requestCredentialKind() === "session" && principalId === await deps.ownerPrincipalId();
    const credential = readCredentialInput({ body: input.body });
    return { provider: await deps.saveMailProviderCredential({ providerId: input.providerId, input: credential, allowSharedKeyReplacement: ownerSession }) };
  } }),
});
