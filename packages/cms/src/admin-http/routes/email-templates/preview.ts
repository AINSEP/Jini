import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  authorizeEmailTemplates, emailTemplateBody, EMAIL_TEMPLATE_READ_PERMISSION, EMAIL_TEMPLATES_BASE, rejectEmailTemplateError,
  type EmailTemplateErrorDeps, type EmailTemplateRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. `previewTemplate` is the host's preview operation bound to its template store. */
export interface EmailTemplatePreviewRouteDeps extends EmailTemplateErrorDeps {
  workspaceId: string;
  previewTemplate: (required: { input: Record<string, unknown> }) => Promise<object>;
}

/**
 * `POST …/email-templates/preview` (`content.read`) `{ id? | html?, values?, mode? }` -> preview. Declared
 * before the `/:templateId` routes only for readability: methods and segment counts already differ.
 * The host keeps its own 413 envelope as a body-size binding in front of this route (see `create.ts`).
 */
export const emailTemplatePreviewRoute = defineJsonRoute<{ body: Record<string, unknown> }, object, EmailTemplatePreviewRouteDeps, EmailTemplateRoutePrincipal>({
  method: "post",
  path: `${EMAIL_TEMPLATES_BASE}/preview`,
  parse: (raw) => ok({ value: { body: emailTemplateBody(raw.body) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeEmailTemplates({ authorize, permission: EMAIL_TEMPLATE_READ_PERMISSION });
    try {
      return ok({ value: await deps.previewTemplate({ input: input.body }) });
    } catch (err) {
      return rejectEmailTemplateError({ err, deps });
    }
  },
});
