import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  authorizeEmailTemplates, emailTemplateActorId, emailTemplateBody, EMAIL_TEMPLATES_BASE, rejectEmailTemplateError,
  type EmailTemplateErrorDeps, type EmailTemplateRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. `editHtmlPermission` is the host's raw-HTML page permission; `createTemplate` its create operation bound to its template store. */
export interface EmailTemplateCreateRouteDeps extends EmailTemplateErrorDeps {
  workspaceId: string;
  editHtmlPermission: string;
  createTemplate: (required: { input: Record<string, unknown>; actorId: string }) => Promise<object>;
}

/**
 * `POST …/email-templates` (raw-HTML permission) `{ name, html?, subject?, fields? }` -> 201 detail.
 * No `maxBodyBytes` here: the host keeps its own 413 envelope (`Content too large to save.`), which
 * differs from the kit's, as a body-size binding in front of this route.
 */
export const emailTemplateCreateRoute = defineJsonRoute<{ body: Record<string, unknown> }, object, EmailTemplateCreateRouteDeps, EmailTemplateRoutePrincipal>({
  method: "post",
  path: EMAIL_TEMPLATES_BASE,
  parse: (raw) => ok({ value: { body: emailTemplateBody(raw.body) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const actorId = emailTemplateActorId({ context });
    await authorizeEmailTemplates({ authorize, permission: deps.editHtmlPermission });
    try {
      return ok({ value: await deps.createTemplate({ input: input.body, actorId }) });
    } catch (err) {
      return rejectEmailTemplateError({ err, deps });
    }
  },
}, { successStatus: 201 });
