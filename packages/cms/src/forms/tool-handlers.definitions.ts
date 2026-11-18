import {
  AGENT_TOOL_PRINCIPAL_KIND,
  indexCatalogById,
  requireInputRecord,
  requireString,
  withSchemaOnRejection,
  type ToolHandler,
} from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/tools/args.js";
import type { FormProviderSelection } from "@jini-ai/core/contracts/forms";
import { requireExpectedVersion } from "@jini-ai/core/optimistic-concurrency";
import { FormFieldValidationError } from "./errors.js";
import { createFormCollectionRegistry, describeFormCollectionProviders } from "../core/form-collection.js";
import type { FieldDescriptor, FormDefinitionRecord, FormDefinitionStatus, NotifyConfig } from "./types.js";
import type { FormAuthoring } from "./fields-json.js";
import { formsAgentToolCatalog } from "./agent-tools.js";
import type { FormsHandlerArgs, FormsPackageToolDeps } from "./tool-handlers.types.js";

export const CATALOG_BY_ID = indexCatalogById({ catalog: formsAgentToolCatalog });

/**
 * The only Forms rejection worth decorating with the published schema.
 *
 * A `ForbiddenError` or `FormSlugConflictError` is not a shape problem, and appending a schema to
 * those would be noise the model must read past — worse, it would imply the call is retryable.
 */
function isFormsShapeRejection({ error }: { error: unknown }): boolean {
  return error instanceof FormFieldValidationError;
}

/** What a Forms tool returns to the model — see {@link toFormDefinitionView}. */
interface FormDefinitionToolView extends FormAuthoring {
  id: string;
  name: string;
  slug: string;
  status: FormDefinitionStatus;
  version: number;
  fields: FieldDescriptor[];
  notify: NotifyConfig;
}

/**
 * Projects a `FormDefinitionRecord` into an explicit model-facing shape rather than returning the
 * domain record verbatim — the same discipline content-types' `toContentTypeView` applies.
 *
 * `workspaceId` is dropped (the agent is already scoped to one workspace it cannot change, so the
 * id can never inform a decision) along with `createdAt`/`updatedAt` (timestamps no follow-up call
 * consumes). `id` is deliberately KEPT: every mutating Forms tool takes `formId`, so the model
 * needs it to make a correct follow-up call without re-reading. `slug` is kept because it is
 * immutable and is what a human will recognize the form by.
 *
 * @param record - The definition as the domain returned it.
 * @returns The model-facing view, with `fields`/`notify.recipients` copied so a tool caller cannot
 * mutate domain state through the returned object.
 * @complexity O(f) in the field count.
 * @overallScore 100
 */
export function toFormDefinitionView(record: FormDefinitionRecord): FormDefinitionToolView {
  const authoring = record as FormDefinitionRecord & FormAuthoring;
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    status: record.status,
    version: record.version,
    fields: record.fields.map((field) => ({ ...field })),
    notify: { enabled: record.notify.enabled, recipients: [...record.notify.recipients] },
    ...(authoring.mode === undefined ? {} : { mode: authoring.mode }),
    ...(authoring.html === undefined ? {} : { html: authoring.html }),
    ...(authoring.provider ? { provider: authoring.provider } : {}),
  };
}

/** Binds host persistence and the audited command gateway for the Forms policy adapter. */
export function formsDeps(routeDeps: FormsPackageToolDeps) {
  return {
    ...(routeDeps.formCollectionProviders ? { formCollectionProviders: routeDeps.formCollectionProviders } : {}),
    executeCommand: routeDeps.executeCommand,
    repo: routeDeps.formDefinitionRepo,
    clock: routeDeps.clock,
    idGen: routeDeps.idGen,
    changeSets: routeDeps.changeSets,
    outbox: routeDeps.outbox,
    authorize: routeDeps.authorize,
  };
}

/**
 * `forms_set_definition_status` is wrapped in `withSchemaOnRejection`/`isFormsShapeRejection`, and
 * that predicate only recognizes `FormFieldValidationError` — a bare `Error` thrown here would never
 * match it and would reach `@jini-ai/daemon`'s `ToolExecutor` as `errorKind: 'internal'`, redacted to
 * a message-stripped 500 by `@jini-ai/http-kit`'s `delegatedToolExecuteRoute` (SEC-005). Throwing the
 * SAME domain error class the predicate already recognizes (rather than broadening the predicate to
 * also accept a generic `ToolInputError`) is the convention every sibling domain's own
 * `isShapeRejection` follows — `theme`/`sites`/`site-inspection`'s predicates each stay a fixed,
 * narrow allowlist of domain-specific classes, and a new ad-hoc check adopts one of those (existing
 * or freshly declared) rather than widening the allowlist to a generic marker.
 */
function requireFormsStatus(input: Record<string, unknown>): FormDefinitionStatus {
  const value = input.status;
  if (value !== "active" && value !== "disabled") {
    throw new FormFieldValidationError({ message: "'status' must be exactly 'active' or 'disabled'", fieldErrors: [] });
  }
  return value;
}

/**
 * Reads the optional patch members of `forms_update_definition`.
 *
 * An empty patch is refused rather than accepted as a no-op. `updateFormDefinition` would happily
 * re-save the unchanged record, and the tool would report success for a call that changed nothing —
 * which teaches the model its call worked. The human PUT route can tolerate that; a tool must not.
 *
 * `forms_update_definition` is wrapped in `withSchemaOnRejection`/`isFormsShapeRejection` the same
 * way `forms_set_definition_status` is — see {@link requireFormsStatus}'s doc for why this throws
 * `FormFieldValidationError` rather than a bare `Error` or a generic `ToolInputError`.
 *
 * @complexity O(1).
 * @overallScore 100
 */
function requireFormsPatch(input: Record<string, unknown>): { name?: string; fields?: FieldDescriptor[]; notify?: NotifyConfig } & FormAuthoring {
  const patch: { name?: string; fields?: FieldDescriptor[]; notify?: NotifyConfig } & FormAuthoring = {};
  if (typeof input.name === "string") patch.name = input.name;
  if (Array.isArray(input.fields)) patch.fields = input.fields as FieldDescriptor[];
  if (input.notify !== undefined) patch.notify = input.notify as NotifyConfig;
  if (input.provider !== undefined) patch.provider = input.provider as FormProviderSelection;
  if (Object.keys(patch).length === 0) {
    throw new FormFieldValidationError({ message: "at least one of 'name', 'fields', or 'notify' is required — 'slug' is immutable and is never updated", fieldErrors: [] });
  }
  return patch;
}

export const formsListProvidersHandler = ({ deps }: FormsHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
    await requireToolPermission({
      authorize: adaptLegacyAuthorize({ authorize: deps.authorize }),
      workspaceId: deps.workspaceId,
      principalId: ctx.principal.id,
      permission: "admin.forms.manage",
    }, { entityType: "form_definition" });
    return { providers: describeFormCollectionProviders({ providers: deps.formCollectionProviders?.() ?? createFormCollectionRegistry({}) }) };
};

export const formsListDefinitionsHandler = ({ deps }: FormsHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
    await requireToolPermission({
      authorize: adaptLegacyAuthorize({ authorize: deps.authorize }),
      workspaceId: deps.workspaceId,
      principalId: ctx.principal.id,
      permission: "admin.forms.manage",
    }, { entityType: "form_definition" });
    const definitions = await deps.formDefinitionRepo.list({ workspaceId: deps.workspaceId });
    return { definitions: definitions.map(record => {
      const view = toFormDefinitionView(record);
      // Collection discovery stays compact; single-definition writes retain their full HTML.
      delete view.html;
      return view;
    }) };
};

export const formsCreateDefinitionHandler = ({ deps }: FormsHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
    const input = requireInputRecord({ input: ctx.input });
    return withSchemaOnRejection({
      toolId: "forms_create_definition",
      catalog: CATALOG_BY_ID,
      isShapeRejection: isFormsShapeRejection,
      fn: async () => {
        const { definition } = await deps.formWrites.create({
          deps: formsDeps(deps),
          input: {
            workspaceId: deps.workspaceId,
            actor: { id: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
            name: requireString({ input, key: "name" }),
            slug: requireString({ input, key: "slug" }),
            fields: Array.isArray(input.fields) ? (input.fields as FieldDescriptor[]) : [],
            notify: input.notify as NotifyConfig | undefined,
            ...(input.provider !== undefined ? { provider: input.provider as FormProviderSelection } : {}),
          },
        });
        return { definition: toFormDefinitionView(definition) };
      },
    });
};

export const formsUpdateDefinitionHandler = ({ deps }: FormsHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
    const input = requireInputRecord({ input: ctx.input });
    return withSchemaOnRejection({
      toolId: "forms_update_definition",
      catalog: CATALOG_BY_ID,
      isShapeRejection: isFormsShapeRejection,
      fn: async () => {
        const expectedVersion = requireExpectedVersion({ value: input.expectedVersion, readToolId: "content_read.form_definition" });
        const { definition } = await deps.formWrites.update({
          deps: formsDeps(deps),
          input: {
            workspaceId: deps.workspaceId,
            actor: { id: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
            formId: requireString({ input, key: "formId" }),
            patch: requireFormsPatch(input),
          },
        }, { expectedVersion });
        return { definition: toFormDefinitionView(definition) };
      },
    });
};

export const formsSetDefinitionStatusHandler = ({ deps }: FormsHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
    const input = requireInputRecord({ input: ctx.input });
    return withSchemaOnRejection({
      toolId: "forms_set_definition_status",
      catalog: CATALOG_BY_ID,
      isShapeRejection: isFormsShapeRejection,
      fn: async () => {
        const { definition } = await deps.formWrites.setStatus({
          deps: formsDeps(deps),
          input: {
            workspaceId: deps.workspaceId,
            actor: { id: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
            formId: requireString({ input, key: "formId" }),
            status: requireFormsStatus(input),
          },
        });
        return { definition: toFormDefinitionView(definition) };
      },
    });
};
