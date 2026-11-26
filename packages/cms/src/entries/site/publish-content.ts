import { adaptLegacyAuthorize } from "@jini-ai/cms/core";

import { PublishContentApplyRowError } from "@jini-ai/cms/publish/transfer";
import { collectBodyReferences } from "@jini-ai/cms/publish/content/content-references";
import { tombstonedAtDestination } from "@jini-ai/cms/publish/content/precheck-reasons";
import { applyRunActor, createRepoPublishHandler, gatewayDeps, okOrThrow } from "@jini-ai/cms/publish/content/repo-handler";
import type { PublishContentContributor } from "@jini-ai/cms/publish/content/type-registry";
import type { CmsPublishPorts } from "@jini-ai/cms/publish/content/publish-ports";
import type { EntryPublishPorts } from "@jini-ai/cms/entries/publish-ports";
import { prepareTermSync, readTermIds, TERM_SYNC_PERMISSION } from "@jini-ai/cms/taxonomy/site/publish-term-ids";
import { ContentRecordNotFoundError, TaxonomyNotApplicableError, TermRecordNotFoundError } from "@jini-ai/cms/taxonomy";

import {
  ContentTypeNotActiveError,
  ContentTypeNotFoundError,
  EntryFieldValidationError,
  EntrySlugConflictError,
  ForbiddenError,
  importEntry,
  toEntryOutbox,
  VersionConflictError,
  type EntryStatus,
} from "@jini-ai/cms/entries";
import type { TrashableEntryRecord } from "@jini-ai/cms/entries";

/** The slice of the host's publish bag this file reads. The host registry (`features/publish-content/type-registry.ts`) is
 *  instantiated with the full product bag, which satisfies this slice, so this file names no other feature. */
type EntryBag = Pick<CmsPublishPorts, "collection-entry">;

/**
 * @file `collection-entry` on the publish factory: every entry except widgets and widget areas
 * (their own types). Keeps the source's id (Jini's `importEntry`), addressed by `(type, slug)`.
 *
 * `fieldsJson` travels whole: Tovu only ever writes the `ext.site` namespace, so there is nothing
 * else in it to leave behind. Term assignments (categories/tags) travel as `termIds`
 * (`@jini-ai/cms/taxonomy/site/publish-term-ids`); the publish ports' `contentTypeTaxonomyPolicy` admits them for
 * any live collection.
 */

/** Why a `collection-entry` entity naming a widget type is refused, or `null`. `list` never packs
 *  those types; this refuses them inbound too, since `widget`/`widget-area` write them under their
 *  own permissions and a grant limited to `collection-entry` must not reach them. */
function widgetTypeRefusal({ id, state, excludedTypes }: { id: string; state: Record<string, unknown>; excludedTypes: readonly string[] }, _options = {}): string | null {
  return excludedTypes.includes(state.type as string)
    ? `collection-entry '${id}' has type '${String(state.type)}', which is a widget type and publishes on its own, not as a collection entry`
    : null;
}

/** An entry row plus its sorted term ids (`undefined` when it has none). */
type EntryRow = TrashableEntryRecord & { termIds?: string[] };

const withTerms = async (p: EntryPublishPorts, row: TrashableEntryRecord): Promise<EntryRow> => {
  const termIds = await readTermIds({ ports: p.terms, contentType: row.type, contentId: row.id });
  return { ...row, ...(termIds !== undefined && { termIds }) };
};

type EntryWriteInput = { ports: EntryPublishPorts; deps: Parameters<typeof gatewayDeps>[0]["deps"]; workspaceId: string; id: string; state: Record<string, unknown>; expectedVersion: number | undefined; principalId: string; excludedTypes: readonly string[] };

/** Checks the widget guard, term permissions and term sync first, then imports the entry and applies terms. */
async function writeCollectionEntry({ ports, deps, workspaceId, id, state, expectedVersion, principalId, excludedTypes }: EntryWriteInput) {
  const widgetType = widgetTypeRefusal({ id, state, excludedTypes });
  if (widgetType) throw new PublishContentApplyRowError({ rowOutcome: "blocked", message: widgetType });
  const gateway = gatewayDeps({ deps, entityType: "collection-entry" });
  // Checked before the entry is written, so a missing term or permission blocks the row whole.
  const terms = await prepareTermSync({
    ports: ports.terms,
    deps,
    entityType: "collection-entry",
    entityId: id,
    principalId,
    contentType: state.type as string,
    wanted: state.termIds,
  });
  const saved = okOrThrow(
    {
      result: await importEntry({
        deps: {
          entryRepo: ports.entries,
          contentTypeRepo: ports.contentTypes,
          clock: deps.clock,
          // Preserve Jini's entry scope along with the gateway's publish-type stamp.
          authorize: adaptLegacyAuthorize({ authorize: gateway.authorize }),
          outbox: toEntryOutbox({ outbox: gateway.outbox, clock: deps.clock, idGen: deps.idGen, workspaceId }),
        },
        input: {
          actorId: principalId,
          // The import origin's actor, merged in by the apply port — never a guessed kind (FIX 19 / H2).
          actor: applyRunActor({ deps, principalId }),
          workspaceId,
          id,
          type: state.type as string,
          slug: state.slug as string,
          title: state.title as string,
          status: state.status as EntryStatus,
          fieldsJson: state.fieldsJson,
          bodyJson: state.bodyJson,
          publishedAt: (state.publishedAt ?? null) as string | null,
          expectedVersion,
        },
      })
    }
  );
  await terms.apply();
  return { version: saved.entry.version };
}

/** A tombstoned collection at the destination refuses the entry; widget types are refused outright. */
async function validateCollectionEntry({ ports, workspaceId, entity, excludedTypes }: { ports: EntryPublishPorts; workspaceId: string; entity: { id: string; state: Record<string, unknown> }; excludedTypes: readonly string[] }) {
  const widgetType = widgetTypeRefusal({ id: entity.id, state: entity.state, excludedTypes });
  if (widgetType) return widgetType;
  const owner = await ports.contentTypes.findByKey({ workspaceId, key: entity.state.type as string });
  return owner?.status === "tombstone" ? tombstonedAtDestination({ entityType: "content-type", id: owner.key }) : null;
}

const ENTRY_FIELD_POLICY = {
    type: "transferred",
    slug: "transferred",
    title: "transferred",
    status: "transferred",
    bodyJson: "transferred",
    fieldsJson: "transferred",
    termIds: "transferred",
    publishedAt: "provenance",
    createdAt: "provenance",
    id: "local",
    workspaceId: "local",
    updatedAt: "local",
    version: "local",
    deletedAt: "local",
} as const;

const ENTRY_PUBLISH_ERRORS = {
    conflict: [VersionConflictError],
    blocked: [
      ForbiddenError,
      ContentTypeNotFoundError,
      ContentTypeNotActiveError,
      EntryFieldValidationError,
      EntrySlugConflictError,
      // Term sync, when the destination changed between its pre-check and the assignment.
      TermRecordNotFoundError,
      ContentRecordNotFoundError,
      TaxonomyNotApplicableError,
    ],
};

export const contributeCollectionEntryPublish = ({ excludedTypes }: { excludedTypes: readonly string[] }, _optional: Record<string, never> = {}): PublishContentContributor<EntryBag> =>
  createRepoPublishHandler<EntryRow, EntryPublishPorts, EntryBag>({
    entityType: "collection-entry",
    coversTables: ["entries", "entry_refs"],
    // 2 = the state may carry `termIds`. Exact-match, so an instance built before this refuses.
    schemaVersion: 2,
    permission: "admin.collections.manage",
    // Carried `termIds` sync through the taxonomy chokepoint.
    alsoAuthorizes: [TERM_SYNC_PERMISSION],
    // The owning type and assigned terms are checked at write time; media and relation ids resolve at render.
    dependsOn: ["content-type", "term"],
    ports: ({ deps }, _optional = {}) => deps.ports["collection-entry"],
    list: async ({ ports: p, workspaceId }) => {
      const rows = await p.entries.listByWorkspaceExcludingTypes({ workspaceId, excludeTypes: excludedTypes });
      return Promise.all(rows.map((row) => withTerms(p, { ...row, deletedAt: null })));
    },
    find: async ({ ports: p, workspaceId, id }) => {
      const row = await p.entries.findAnyById({ workspaceId, id });
      return row ? withTerms(p, row) : null;
    },
    isTrashed: ({ row }) => row.deletedAt !== null,
    fields: ENTRY_FIELD_POLICY,
    omitWhenAbsent: ["termIds"],
    address: {
      field: "slug",
      // Trash included: a trashed row keeps its slug (`entries_workspace_type_slug_unique`).
      holder: ({ ports: p, workspaceId, value: slug, state }) => p.entries.findAnyBySlug({ workspaceId, type: state.type as string, slug }),
    },
    // A tombstone is terminal, so nothing in the bundle can fix it. A missing type is left to apply:
    // the same bundle may carry it.
    // Its collection, plus whatever its body embeds and its categories/tags.
    references: ({ entity }) => [{ entityType: "content-type", key: String(entity.state.type) }, ...collectBodyReferences({ state: entity.state })],
    validate: (required) => validateCollectionEntry({ ...required, excludedTypes }),
    write: (required) => writeCollectionEntry({ ...required, excludedTypes }),
    errors: ENTRY_PUBLISH_ERRORS,
  });
