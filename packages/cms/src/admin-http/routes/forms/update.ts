import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute, RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { parseExpectedVersion, RecordVersionConflictError, versionConflictBody } from "@jini-ai/core/optimistic-concurrency";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";

import {
  FormDefinitionNotFoundError,
  type FieldDescriptor,
  type FormAuthoring,
  type FormDefinitionRepoPort,
  type FormDefinitionStatus,
  type HtmlFormDefinitionRecord as FormDefinitionRecord,
  type NotifyConfig,
} from "../../../forms/index.js";
import { toAdminFormDefinitionResponse, type AdminFormDefinitionDto } from "../../http/forms.js";
import { authorizeForms, formsActorId, FORMS_MANAGE, routeParam, type FormsRoutePrincipal } from "./shared.js";
import { rejectFormsWriteError } from "./write-error.js";

const VALID_STATUSES: readonly FormDefinitionStatus[] = ["active", "disabled"];

/** The recognized field-patch keys of the PUT body. */
export type FormsUpdatePatch = { name?: string; fields?: FieldDescriptor[]; notify?: NotifyConfig } & FormAuthoring;

/** Who is writing which form; both host write functions take it. */
export interface FormsUpdateWriteTarget { workspaceId: string; actor: { id: string; kind: "user" }; formId: string }

/** The host's audited field-patch write (its permission, reserved slugs and authoring are bound by the host). */
export type FormsUpdateDefinitionFn = (
  required: { input: FormsUpdateWriteTarget & { patch: FormsUpdatePatch } },
  optional?: { expectedVersion?: number },
) => Promise<{ definition: FormDefinitionRecord }>;

/** The host's audited status write. */
export type FormsSetDefinitionStatusFn = (required: { input: FormsUpdateWriteTarget & { status: FormDefinitionStatus } }) => Promise<{ definition: FormDefinitionRecord }>;

/** The deps this route reads. */
export interface FormsUpdateRouteDeps {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  formDefinitionRepo: Pick<FormDefinitionRepoPort, "findById">;
  updateFormDefinition: FormsUpdateDefinitionFn;
  setFormDefinitionStatus: FormsSetDefinitionStatusFn;
  versionedUpdateMessages: { mixedStatus: string; missingDefinition: string; stale: string };
}

/** The `:formId` param plus the untyped PUT body. */
export interface FormsUpdateInput { formId: string; body: Record<string, unknown> }

/** Picks the recognized field-patch keys out of the PUT body; an empty result means "no field patch". */
function buildFormPatch({ body }: { body: Record<string, unknown> }, _optional = {}): FormsUpdatePatch {
  const patch: FormsUpdatePatch = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (Array.isArray(body.fields)) patch.fields = body.fields as FieldDescriptor[];
  if (body.notify !== undefined) patch.notify = body.notify as NotifyConfig;
  if (body.provider !== undefined) patch.provider = body.provider as FormAuthoring["provider"];
  return patch;
}

/**
 * Applies the PATCH body's field patch and/or status change (each optional, either or both may
 * apply), then falls back to a plain read when neither ran — a request with no recognized fields is
 * a no-op read, not an error, unless the form itself doesn't exist.
 *
 * @throws {FormDefinitionNotFoundError} if neither write ran and the form id doesn't exist either.
 * @complexity O(1) — at most two writes and one read.
 */
async function resolveFormUpdateResult({ deps, target, body, expectedVersion }: { deps: FormsUpdateRouteDeps; target: FormsUpdateWriteTarget; body: Record<string, unknown>; expectedVersion: number | undefined }, _optional = {}): Promise<FormDefinitionRecord> {
  const patch = buildFormPatch({ body });
  let definition: FormDefinitionRecord | undefined;
  if (Object.keys(patch).length > 0) {
    ({ definition } = expectedVersion === undefined
      ? await deps.updateFormDefinition({ input: { ...target, patch } })
      : await deps.updateFormDefinition({ input: { ...target, patch } }, { expectedVersion }));
  }

  if (typeof body.status === "string" && VALID_STATUSES.includes(body.status as FormDefinitionStatus)) {
    ({ definition } = await deps.setFormDefinitionStatus({ input: { ...target, status: body.status as FormDefinitionStatus } }));
  }

  if (definition) {
    return definition;
  }

  const existing = await deps.formDefinitionRepo.findById({ workspaceId: target.workspaceId, id: target.formId });
  if (!existing) {
    throw new FormDefinitionNotFoundError({ message: `form definition '${target.formId}' was not found` });
  }
  return existing;
}

/**
 * PUT (partial) update a form definition, including the `status` toggle (`FORMS_UPDATE_DEFINITION`,
 * REQ-04). `slug` is deliberately ignored if present in the body (behavior.spec.md §1.1 — handled
 * inside `write-service.ts`'s `updateFormDefinition`, which never reads `patch.slug`).
 */
export const formsUpdateRoute = defineJsonRoute<FormsUpdateInput, { data: AdminFormDefinitionDto }, FormsUpdateRouteDeps, FormsRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/forms/:formId",
  parse: (raw) => ok({ value: { formId: routeParam(raw.params, "formId"), body: (raw.body ?? {}) as Record<string, unknown> } }),
  handle: async ({ input, deps, context, authorize }) => {
    const { formId, body } = input;
    const actorId = formsActorId({ context });
    // Empty/ignored bodies fall through to a read without invoking the write service's
    // gateway. Gate that path too, before it can return a definition or disclose its absence.
    await authorizeForms({ authorize, permission: FORMS_MANAGE, entityType: "form_definition" }, { entityId: formId });
    let expectedVersion: number | undefined;
    try {
      expectedVersion = parseExpectedVersion({ value: body.expectedVersion });
      if (expectedVersion !== undefined && Object.prototype.hasOwnProperty.call(body, "status")) {
        rejectRoute({ status: 400, error: deps.versionedUpdateMessages.mixedStatus, code: "VALIDATION_ERROR" });
      }
      if (expectedVersion !== undefined && Object.keys(buildFormPatch({ body })).length === 0) {
        rejectRoute({ status: 400, error: deps.versionedUpdateMessages.missingDefinition, code: "VALIDATION_ERROR" });
      }
      const target = { workspaceId: deps.workspaceId, actor: { id: actorId, kind: "user" as const }, formId };
      const definition = await resolveFormUpdateResult({ deps, target, body, expectedVersion });
      return ok({ value: toAdminFormDefinitionResponse({ definition }) });
    } catch (err) {
      if (err instanceof RecordVersionConflictError && expectedVersion !== undefined) {
        throw new RouteRefusalError({
          status: 409,
          body: { ...versionConflictBody({ error: err }), error: deps.versionedUpdateMessages.stale },
        });
      }
      return rejectFormsWriteError({ err, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
});
