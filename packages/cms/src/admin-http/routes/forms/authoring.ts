import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { parseExpectedVersion } from "@jini-ai/core/optimistic-concurrency";

import type { FieldDescriptor, FormAuthoring, HtmlFormDefinitionRecord as FormDefinitionRecord, NotifyConfig } from "../../../forms/index.js";
import { toAdminFormDefinitionResponse, type AdminFormDefinitionDto } from "../../http/forms.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { idempotencyKeyOf } from "../posts/shared.js";
import { authorizeForms, formsActorId, FORMS_MANAGE, routeParam, type FormsRoutePrincipal } from "./shared.js";
import type { FormsUpdatePatch, FormsUpdateWriteTarget } from "./update.js";
import { rejectFormsWriteError } from "./write-error.js";

/** The host's audited authoring write (its permission, reserved slugs and authoring are bound by the host). */
export type FormsAuthoringDefinitionFn = (
  required: { input: FormsUpdateWriteTarget & { idempotencyKey: string | undefined; patch: FormsUpdatePatch } },
  optional: { expectedVersion?: number },
) => Promise<{ definition: FormDefinitionRecord }>;

/** The deps this route reads. */
export interface FormsAuthoringRouteDeps {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  updateFormDefinition: FormsAuthoringDefinitionFn;
}

/** The `:formId` param, the untyped PUT body and the `Idempotency-Key` header (empty = absent). */
export interface FormsAuthoringInput { formId: string; body: Record<string, unknown>; idempotencyKey: string | undefined }

/** The authoring keys of the PUT body that are present; anything else is ignored. @complexity O(1). */
function authoringPatch({ body }: { body: Record<string, unknown> }, _options = {}): FormsUpdatePatch {
  return {
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    ...(Array.isArray(body.fields) ? { fields: body.fields as FieldDescriptor[] } : {}),
    ...(body.notify !== undefined ? { notify: body.notify as NotifyConfig } : {}),
    ...(body.mode !== undefined ? { mode: body.mode as NonNullable<FormAuthoring["mode"]> } : {}),
    ...(body.html !== undefined ? { html: body.html as string } : {}),
    ...(body.provider !== undefined ? { provider: body.provider as NonNullable<FormAuthoring["provider"]> } : {}),
  };
}

/**
 * PUT the authoring fields of a form. A separate endpoint avoids changing the shared-tree CRUD
 * route. Both permissions and the audit boundary live in the write service, covering route and
 * future tool callers alike. The host mounts it with `readHeaders: ["idempotency-key"]`.
 */
export const formsAuthoringRoute = defineJsonRoute<FormsAuthoringInput, { data: AdminFormDefinitionDto }, FormsAuthoringRouteDeps, FormsRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/forms/:formId/authoring",
  parse: (raw) => ok({ value: { formId: routeParam(raw.params, "formId"), body: (raw.body ?? {}) as Record<string, unknown>, idempotencyKey: idempotencyKeyOf({ headers: raw.headers }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const { formId, body, idempotencyKey } = input;
    try {
      const actorId = formsActorId({ context });
      // Same gate as `update.ts` (f07a92dcb): an empty/ignored body never reaches the write
      // service's gateway, and the write service's own pre-read must not disclose a form's
      // existence to a caller the matching GET denies.
      await authorizeForms({ authorize, permission: FORMS_MANAGE, entityType: "form_definition" }, { entityId: formId });
      const expectedVersion = parseExpectedVersion({ value: body.expectedVersion });
      const { definition } = await deps.updateFormDefinition(
        { input: { workspaceId: deps.workspaceId, formId, actor: { id: actorId, kind: "user" }, idempotencyKey, patch: authoringPatch({ body }) } },
        expectedVersion === undefined ? {} : { expectedVersion },
      );
      return ok({ value: toAdminFormDefinitionResponse({ definition }) });
    } catch (err) {
      return rejectFormsWriteError({ err, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
});
