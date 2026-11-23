import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  authorizeEmailTemplates, emailTemplateBody, emailTemplateIdParam, EMAIL_TEMPLATE_RENDER_PERMISSION, EMAIL_TEMPLATES_BASE, rejectEmailTemplateError,
  type EmailTemplateErrorDeps, type EmailTemplateRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. `renderTemplate` is the host's send-render operation bound to its template store; it also reads the raw `values` field itself. */
export interface EmailTemplateRenderRouteDeps extends EmailTemplateErrorDeps {
  workspaceId: string;
  renderTemplate: (required: { id: string; values: unknown }) => Promise<object>;
}

/**
 * `POST …/email-templates/:templateId/render` (`admin.forms.manage`) `{ values? }` -> `{ subject, html, text,
 * missingFields }`. The host keeps its own 413 envelope as a body-size binding in front of this route (see `create.ts`).
 */
export const emailTemplateRenderRoute = defineJsonRoute<{ templateId: string; body: Record<string, unknown> }, object, EmailTemplateRenderRouteDeps, EmailTemplateRoutePrincipal>({
  method: "post",
  path: `${EMAIL_TEMPLATES_BASE}/:templateId/render`,
  parse: (raw) => ok({ value: { templateId: emailTemplateIdParam(raw.params), body: emailTemplateBody(raw.body) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeEmailTemplates({ authorize, permission: EMAIL_TEMPLATE_RENDER_PERMISSION });
    try {
      return ok({ value: await deps.renderTemplate({ id: input.templateId, values: input.body.values }) });
    } catch (err) {
      return rejectEmailTemplateError({ err, deps });
    }
  },
});
