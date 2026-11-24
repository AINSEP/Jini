import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { entityNotLiveResponse } from "../../http/entity-not-live.js";

/**
 * @file Shared guards and error mapping for the `email-templates` admin route specs.
 *
 * Each handler is a permission check plus ONE shared operation the host injects (the same call the
 * `email_template_*` assistant tools make, so the two surfaces cannot drift). The operations and their
 * error classes live in a package `@jini-ai/cms` does not depend on, so a route receives them as
 * functions and predicates, bound by the host with its own template store.
 *
 * Permissions are existing names: reading/previewing is `content.read` and writing raw HTML is the host's
 * raw-HTML page permission (a template is raw HTML on Pages storage, injected as `editHtmlPermission`);
 * the send render is `admin.forms.manage`, the mail-status/test-send gate, because its output is what a
 * send path mails.
 *
 * The admin preview HTML keeps the template's scripts. Show it the way the Pages editor shows a Page, in
 * the sandboxed preview iframe WITHOUT `allow-same-origin`, never inline in the admin document.
 */

export const EMAIL_TEMPLATES_BASE = "/api/admin/v1/workspaces/:workspaceId/email-templates";
export const EMAIL_TEMPLATE_READ_PERMISSION = "content.read";
export const EMAIL_TEMPLATE_RENDER_PERMISSION = "admin.forms.manage";

/** The principal fields these routes read: only the id, as the actor of a create or an HTML edit. */
export interface EmailTemplateRoutePrincipal { id: string }

/** The host's recognizers for the operation errors every route of this family maps (`@jini-ai/platform`'s classes). */
export interface EmailTemplateErrorDeps {
  isTemplateNotFound: (required: { err: unknown }) => boolean;
  isTemplateInput: (required: { err: unknown }) => boolean;
  isTemplateVersionConflict: (required: { err: unknown }) => boolean;
  /** Words the 409 refusal for a trashed or tombstoned template; the stored error text never reaches the body from here. */
  outwardErrorMessage: OutwardErrorMessage;
}

/**
 * Asks the host for one permission on the `email_template` entity type, naming no entity id (the
 * hand-written routes named none, even on by-id routes). A host whose own routes never forwarded an
 * entity type drops it in its authorize binding, so a resource-scoped grant cannot start matching.
 * A mount without an authorizer is a wiring bug, not a caller error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeEmailTemplates({ authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("email-templates admin route has no authorizer");
  await authorize({ permission, entityType: "email_template" });
}

/**
 * Maps an operation failure onto its HTTP refusal, mirroring the pages HTML-update codes: a trashed or
 * tombstoned row first (409, its own code), then 404 `ENTRY_NOT_FOUND`, 400 `VALIDATION_ERROR`, 409
 * `CONCURRENT_EDIT`. Anything else is rethrown unchanged so the host answers its redacted 500.
 * @complexity O(1).
 */
export function rejectEmailTemplateError({ err, deps }: { err: unknown; deps: EmailTemplateErrorDeps }, _optional: Record<string, never> = {}): never {
  const live = entityNotLiveResponse({ err, outwardErrorMessage: deps.outwardErrorMessage });
  if (live) rejectRoute({ status: live.status, error: live.body.error, code: live.body.code });
  const error = err instanceof Error ? err.message : String(err);
  if (deps.isTemplateNotFound({ err })) rejectRoute({ status: 404, error, code: "ENTRY_NOT_FOUND" });
  if (deps.isTemplateInput({ err })) rejectRoute({ status: 400, error, code: "VALIDATION_ERROR" });
  if (deps.isTemplateVersionConflict({ err })) rejectRoute({ status: 409, error, code: "CONCURRENT_EDIT" });
  throw err;
}

/** The request body as a record; a missing or non-object body reads as `{}` so validation names the field. @complexity O(1). */
export function emailTemplateBody(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** The `:templateId` path segment, read as the host's own `String(req.params.templateId)` did. @complexity O(1). */
export function emailTemplateIdParam(params: Record<string, string | undefined>): string {
  return String(params.templateId);
}

/** The authenticated principal's id, recorded as the actor of a create or an HTML edit. @complexity O(1). */
export function emailTemplateActorId({ context }: { context: EmailTemplateRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("email-templates admin route has no authenticated principal");
  return context.id;
}
