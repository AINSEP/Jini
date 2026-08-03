/**
 * @file Entries' half of ADR-049 Decision 4: maps `agent-tools.ts`'s 5 catalog entries onto
 * `write-service.ts`'s create/update/publish/unpublish and `list.ts`'s read, as `ToolRegistration`s.
 * The entire catalog is wired — there is no delete/purge function to exclude and no cleanup ceremony
 * in this domain (see `agent-tools.ts`'s own header for the 3 deliberate scope exclusions, none of
 * which withhold a whole tool).
 *
 * Authorization shape, mixed and deliberately so: `createEntry`/`updateEntry`/`publishEntry`/
 * `unpublishEntry` each call `deps.authorize({ permission: 'admin.collections.manage', ... })` as
 * their own first line (confirmed directly against `write-service.ts`), so those four handlers must
 * NOT re-check (ADR-021 §2 "one evaluator"). `listEntries` (`list.ts`) has no such call of its own —
 * its file header says so explicitly ("no authorization of its own; the caller route checks
 * `admin.collections.read` first") — so `collections_entry_list`'s handler performs that identical
 * inline check itself, mirroring `entries/list.ts`'s admin route.
 */
import type { AuthorizeFn } from "../core/commands/command.js";
import type { OutboxPort } from "../core/ports.js";
import {
  AGENT_TOOL_PRINCIPAL_KIND,
  buildDomainRegistrations,
  fromResult,
  indexCatalogById,
  optionalString,
  requireInputRecord,
  requireNumber,
  requireString,
  requireToolPermission,
  withSchemaOnRejection,
  type AgentToolSideEffect,
  type DerivedRiskByToolId,
  type ToolHandler,
  type ToolRegistration,
} from "../core/tools/registration-kit.js";
import { entriesAgentToolCatalog } from "./agent-tools.js";
import { EntryFieldValidationError } from "./errors.js";
import { listEntries, type EntryListPort } from "./list.js";
import type { EntryRecord, EntryStatus } from "./types.js";
import { createEntry, publishEntry, unpublishEntry, updateEntry, type ContentTypeLookupPort, type EntryRepoPort } from "./write-service.js";
import { toEntryOutbox } from "./repo.memory.js";

const CATALOG_BY_ID = indexCatalogById(entriesAgentToolCatalog);

/**
 * The exact slice of the route-deps bag Entries' tool handlers read. Declared structurally (rather
 * than importing `server/routes/types`'s `RouteDeps`) so this module carries no back-edge into the
 * composition root. `server/routes/*` satisfies this structurally by passing its existing
 * `RouteDeps` object; nothing there changes.
 *
 * `contentTypeRepo` is typed as `write-service.ts`'s own `ContentTypeLookupPort` — the narrow
 * lookup contract Entries itself declares, not content-types' full `ContentTypeRepoPort` — mirroring
 * `RouteDeps`'s own doc comment on this field ("satisfies entries' `ContentTypeLookupPort`
 * structurally").
 */
export interface EntriesToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: { nowIso(): string };
  idGen: { newId(): string };
  outbox: OutboxPort;
  entryRepo: EntryRepoPort & EntryListPort;
  contentTypeRepo: ContentTypeLookupPort;
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const entriesDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> listEntries (list.ts): entryRepo.listByWorkspace only, no write.
  ["collections_entry_list", "none"],
  // -> createEntry (write-service.ts): entryRepo.save + appendRevision in one tx.
  ["collections_entry_create", "mutates-durable-state"],
  // -> updateEntry (write-service.ts): entryRepo.save + appendRevision in one tx.
  ["collections_entry_update", "mutates-durable-state"],
  // -> publishEntry (write-service.ts): status flip, save + appendRevision.
  ["collections_entry_publish", "mutates-durable-state"],
  // -> unpublishEntry (write-service.ts): status flip, save + appendRevision.
  ["collections_entry_unpublish", "mutates-durable-state"],
]);

/**
 * The Entries rejections worth decorating with the published schema: `fieldsJson` SHAPE problems
 * only. A not-found, a tombstoned-type rejection, or a version conflict is not a shape problem
 * retrying the SAME input would ever resolve.
 */
function isEntriesShapeRejection(error: unknown): boolean {
  return error instanceof EntryFieldValidationError;
}

/** Shared dependency bag for `write-service.ts` calls — every mutating handler here takes this
 * identical shape (a superset of what `updateEntry`/`publishEntry`/`unpublishEntry` individually
 * need; passing the extra `ids` field to those is harmless since none of them declare it). */
function entriesDeps(routeDeps: EntriesToolDeps) {
  return {
    entryRepo: routeDeps.entryRepo,
    contentTypeRepo: routeDeps.contentTypeRepo,
    clock: routeDeps.clock,
    ids: routeDeps.idGen,
    authorize: routeDeps.authorize,
    outbox: toEntryOutbox(routeDeps),
  };
}

/** What an Entries tool returns to the model — see {@link toEntryToolView}. */
interface EntryToolView {
  id: string;
  type: string;
  slug: string;
  status: EntryStatus;
  title: string;
  fieldsJson: unknown;
  bodyJson: unknown | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Projects an `EntryRecord` into the explicit model-facing shape — `workspaceId` is dropped: the
 * agent is already scoped to one workspace it did not choose and cannot change. */
function toEntryToolView(entry: EntryRecord): EntryToolView {
  return {
    id: entry.id,
    type: entry.type,
    slug: entry.slug,
    status: entry.status,
    title: entry.title,
    fieldsJson: entry.fieldsJson,
    bodyJson: entry.bodyJson,
    publishedAt: entry.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    version: entry.version,
  };
}

function fromEntryResult(fn: () => ReturnType<typeof createEntry>): Promise<{ entry: EntryToolView }> {
  return fromResult(fn).then(({ entry }) => ({ entry: toEntryToolView(entry) }));
}

export function buildEntriesRegistrations(routeDeps: EntriesToolDeps): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    collections_entry_list: async (ctx) => {
      const input = ctx.input !== undefined ? requireInputRecord(ctx.input) : {};
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "admin.collections.read", entityType: "entry" });

      const { items } = await listEntries({ repo: routeDeps.entryRepo, workspaceId: routeDeps.workspaceId, type: optionalString(input, "type") });
      return { items: items.map(toEntryToolView) };
    },

    collections_entry_create: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      return withSchemaOnRejection({ toolId: "collections_entry_create", catalog: CATALOG_BY_ID, isShapeRejection: isEntriesShapeRejection }, () =>
        fromEntryResult(() =>
          createEntry({
            deps: entriesDeps(routeDeps),
            input: {
              actorId: ctx.principal.id,
              principalKind: AGENT_TOOL_PRINCIPAL_KIND,
              workspaceId: routeDeps.workspaceId,
              type: requireString(input, "type"),
              slug: requireString(input, "slug"),
              title: requireString(input, "title"),
              fieldsJson: input.fieldsJson ?? { ext: { site: {} } },
              bodyJson: input.bodyJson,
            },
          }),
        ),
      );
    },

    collections_entry_update: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      return withSchemaOnRejection({ toolId: "collections_entry_update", catalog: CATALOG_BY_ID, isShapeRejection: isEntriesShapeRejection }, () =>
        fromEntryResult(() =>
          updateEntry({
            deps: entriesDeps(routeDeps),
            input: {
              actorId: ctx.principal.id,
              principalKind: AGENT_TOOL_PRINCIPAL_KIND,
              workspaceId: routeDeps.workspaceId,
              id: requireString(input, "id"),
              title: typeof input.title === "string" ? input.title : undefined,
              fieldsJson: input.fieldsJson,
              expectedVersion: requireNumber(input, "expectedVersion"),
            },
          }),
        ),
      );
    },

    collections_entry_publish: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      return fromEntryResult(() =>
        publishEntry({
          deps: entriesDeps(routeDeps),
          input: {
            actorId: ctx.principal.id,
            principalKind: AGENT_TOOL_PRINCIPAL_KIND,
            workspaceId: routeDeps.workspaceId,
            id: requireString(input, "id"),
            expectedVersion: requireNumber(input, "expectedVersion"),
          },
        }),
      );
    },

    collections_entry_unpublish: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      return fromEntryResult(() =>
        unpublishEntry({
          deps: entriesDeps(routeDeps),
          input: {
            actorId: ctx.principal.id,
            principalKind: AGENT_TOOL_PRINCIPAL_KIND,
            workspaceId: routeDeps.workspaceId,
            id: requireString(input, "id"),
            expectedVersion: requireNumber(input, "expectedVersion"),
          },
        }),
      );
    },
  };

  // No `unwiredToolIds`: Entries wires its ENTIRE catalog, same tripwire discipline as Widgets/Forms.
  return buildDomainRegistrations({
    domain: "entries",
    catalogModule: "features/entries/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    handlers,
    derivedRisk: entriesDerivedRisk,
  });
}
