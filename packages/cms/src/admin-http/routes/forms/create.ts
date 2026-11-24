import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { DuplicateCommandError } from "../../../core/index.js";
import type { FieldDescriptor, FormAuthoring, HtmlFormDefinitionRecord as FormDefinitionRecord, NotifyConfig } from "../../../forms/index.js";
import { toAdminFormDefinitionResponse, type AdminFormDefinitionDto } from "../../http/forms.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { idempotencyKeyOf } from "../posts/shared.js";
import { formsActorId, type FormsRoutePrincipal } from "./shared.js";
import { rejectFormsWriteError } from "./write-error.js";

/** This route's writable POST fields. */
export type FormsCreateFields = {
  name: string;
  slug: string;
  fields: FieldDescriptor[];
  notify: NotifyConfig | undefined;
} & FormAuthoring;

/** The parsed POST body plus the `Idempotency-Key` header (empty = absent). */
export interface FormsCreateInput { form: FormsCreateFields; idempotencyKey: string | undefined }

/** The host's audited create write (its permission, reserved slugs, authoring and command gateway are bound by the host). */
export type FormsCreateDefinitionFn = (required: {
  input: FormsCreateFields & { workspaceId: string; actor: { id: string; kind: "user" }; idempotencyKey: string | undefined };
}) => Promise<{ definition: FormDefinitionRecord }>;

/** The deps this route reads. */
export interface FormsCreateRouteDeps {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  createFormDefinition: FormsCreateDefinitionFn;
}

/** This route's four writable POST fields, read off an untyped body in one place.
 *  @complexity O(1). */
function parseFormCreateBody({ rawBody }: { rawBody: unknown }, _optional = {}): FormsCreateFields {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  return {
    name: String(body.name ?? ""),
    slug: String(body.slug ?? ""),
    fields: Array.isArray(body.fields) ? (body.fields as FieldDescriptor[]) : [],
    notify: body.notify as NotifyConfig | undefined,
    ...(body.mode !== undefined ? { mode: body.mode as NonNullable<FormAuthoring["mode"]> } : {}),
    ...(body.html !== undefined ? { html: body.html as string } : {}),
    ...(body.provider !== undefined ? { provider: body.provider as NonNullable<FormAuthoring["provider"]> } : {}),
  };
}

/**
 * POST a new form definition (`FORMS_CREATE_DEFINITION`, REQ-01). Routed through the host's create
 * write, which wraps `executeCommand` (authorizes `admin.forms.manage` internally — mirrors
 * `posts/create.ts`, no separate pre-check needed, so this spec makes no `authorize` call). The
 * host mounts it with `readHeaders: ["idempotency-key"]`.
 */
export const formsCreateRoute = defineJsonRoute<FormsCreateInput, { data: AdminFormDefinitionDto }, FormsCreateRouteDeps, FormsRoutePrincipal>(
  {
    method: "post",
    path: "/api/admin/v1/workspaces/:workspaceId/forms",
    parse: (raw) => ok({ value: { form: parseFormCreateBody({ rawBody: raw.body }), idempotencyKey: idempotencyKeyOf({ headers: raw.headers }) } }),
    handle: async ({ input, deps, context }) => {
      try {
        const actorId = formsActorId({ context });
        const { definition } = await deps.createFormDefinition({
          input: { workspaceId: deps.workspaceId, actor: { id: actorId, kind: "user" }, ...input.form, idempotencyKey: input.idempotencyKey },
        });
        return ok({ value: toAdminFormDefinitionResponse({ definition }) });
      } catch (err) {
        if (err instanceof DuplicateCommandError) throw new RouteRefusalError({ status: 409, body: { error: err.message, code: "DUPLICATE_COMMAND", changeSetId: err.changeSetId } });
        return rejectFormsWriteError({ err, outwardErrorMessage: deps.outwardErrorMessage });
      }
    },
  },
  { successStatus: 201 },
);
