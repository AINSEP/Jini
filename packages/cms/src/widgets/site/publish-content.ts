import type { WidgetHostPorts } from "../host-ports.js";
import { collectPlacementReferences } from "@jini-ai/cms/publish/content/content-references";
import { collectMediaConfigKeys, collectMediaUrlKeys } from "@jini-ai/cms/publish/content/media-references";
import { applyRunActor, createRepoPublishHandler, gatewayDeps, type RepoWriteContext } from "@jini-ai/cms/publish/content/repo-handler";
import type { PublishContentContributor } from "@jini-ai/cms/publish/content/type-registry";
import type { CmsPublishPorts } from "@jini-ai/cms/publish/content/publish-ports";
import type { PublishContentReference } from "@jini-ai/cms/publish/content/type-registry";
import type { WidgetPublishPorts } from "@jini-ai/cms/widgets/publish-ports";

import { ContentTypeNotActiveError, EntryFieldValidationError, EntrySlugConflictError, VersionConflictError, type EntryRecord } from "@jini-ai/cms/entries";
import { getEntryLockState, collectWidgetConfigStrings, validateWidgetConfig } from "@jini-ai/cms/widgets";
import { parseWidgetAreaPayload, parseWidgetInstancePayload } from "@jini-ai/cms/widgets";
import { WidgetAreaConflictError, WidgetAreaNotFoundError, WidgetConfigValidationError, WidgetForbiddenError, WidgetInstanceNotFoundError, WidgetTypeUnregisteredError, WidgetVersionConflictError } from "@jini-ai/cms/widgets";
import { bindWidgetArea, mutateWidgetAreaPlacements, reconcileWidgetRegionBindings, validatePlacementWidgetsExist } from "@jini-ai/cms/widgets";
import type { findWidgetTypeRegistration } from "@jini-ai/cms/widgets";
import { WIDGET_AREA_CONTENT_TYPE, WIDGET_CONTENT_TYPE } from "@jini-ai/cms/widgets";
import type { WidgetInstanceStatus, WidgetPlacementNode, WidgetRegionKey, WidgetTypeKey } from "@jini-ai/cms/widgets";
import { importWidgetInstance } from "@jini-ai/cms/widgets";

/** The slice of the host's publish bag this file reads. The host registry (`features/publish-content/type-registry.ts`) is
 *  instantiated with the full product bag, which satisfies this slice, so this file names no other feature. */
type WidgetBag = Pick<CmsPublishPorts, "widget" | "widget-area">;

/**
 * @file `widget` and `widget-area` on the publish factory.
 *
 * - `widget`: one `type='widget'` entry, keeping the source id (placements name it), addressed by
 *   slug. Packs the decoded payload (`widgetType`, `config`), not the stored JSON string, so key order
 *   never reads as a change. Only `active` instances outside the Trash travel. Config is
 *   schema-checked at write time, but the ids inside it (menu, media) resolve at render. A scoped
 *   publish carries what the config names (`references`): its form, menu or term, and any media file
 *   a free-text field links to by URL.
 *   A `contact-form` widget's `formDefinitionId` is the exception: a form's id is minted per instance
 *   (forms travel by slug), so the packed config names the form by slug and the write turns it back
 *   into the destination's own id — hence `dependsOn: ["form"]`.
 * - `widget-area`: one region's placements, keyed by `regionKey` (each instance owns its own area
 *   row, so the entry id stays local). The whole placement list replaces the destination's through
 *   `mutateWidgetAreaPlacements` (version-guarded, checks every placed widget is live), then the
 *   region bindings are rebuilt.
 */

/** The widgets write-service deps for one apply. */
function serviceDeps(
  { ctx, entityType, policy }: { policy: Parameters<typeof contributeWidgetPublish>[0]; ctx: RepoWriteContext<unknown, WidgetPublishPorts, WidgetBag>; entityType: string },
  _optional = {}
) {
  const { deps, ports } = ctx;
  const gateway = gatewayDeps({ deps, entityType });
  return {
    host: policy.buildWidgetHostPorts(),
    entryLocks: getEntryLockState({ owner: ports.entries }),
    entryRepo: ports.entries,
    contentTypeRepo: ports.contentTypes,
    entryRefsRepo: ports.entryRefs,
    bindingRepo: ports.bindings,
    clock: deps.clock,
    ids: deps.idGen,
    authorize: gateway.authorize,
    outbox: gateway.outbox,
  };
}

interface WidgetRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly widgetType: WidgetTypeKey;
  readonly config: Record<string, unknown>;
  readonly status: WidgetInstanceStatus;
  readonly version: number;
  readonly deletedAt: string | null;
}

function toWidgetRow(entry: EntryRecord & { deletedAt?: string | null }): WidgetRow {
  const { widgetType, config, status } = parseWidgetInstancePayload({ fieldsJson: entry.fieldsJson });
  return { id: entry.id, slug: entry.slug, title: entry.title, widgetType, config, status, version: entry.version, deletedAt: entry.deletedAt ?? null };
}



/** The ref-typed config fields (`Jini/packages/cms/src/widgets/registry.ts`'s `x-ref-target`) and the publish type each names: a
 *  form by slug (packed through {@link swapFormRef}), a menu and a term by id. */


/** Swaps a `contact-form` widget's form reference through `swap` (id to slug on pack, slug to id on
 *  write). A reference `swap` cannot resolve stays as it is, so a dangling one stays dangling on
 *  both sides and still hashes alike. */
async function swapFormRef(
  {
    widgetType,
    config,
    swap,
    policy,
  }: {
    policy: Parameters<typeof contributeWidgetPublish>[0];
    widgetType: WidgetTypeKey;
    config: Record<string, unknown>;
    swap: (ref: string) => Promise<string | undefined>;
  },
  _optional = {}
): Promise<Record<string, unknown>> {
  const ref = config[policy.formReference.field];
  if (widgetType !== policy.formReference.widgetType || typeof ref !== "string") return config;
  return { ...config, [policy.formReference.field]: (await swap(ref)) ?? ref };
}

/** The media a widget's free-text config fields link to by `/m/` or `/media/` URL (a text widget's
 *  body, a social link's `url`), found through its type's `configSchema`. No v1 type stores a media
 *  id, so URLs are the only way a widget's settings name an image or file. */
function widgetMediaReferences(
  { widgetType, config, policy }: { widgetType: string; config: Record<string, unknown>; policy: Parameters<typeof contributeWidgetPublish>[0] },
  _optional = {}
): PublishContentReference[] {
  const registration = policy.findWidgetTypeRegistration({ raw: widgetType });
  if (!registration) return [];
  const keys = new Set(collectWidgetConfigStrings({ schema: registration.configSchema, config }).flatMap((text) => [...collectMediaUrlKeys({ text })]));
  for (const key of collectMediaConfigKeys({ config })) keys.add(key);
  return [...keys].map((key) => ({ entityType: "media", key }));
}

/** The row as it packs: its form reference as the form's slug. */
async function portableRow(
  { p, workspaceId, row, policy }: { p: WidgetPublishPorts; workspaceId: string; row: WidgetRow; policy: Parameters<typeof contributeWidgetPublish>[0] },
  _optional = {}
): Promise<WidgetRow> {
  const config = await swapFormRef({ policy, widgetType: row.widgetType, config: row.config, swap: async (id) => (await p.forms.findById({ workspaceId, id }))?.slug });
  return config === row.config ? row : { ...row, config };
}

export const contributeWidgetPublish = (policy: {
  bindingTable: string;
  buildWidgetHostPorts: () => WidgetHostPorts;
  findWidgetTypeRegistration: typeof findWidgetTypeRegistration;
  configReferences: Readonly<Record<string, string>>;
  formReference: { field: string; widgetType: string };
}, _optional: Record<string, never> = {}): PublishContentContributor<WidgetBag> =>
  createRepoPublishHandler<WidgetRow, WidgetPublishPorts, WidgetBag>({
    entityType: "widget",
    coversTables: ["entries", "entry_refs", policy.bindingTable],
    permission: "widgets.update",
    // `importWidgetInstance` asks `widgets.create` for a widget new to the destination.
    alsoAuthorizes: ["widgets.create"],
    dependsOn: ["form"],
    ports: ({ deps }, _optional = {}) => deps.ports.widget,
    list: async ({ ports: p, workspaceId }) =>
      Promise.all((await p.entries.listByWorkspace({ workspaceId }, { type: WIDGET_CONTENT_TYPE })).map((entry) => portableRow({ p, workspaceId, policy, row: toWidgetRow(entry) }))),
    find: async ({ ports: p, workspaceId, id }) => {
      const row = await p.entries.findAnyById({ workspaceId, id });
      return row && row.type === WIDGET_CONTENT_TYPE ? portableRow({ p, workspaceId, policy, row: toWidgetRow(row) }) : null;
    },
    // A legacy `trash`/`purged` payload is trashed too (the Trash adopts those rows over time).
    isTrashed: ({ row }) => row.deletedAt !== null || row.status !== "active",
    fields: {
      slug: "transferred",
      title: "transferred",
      widgetType: "transferred",
      config: "transferred",
      id: "local",
      status: "local",
      version: "local",
      deletedAt: "local",
    },
    address: {
      field: "slug",
      holder: async ({ ports: p, workspaceId, value: slug }) => {
        // Trash included: a trashed widget keeps its slug.
        const row = await p.entries.findAnyBySlug({ workspaceId, type: WIDGET_CONTENT_TYPE, slug });
        return row ? toWidgetRow(row) : null;
      },
    },
    references: ({ entity }) => collectWidgetPublishReferences({ entity, policy }),
    validate: ({ entity }) => validateWidgetPublish({ entity, policy }),
    write: ctx => writePublishedWidget(ctx, policy),
    errors: {
      conflict: [VersionConflictError, WidgetVersionConflictError],
      blocked: [WidgetForbiddenError, WidgetTypeUnregisteredError, WidgetConfigValidationError, EntrySlugConflictError, EntryFieldValidationError, ContentTypeNotActiveError],
    },
  });

interface WidgetAreaRow {
  readonly regionKey: WidgetRegionKey;
  readonly placements: readonly WidgetPlacementNode[];
  readonly schemaVersion: number;
  readonly areaEntryId: string;
  readonly version: number;
}

/** One row per region; a region on two area entries resolves last-wins, as the binding rebuild does. */
async function listAreas({ ports: p, workspaceId }: { ports: WidgetPublishPorts; workspaceId: string }, _optional: Record<string, never> = {}): Promise<WidgetAreaRow[]> {
  const byRegion = new Map<string, WidgetAreaRow>();
  for (const entry of await p.entries.listByWorkspace({ workspaceId }, { type: WIDGET_AREA_CONTENT_TYPE })) {
    const { regionKey, doc } = parseWidgetAreaPayload({ fieldsJson: entry.fieldsJson });
    byRegion.set(regionKey, { regionKey, placements: doc.placements, schemaVersion: doc.schemaVersion, areaEntryId: entry.id, version: entry.version });
  }
  return [...byRegion.values()];
}

export const contributeWidgetAreaPublish = (policy: Parameters<typeof contributeWidgetPublish>[0], _optional: Record<string, never> = {}): PublishContentContributor<WidgetBag> =>
  createRepoPublishHandler<WidgetAreaRow, WidgetPublishPorts, WidgetBag>({
    entityType: "widget-area",
    coversTables: ["entries", "entry_refs", policy.bindingTable],
    permission: "widgets.place",
    dependsOn: ["widget"],
    ports: ({ deps }, _optional = {}) => deps.ports["widget-area"],
    list: ({ ports, workspaceId }) => listAreas({ ports, workspaceId }),
    find: async ({ ports: p, workspaceId, id: regionKey }) => (await listAreas({ ports: p, workspaceId })).find((row) => row.regionKey === regionKey) ?? null,
    idOf: ({ row }, _optional = {}) => row.regionKey,
    fields: {
      regionKey: "transferred",
      placements: "transferred",
      // Always 1; `mutateWidgetAreaPlacements` keeps the destination's own.
      schemaVersion: "provenance",
      areaEntryId: "local",
      version: "local",
    },
    references: ({ entity }) => collectPlacementReferences({ state: entity.state }),
    write: async (ctx) => {
      const { state, existing, expectedVersion, principalId, workspaceId } = ctx;
      const deps = serviceDeps({ ctx, entityType: "widget-area", policy });
      const regionKey = state.regionKey as WidgetRegionKey;
      const placements = state.placements as WidgetPlacementNode[];
      // Before `bindWidgetArea`: a create that then failed this check would leave an empty area bound.
      await validatePlacementWidgetsExist({ deps: deps, workspaceId: workspaceId, placements: placements });
      const area = existing
        ? { id: existing.areaEntryId, version: expectedVersion as number }
        : (await bindWidgetArea({ deps, input: { workspaceId, regionKey } })).areaEntry;
      const { areaEntry } = await mutateWidgetAreaPlacements({
        deps,
        input: { workspaceId, actor: { principalId, kind: applyRunActor({ deps: ctx.deps, principalId }).kind }, areaEntryId: area.id, baseVersion: area.version, placements },
      });
      await reconcileWidgetRegionBindings({ deps, input: { workspaceId } });
      return { version: areaEntry.version };
    },
    errors: {
      conflict: [VersionConflictError, WidgetAreaConflictError],
      blocked: [WidgetForbiddenError, WidgetInstanceNotFoundError, WidgetAreaNotFoundError, EntrySlugConflictError],
    },
  });

function collectWidgetPublishReferences({ entity, policy }: Parameters<NonNullable<Parameters<typeof createRepoPublishHandler<WidgetRow, WidgetPublishPorts, WidgetBag>>[0]["references"]>>[0] & { policy: Parameters<typeof contributeWidgetPublish>[0] }): ReturnType<NonNullable<Parameters<typeof createRepoPublishHandler<WidgetRow, WidgetPublishPorts, WidgetBag>>[0]["references"]>> {
      const config = (entity.state.config ?? {}) as Record<string, unknown>;
      const refs = Object.entries(policy.configReferences).flatMap(([field, entityType]) => {
        const key = config[field];
        return typeof key === "string" && key.length > 0 ? [{ entityType, key }] : [];
      });
      return [...refs, ...widgetMediaReferences({ policy, widgetType: String(entity.state.widgetType), config })];
    }

async function validateWidgetPublish({ entity, policy }: Pick<Parameters<NonNullable<Parameters<typeof createRepoPublishHandler<WidgetRow, WidgetPublishPorts, WidgetBag>>[0]["validate"]>>[0], "entity"> & { policy: Parameters<typeof contributeWidgetPublish>[0] }): ReturnType<NonNullable<Parameters<typeof createRepoPublishHandler<WidgetRow, WidgetPublishPorts, WidgetBag>>[0]["validate"]>> {
      const widgetType = entity.state.widgetType as WidgetTypeKey;
      const registration = policy.findWidgetTypeRegistration({ raw: widgetType });
      if (!registration) return `widget '${entity.id}': widget type '${widgetType}' is not installed on the destination`;
      const check = validateWidgetConfig({ schema: registration.configSchema, config: entity.state.config as Record<string, unknown> });
      return check.valid ? null : `widget '${entity.id}': its settings do not fit the destination's '${widgetType}' widget`;
    }

async function writePublishedWidget(ctx: Parameters<NonNullable<Parameters<typeof createRepoPublishHandler<WidgetRow, WidgetPublishPorts, WidgetBag>>[0]["write"]>>[0], policy: Parameters<typeof contributeWidgetPublish>[0]): ReturnType<NonNullable<Parameters<typeof createRepoPublishHandler<WidgetRow, WidgetPublishPorts, WidgetBag>>[0]["write"]>> {
      const { id, state, expectedVersion, principalId, workspaceId, ports } = ctx;
      const widgetType = state.widgetType as WidgetTypeKey;
      const config = await swapFormRef({ policy, widgetType, config: state.config as Record<string, unknown>, swap: async (slug) => (await ports.forms.findBySlug({ workspaceId, slug }))?.id });
      const { instance } = await importWidgetInstance({
        deps: serviceDeps({ ctx, entityType: "widget", policy }),
        input: {
          workspaceId,
          // The import origin's actor kind, merged in by the apply port (FIX 19 / H2).
          actor: { principalId, kind: applyRunActor({ deps: ctx.deps, principalId }).kind },
          id,
          slug: state.slug as string,
          title: state.title as string,
          widgetType,
          config,
          expectedVersion,
        },
      });
      return { version: instance.version };
    }
