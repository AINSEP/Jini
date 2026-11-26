import { adaptLegacyAuthorize } from "@jini-ai/core";
import { ToolInputError } from "@jini-ai/core";

import { PublishContentApplyRowError } from "../../publish/transfer/apply-errors.js";
import { tombstonedAtDestination } from "@jini-ai/cms/publish/content/precheck-reasons";
import type { createRepoPublishHandler, gatewayDeps, okOrThrow } from "@jini-ai/cms/publish/content/repo-handler";
import type { PublishContentContributor } from "@jini-ai/cms/publish/content/type-registry";
import type { CmsPublishPorts } from "@jini-ai/cms/publish/content/publish-ports";

import {
  ContentTypeNotFoundError,
  deprecateContentType,
  reactivateContentType,
  toContentTypeOutbox,
  updateContentTypeFields,
  VersionConflictError,
  type ContentTypeFieldDef,
  type ContentTypeRecord,
  type ContentTypeStatus,
} from "@jini-ai/cms/content-types";
import type { registerContentType } from "../index.js";

/** The slice of the host's publish bag this file reads. The host registry (`features/publish-content/type-registry.ts`) is
 *  instantiated with the full product bag, which satisfies this slice, so this file names no other feature. */
type ContentTypeBag = Pick<CmsPublishPorts, "content-type">;

/**
 * @file `content-type` (a collection's schema) on the publish factory. Addressed by its `key`.
 *
 * `widget` and `widget_area` are seeded per instance, so they never travel. A tombstoned type does
 * not pack, and a tombstoned destination type refuses: tombstone is terminal (INV-06).
 */
export const contributeContentTypePublish = (required: {
  createRepoPublishHandler: typeof createRepoPublishHandler; gatewayDeps: typeof gatewayDeps; okOrThrow: typeof okOrThrow;
  seededKeys: ReadonlySet<string>; seededKeyRefusal(input: { key: string }): string | null;
  permission: string; registerContentType: typeof registerContentType;
}, _optional = {}): PublishContentContributor<ContentTypeBag> => {
  const { seededKeys: SEEDED_KEYS, seededKeyRefusal, permission, registerContentType } = required;
  return required.createRepoPublishHandler<ContentTypeRecord, ContentTypeBag["content-type"], ContentTypeBag>({
    entityType: "content-type",
    coversTables: ["content_types"],
    permission,
    ports: ({ deps }, _optional = {}) => deps.ports["content-type"],
    list: ({ ports: p, workspaceId }, _optional = {}) => p.repo.listByWorkspace({ workspaceId }),
    find: ({ ports: p, workspaceId, id: key }, _optional = {}) => p.repo.findByKey({ workspaceId, key }),
    idOf: ({ row }, _optional = {}) => row.key,
    include: ({ row }, _optional = {}) => row.status !== "tombstone" && !SEEDED_KEYS.has(row.key),
    fields: {
      key: "transferred",
      label: "transferred",
      fields: "transferred",
      status: "transferred",
      workspaceId: "local",
      version: "local",
      tombstonedAt: "local",
      // Only the seeded widget types carry an owner, and they never travel (SEEDED_KEYS); each
      // instance restores it from `declared-owners.ts`.
      owner: "local",
    },
    validate: async ({ entity, existing }) =>
      seededKeyRefusal({ key: entity.id }) ?? (existing?.status === "tombstone" ? tombstonedAtDestination({ entityType: "content-type", id: entity.id }) : null),
    write: async ({ ports, deps, workspaceId, id: key, state, existing, principalId: actorId }) => {
      const seeded = seededKeyRefusal({ key });
      if (seeded) throw new PublishContentApplyRowError({ rowOutcome: "blocked", message: seeded });
      const gateway = required.gatewayDeps({ deps, entityType: "content-type" });
      const outbox = toContentTypeOutbox({ outbox: gateway.outbox, clock: deps.clock, idGen: deps.idGen, workspaceId });
      // Preserve Jini's content-type scope along with the gateway's publish-type stamp.
      const writeDeps = { repo: ports.repo, clock: deps.clock, ids: deps.idGen, authorize: adaptLegacyAuthorize({ authorize: gateway.authorize }), indexProvisioner: ports.indexProvisioner, outbox };
      const label = state.label as string;
      const fields = state.fields as ContentTypeFieldDef[];
      let current = existing
        ? existing
        : required.okOrThrow({ result: await registerContentType({ deps: writeDeps, input: { workspaceId, actorId, key, label, fields } }) }).contentType;
      if (existing && (existing.label !== label || JSON.stringify(existing.fields) !== JSON.stringify(fields))) {
        const input = { workspaceId, actorId, key, label, fields, expectedVersion: existing.version };
        current = required.okOrThrow({ result: await updateContentTypeFields({ deps: writeDeps, input }) }).contentType;
      }
      const status = state.status as ContentTypeStatus;
      if (current.status !== status) {
        const input = { workspaceId, actorId, key, expectedVersion: current.version };
        const transition = status === "deprecated" ? deprecateContentType : reactivateContentType;
        current = required.okOrThrow({ result: await transition({ deps: writeDeps, input }) }).contentType;
      }
      return { version: current.version };
    },
    errors: { conflict: [VersionConflictError, ContentTypeNotFoundError], blocked: [ToolInputError] },
  });
};
