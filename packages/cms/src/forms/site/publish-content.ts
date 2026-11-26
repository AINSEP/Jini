import type { executeCommand } from "../../core/index.js";
import { trashedAtDestination } from "@jini-ai/cms/publish/content/precheck-reasons";
import { createRepoPublishHandler, gatewayDeps } from "@jini-ai/cms/publish/content/repo-handler";
import type { PublishContentContributor } from "@jini-ai/cms/publish/content/type-registry";
import type { CmsPublishPorts } from "@jini-ai/cms/publish/content/publish-ports";

import { FormDefinitionNotFoundError, FormFieldValidationError, FormSlugConflictError } from "@jini-ai/cms/forms";
import type { FieldDescriptor, FormDefinitionStatus } from "@jini-ai/cms/forms";
import type { createFormDefinition, setFormDefinitionStatus, updateFormDefinition, FormWriteServiceDeps, NotifyConfig } from '../index.js';
import type { OutboxPort } from '@jini-ai/core/contracts/events';
import type { HtmlFormDefinitionRecord, FormAuthoring } from "@jini-ai/cms/forms";

/** The slice of the host's publish bag this file reads. The host registry (`features/publish-content/type-registry.ts`) is
 *  instantiated with the full product bag, which satisfies this slice, so this file names no other feature. */
type FormBag = Pick<CmsPublishPorts, "form">;
/**
 * @file `form` on the publish factory (`features/publish-content/repo-handler.ts`). Carries the form's
 * structure only — submissions are visitor data and never travel (plan §1).
 *
 * Addressed by `slug`, not the row id: the site looks a form up by slug and the id is minted per
 * instance by `createFormDefinition`. The repo hides trashed rows, so a slug held only by a trashed
 * form is found through `isSlugTaken` and refused rather than planned as a create that would collide.
 */

/** Copy form structure through the existing publish factory; recipients remain site-local.
 * @complexity O(schema bytes) time/space per form; existing repo/command I/O only.
 * @overallScore 98 — Minor: the factory's typed state is trusted until existing command validation. */

export const contributeFormPublish = (required: {
  tableKey: string; permission: string; executeCommand: typeof executeCommand;
  createFormDefinition(input: { deps: Omit<FormWriteServiceDeps, 'permission' | 'reservedSlugs'> & { outbox?: OutboxPort }; input: Parameters<typeof createFormDefinition>[0]['input'] & { notify?: NotifyConfig } }): ReturnType<typeof createFormDefinition>;
  updateFormDefinition(input: { deps: Omit<FormWriteServiceDeps, 'permission' | 'reservedSlugs'> & { outbox?: OutboxPort }; input: Parameters<typeof updateFormDefinition>[0]['input'] }): ReturnType<typeof updateFormDefinition>;
  setFormDefinitionStatus(input: { deps: Omit<FormWriteServiceDeps, 'permission' | 'reservedSlugs'> & { outbox?: OutboxPort }; input: Parameters<typeof setFormDefinitionStatus>[0]['input'] }): ReturnType<typeof setFormDefinitionStatus>;
}, _optional = {}): PublishContentContributor<FormBag> => {
  const { executeCommand, createFormDefinition, updateFormDefinition, setFormDefinitionStatus } = required;
  return createRepoPublishHandler<HtmlFormDefinitionRecord, FormBag["form"], FormBag>({
    entityType: "form",
    coversTables: [required.tableKey],
    permission: required.permission,
    ports: ({ deps }, _optional = {}) => deps.ports.form,
    list: async ({ ports: p, workspaceId }) => (await p.repo.list({ workspaceId })).map(publishableForm),
    find: async ({ ports: p, workspaceId, id: slug }) => {
      const row = await p.repo.findBySlug({ workspaceId, slug });
      return row ? publishableForm(row) : null;
    },
    idOf: ({ row }, _optional = {}) => row.slug,
    fields: {
      name: "transferred",
      slug: "transferred",
      fields: "transferred",
      status: "transferred",
      notify: "local",
      mode: "transferred",
      html: "transferred",
      provider: "transferred",
      id: "local",
      workspaceId: "local",
      createdAt: "local",
      updatedAt: "local",
      version: "local",
    },
    validate: async ({ ports, workspaceId, entity, existing }) =>
      !existing && (await ports.repo.isSlugTaken({ workspaceId, slug: entity.id })) ? trashedAtDestination({ entityType: "form", id: entity.id }) : null,
    write: async ({ ports, deps, workspaceId, id, state, existing, principalId }) => {
      const writeDeps = { ...gatewayDeps({ deps, entityType: "form" }), repo: ports.repo, executeCommand };
      const actor = { id: principalId, kind: "user" as const };
      const name = state.name as string;
      const fields = state.fields as FieldDescriptor[];
      const authoring = { ...(state.mode ? { mode: state.mode as NonNullable<FormAuthoring["mode"]> } : {}),
        ...(state.mode === "html" && typeof state.html === "string" ? { html: state.html } : {}),
        ...(state.provider ? { provider: state.provider as NonNullable<FormAuthoring["provider"]> } : {}) };
      // Recipients stay local even when an older bundle includes a notify value.
      const notify = existing?.notify;
      const { definition } = existing
        ? await updateFormDefinition({ deps: writeDeps, input: { workspaceId, actor, formId: existing.id, patch: { name, fields, ...(notify === undefined ? {} : { notify }), ...authoring } } })
        : await createFormDefinition({ deps: writeDeps, input: { workspaceId, actor, name, slug: id, fields, ...(notify === undefined ? {} : { notify }), ...authoring } });
      const status = state.status as FormDefinitionStatus;
      if (definition.status !== status) {
        await setFormDefinitionStatus({ deps: writeDeps, input: { workspaceId, actor, formId: definition.id, status } });
      }
    },
    errors: { blocked: [FormFieldValidationError, FormSlugConflictError], conflict: [FormDefinitionNotFoundError] },
  });
};


/** Canonical defaults make legacy Builder/built-in definitions replace an external destination,
 * rather than accidentally preserving its previous mode/provider through an omitted patch.
 * @complexity O(1) time/space; no I/O. @overallScore 100 */
function publishableForm(row: HtmlFormDefinitionRecord): HtmlFormDefinitionRecord {
  return { ...row, mode: row.mode ?? "builder", html: row.html ?? "", provider: row.provider ?? { id: "builtin", config: {} } };
}
