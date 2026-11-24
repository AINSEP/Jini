import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  authorizeEmailTemplates, emailTemplateActorId, emailTemplateBody, emailTemplateIdParam, EMAIL_TEMPLATES_BASE, rejectEmailTemplateError,
  type EmailTemplateErrorDeps, type EmailTemplateRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. `editHtmlPermission` is the host's raw-HTML page permission; `editTemplate` its edit operation bound to its template store. */
export interface EmailTemplateEditHtmlRouteDeps extends EmailTemplateErrorDeps {
  workspaceId: string;
  editHtmlPermission: string;
  editTemplate: (required: { input: Record<string, unknown>; actorId: string }) => Promise<object>;
}

/**
 * `PUT …/email-templates/:templateId/html` (raw-HTML permission) `{ html, expectedVersion? }` -> detail.
 * The path's id always wins over any `id` in the body. The host keeps its own 413 envelope as a
 * body-size binding in front of this route (see `create.ts`).
 */
export const emailTemplateEditHtmlRoute = defineJsonRoute<{ templateId: string; body: Record<string, unknown> }, object, EmailTemplateEditHtmlRouteDeps, EmailTemplateRoutePrincipal>({
  method: "put",
  path: `${EMAIL_TEMPLATES_BASE}/:templateId/html`,
  parse: (raw) => ok({ value: { templateId: emailTemplateIdParam(raw.params), body: emailTemplateBody(raw.body) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const actorId = emailTemplateActorId({ context });
    await authorizeEmailTemplates({ authorize, permission: deps.editHtmlPermission });
    try {
      return ok({ value: await deps.editTemplate({ input: { ...input.body, id: input.templateId }, actorId }) });
    } catch (err) {
      return rejectEmailTemplateError({ err, deps });
    }
  },
});
