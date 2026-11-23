import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  authorizeEmailTemplates, emailTemplateIdParam, EMAIL_TEMPLATE_READ_PERMISSION, EMAIL_TEMPLATES_BASE, rejectEmailTemplateError,
  type EmailTemplateErrorDeps, type EmailTemplateRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. `getTemplate` is the host's get operation bound to its template store. */
export interface EmailTemplateGetRouteDeps extends EmailTemplateErrorDeps {
  workspaceId: string;
  getTemplate: (required: { id: string }) => Promise<object>;
}

/** `GET …/email-templates/:templateId` (`content.read`) -> detail. */
export const emailTemplateGetRoute = defineJsonRoute<{ templateId: string }, object, EmailTemplateGetRouteDeps, EmailTemplateRoutePrincipal>({
  method: "get",
  path: `${EMAIL_TEMPLATES_BASE}/:templateId`,
  parse: (raw) => ok({ value: { templateId: emailTemplateIdParam(raw.params) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeEmailTemplates({ authorize, permission: EMAIL_TEMPLATE_READ_PERMISSION });
    try {
      return ok({ value: await deps.getTemplate({ id: input.templateId }) });
    } catch (err) {
      return rejectEmailTemplateError({ err, deps });
    }
  },
});
