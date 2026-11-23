import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  authorizeEmailTemplates, EMAIL_TEMPLATE_READ_PERMISSION, EMAIL_TEMPLATES_BASE, rejectEmailTemplateError,
  type EmailTemplateErrorDeps, type EmailTemplateRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. `listTemplates` is the host's list operation bound to its template store. */
export interface EmailTemplateListRouteDeps extends EmailTemplateErrorDeps {
  workspaceId: string;
  listTemplates: (required: { input: Record<string, unknown> }) => Promise<object>;
}

/** `GET …/email-templates` (`content.read`) -> `{ templates: EmailTemplateSummary[] }`. */
export const emailTemplateListRoute = defineJsonRoute<{ query: Record<string, unknown> }, object, EmailTemplateListRouteDeps, EmailTemplateRoutePrincipal>({
  method: "get",
  path: EMAIL_TEMPLATES_BASE,
  parse: (raw) => ok({ value: { query: raw.query } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeEmailTemplates({ authorize, permission: EMAIL_TEMPLATE_READ_PERMISSION });
    try {
      return ok({ value: await deps.listTemplates({ input: input.query }) });
    } catch (err) {
      return rejectEmailTemplateError({ err, deps });
    }
  },
});
