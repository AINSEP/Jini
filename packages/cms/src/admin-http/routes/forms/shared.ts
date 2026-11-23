import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Shared guards for the `forms` admin route specs: the authorization call every route makes
 * at its own chosen point, the principal id it records as the actor, and the not-found refusal the
 * `/forms/:formId` routes answer when the definition does not resolve.
 */

/** The principal fields these routes read: only the id, as the write's actor. */
export interface FormsRoutePrincipal { id: string }

export const FORMS_MANAGE = "admin.forms.manage";

/**
 * Ask the host's authorizer for one forms permission. A mount without an authorizer is a wiring
 * bug, not a caller error. By-id routes pass `entityId` so the authorizer decides for that entity;
 * list-style routes stay id-free (no `entityId` key at all), as the hand-written routes did.
 *
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeForms(
  { authorize, permission, entityType }: { authorize: JsonRouteAuthorize | undefined; permission: string; entityType: string },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  if (!authorize) throw new Error("forms admin route has no authorizer");
  await (optional.entityId === undefined ? authorize({ permission, entityType }) : authorize({ permission, entityType }, { entityId: optional.entityId }));
}

/**
 * The authenticated principal's id.
 *
 * @complexity O(1).
 */
export function formsActorId({ context }: { context: FormsRoutePrincipal | undefined }, _options: Record<string, never> = {}): string {
  if (!context) throw new Error("forms admin route has no authenticated principal");
  return context.id;
}

/**
 * Refuse with the `/forms/:formId` routes' shared 404 for a definition that resolved by neither
 * slug nor id.
 *
 * @complexity O(1).
 */
export function rejectFormDefinitionNotFound({ formId }: { formId: string }, _options: Record<string, never> = {}): never {
  return rejectRoute({ status: 404, error: `form definition '${formId}' was not found`, code: "FORMS_DEFINITION_NOT_FOUND" });
}

/**
 * Refuse with the submission routes' shared 404 for a submission that is missing or belongs to
 * another form.
 *
 * @complexity O(1).
 */
export function rejectFormSubmissionNotFound({ submissionId }: { submissionId: string }, _options: Record<string, never> = {}): never {
  return rejectRoute({ status: 404, error: `submission '${submissionId}' was not found`, code: "FORMS_SUBMISSION_NOT_FOUND" });
}

/** A route param as the hand-written routes read it: `String(param ?? "")`. */
export const routeParam = (params: Record<string, string>, name: string): string => String(params[name] ?? "");
