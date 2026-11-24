import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  authorizeEmailTemplates, emailTemplateBody, emailTemplateIdParam, EMAIL_TEMPLATES_BASE, rejectEmailTemplateError,
  type EmailTemplateErrorDeps, type EmailTemplateRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. `editHtmlPermission` is the host's raw-HTML page permission; `renameTemplate` its rename operation bound to its template store. */
export interface EmailTemplateRenameRouteDeps extends EmailTemplateErrorDeps {
  workspaceId: string;
  editHtmlPermission: string;
  renameTemplate: (required: { input: Record<string, unknown> }) => Promise<object>;
}

/**
 * `PATCH …/email-templates/:templateId` (raw-HTML permission) `{ name, expectedVersion? }` -> detail (rename;
 * trash is the generic `POST …/trash/items {type: "email-template", id}` on the scoped Trash registration).
 * The path's id always wins over any `id` in the body. The host keeps its own 413 envelope as a body-size
 * binding in front of this route (see `create.ts`).
 */
export const emailTemplateRenameRoute = defineJsonRoute<{ templateId: string; body: Record<string, unknown> }, object, EmailTemplateRenameRouteDeps, EmailTemplateRoutePrincipal>({
  method: "patch",
  path: `${EMAIL_TEMPLATES_BASE}/:templateId`,
  parse: (raw) => ok({ value: { templateId: emailTemplateIdParam(raw.params), body: emailTemplateBody(raw.body) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeEmailTemplates({ authorize, permission: deps.editHtmlPermission });
    try {
      return ok({ value: await deps.renameTemplate({ input: { ...input.body, id: input.templateId } }) });
    } catch (err) {
      return rejectEmailTemplateError({ err, deps });
    }
  },
});
