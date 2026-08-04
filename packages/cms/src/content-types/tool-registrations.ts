/**
 * @file Content-types' half of the agent-tool authorization wiring: maps `agent-tools.ts`'s catalog entries onto the
 * `write-service.ts`/`lifecycle.ts` functions the admin HTTP routes call, as `ToolRegistration`s.
 *
 * Colocated with the domain rather than in `assistant/`, so the knowledge this file depends on —
 * which domain function each tool id runs, and therefore what it actually costs — lives next to
 * those functions. `assistant/tool-registrations.ts` only assembles what every domain returns.
 *
 * Scope: 6 of 7 entries are wired — the 5 non-cleanup mutations plus the read-only
 * `collections_content_type_list`. `collections_plan_cleanup`/`collections_execute_cleanup` are
 * declared unwired — the destructive token-gated ceremony, whose mapping is deferred per this
 * catalog's own deferred list. `ToolRegistry.list()` will not show them, which is intentional: no silent stub
 * registrations that could look like a bug if ever actually invoked.
 *
 * `ToolPolicy.authorize` is a pass-through for every entry here (see `buildDomainRegistrations`).
 * For the five mutations, that is the "one evaluator" rule: each domain entrypoint —
 * `registerContentType`, `updateContentTypeFields` (`write-service.ts`), `deprecateContentType`,
 * `reactivateContentType`, `tombstoneContentType` (`lifecycle.ts`) — opens with an
 * `await deps.authorize({ permission: 'admin.collections.manage', ... })` that returns
 * `ForbiddenError` before any repo read, repo write, or index-provisioner call, and
 * `admin.collections.manage` is exactly what each of their five catalog entries declares under
 * `authorization.permission`. `assistant/__tests__/tool-registrations.authorization.test.ts` drives
 * all five through a denying `authorize` and asserts each refuses and writes nothing, deriving its
 * expectations from the catalog itself — so a future tool wired here whose handler does NOT
 * self-enforce fails rather than silently inheriting the pass-through.
 *
 * `collections_content_type_list` is the exception: `listContentTypes` (`list.ts`) is a pure
 * pass-through read with no `authorize()` call of its own — exactly like `routes/admin/content-
 * types/list.ts`, which checks `admin.collections.read` in the route BEFORE calling it. Its handler
 * below does the identical explicit `requireToolPermission` check, in the route's place, the same
 * pattern `comments/tool-registrations.ts` uses for `comments_list_moderation_queue`.
 */
import type { AuthorizeFn } from "../core/commands/command.js";
import type { OutboxPort } from "../core/ports.js";
import {
  AGENT_TOOL_PRINCIPAL_KIND,
  buildDomainRegistrations,
  decorateWithSchema,
  fromResult,
  indexCatalogById,
  requireInputRecord,
  requireNoInput,
  requireNumber,
  requireString,
  requireToolPermission,
  type AgentToolSideEffect,
  type DerivedRiskByToolId,
  type ToolHandler,
  type ToolRegistration,
} from "../core/tools/registration-kit.js";
import { contentTypesAgentToolCatalog } from "./agent-tools.js";
import { parseContentTypeFieldDefs } from "./field-defs.js";
import { listContentTypes, type ContentTypeListPort } from "./list.js";
import { deprecateContentType, reactivateContentType, tombstoneContentType, type TeardownIndexProvisionerPort } from "./lifecycle.js";
import type { ContentTypeFieldDef, ContentTypeRecord } from "./types.js";
import { registerContentType, updateContentTypeFields, type ContentTypeRepoPort, type IndexProvisionerPort } from "./write-service.js";

const CATALOG_BY_ID = indexCatalogById(contentTypesAgentToolCatalog);

/**
 * The exact slice of the route-deps bag Content-Types' tool handlers read. Declared structurally
 * (rather than importing `server/routes/types`'s `RouteDeps`) so this module carries no back-edge
 * into the composition root. `server/routes/*` satisfies this structurally by passing its existing
 * `RouteDeps` object; nothing there changes.
 */
export interface ContentTypesToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: { nowIso(): string };
  idGen: { newId(): string };
  outbox: OutboxPort;
  contentTypeRepo: ContentTypeRepoPort & ContentTypeListPort;
  contentTypeIndexProvisioner: IndexProvisionerPort & TeardownIndexProvisionerPort;
}

/** Descriptors for the 2 cleanup tools this pass does not wire — see file header. */
const UNWIRED_CONTENT_TYPES_TOOL_IDS = new Set(["collections_plan_cleanup", "collections_execute_cleanup"]);

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls — deliberately a second, independent source rather than a read of the catalog's own
 * `sideEffects` field. See `DerivedRiskByToolId` in the kit for why that independence matters.
 */
export const contentTypesDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> listContentTypes (list.ts): one repo.listByWorkspace read, no write of any kind.
  ["collections_content_type_list", "none"],
  // -> registerContentType (write-service.ts): repo.save + appendRevision in one tx.
  ["collections_content_type_define", "mutates-durable-state"],
  // -> updateContentTypeFields (write-service.ts): full field-schema replace + index transitions.
  ["collections_content_type_update_fields", "mutates-durable-state"],
  // -> deprecateContentType (lifecycle.ts): status flip + revision.
  ["collections_content_type_deprecate", "mutates-durable-state"],
  // -> reactivateContentType (lifecycle.ts): status flip + revision.
  ["collections_content_type_reactivate", "mutates-durable-state"],
  // -> tombstoneContentType (lifecycle.ts): one-way terminal transition that tears down every
  //    provisioned index BEFORE persisting the flip. The heaviest of the five.
  ["collections_content_type_tombstone", "mutates-durable-state"],
]);

/**
 * Validates `input.fields` through the SAME boundary parser the admin HTTP routes use
 * (`field-defs.ts`), then re-throws any rejection with the tool's published `inputSchema` appended.
 *
 * The appended schema is the error-recovery half of the contract: a model that gets back only
 * "fields[0].queryable must be a boolean" has to guess the rest of the shape, whereas one that
 * gets the schema alongside it can correct the call in a single turn.
 *
 * @complexity O(f) in the field count, delegated to the parser.
 * @overallScore 100
 */
function requireFields(input: Record<string, unknown>, toolId: string): ContentTypeFieldDef[] {
  const parsed = parseContentTypeFieldDefs(input.fields);
  if (parsed.ok) return parsed.value;
  throw decorateWithSchema({ toolId, catalog: CATALOG_BY_ID, message: parsed.error.message });
}

/** What a content-type tool returns to the model — see {@link toContentTypeView}. */
interface ContentTypeToolView {
  key: string;
  label: string;
  status: ContentTypeRecord["status"];
  version: number;
  fields: ContentTypeFieldDef[];
  tombstonedAt?: string | null;
}

/**
 * Projects a `ContentTypeRecord` into the explicit model-facing shape, instead of returning the
 * domain record verbatim.
 *
 * Two reasons this is a named projection rather than a pass-through. `workspaceId` is dropped: the
 * agent is already scoped to one workspace it did not choose and cannot change, so echoing the id
 * back spends model attention on a value that can never inform a decision. And an explicit view
 * means a future field added to `ContentTypeRecord` — for a plugin, an internal counter, an
 * operator note — does not silently begin flowing to the model as a side effect of a domain change.
 *
 * `version` is deliberately kept: every mutating tool requires `expectedVersion`, so the model
 * needs the post-write value to make a correct follow-up call without re-reading.
 *
 * @param record - The content type as the domain returned it.
 * @returns The model-facing view. `tombstonedAt` is present only when set, so an active type's
 * payload carries no always-null key.
 * @complexity O(f) in the field count (the array is copied so the caller cannot alias domain state).
 * @overallScore 100
 */
function toContentTypeView(record: ContentTypeRecord): ContentTypeToolView {
  const view: ContentTypeToolView = {
    key: record.key,
    label: record.label,
    status: record.status,
    version: record.version,
    fields: [...record.fields],
  };
  if (record.tombstonedAt) view.tombstonedAt = record.tombstonedAt;
  return view;
}

function fromContentTypeResult(
  fn: () => Promise<{ ok: true; value: { contentType: ContentTypeRecord } } | { ok: false; error: Error }>,
): Promise<{ contentType: ContentTypeToolView }> {
  return fromResult(fn).then(({ contentType }) => ({ contentType: toContentTypeView(contentType) }));
}

function contentTypesDeps(routeDeps: ContentTypesToolDeps) {
  return {
    repo: routeDeps.contentTypeRepo,
    clock: routeDeps.clock,
    ids: routeDeps.idGen,
    authorize: routeDeps.authorize,
    outbox: routeDeps.outbox,
    indexProvisioner: routeDeps.contentTypeIndexProvisioner,
  };
}

export function buildContentTypesRegistrations(routeDeps: ContentTypesToolDeps): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    collections_content_type_list: async (ctx) => {
      requireNoInput(ctx.input);
      await requireToolPermission(routeDeps, {
        principalId: ctx.principal.id,
        permission: "admin.collections.read",
        entityType: "content-type",
      });
      const { items } = await listContentTypes({ repo: routeDeps.contentTypeRepo, workspaceId: routeDeps.workspaceId });
      return { contentTypes: items.map(toContentTypeView) };
    },
    collections_content_type_define: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      return fromContentTypeResult(() =>
        registerContentType({
          deps: contentTypesDeps(routeDeps),
          input: {
            actorId: ctx.principal.id,
            principalKind: AGENT_TOOL_PRINCIPAL_KIND,
            workspaceId: routeDeps.workspaceId,
            key: requireString(input, "key"),
            label: requireString(input, "label"),
            fields: requireFields(input, "collections_content_type_define"),
          },
        }),
      );
    },
    collections_content_type_update_fields: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      return fromContentTypeResult(() =>
        updateContentTypeFields({
          deps: contentTypesDeps(routeDeps),
          input: {
            actorId: ctx.principal.id,
            principalKind: AGENT_TOOL_PRINCIPAL_KIND,
            workspaceId: routeDeps.workspaceId,
            key: requireString(input, "key"),
            fields: requireFields(input, "collections_content_type_update_fields"),
            expectedVersion: requireNumber(input, "expectedVersion"),
          },
        }),
      );
    },
    collections_content_type_deprecate: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      return fromContentTypeResult(() =>
        deprecateContentType({
          deps: contentTypesDeps(routeDeps),
          input: {
            actorId: ctx.principal.id,
            principalKind: AGENT_TOOL_PRINCIPAL_KIND,
            workspaceId: routeDeps.workspaceId,
            key: requireString(input, "key"),
            expectedVersion: requireNumber(input, "expectedVersion"),
          },
        }),
      );
    },
    collections_content_type_reactivate: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      return fromContentTypeResult(() =>
        reactivateContentType({
          deps: contentTypesDeps(routeDeps),
          input: {
            actorId: ctx.principal.id,
            principalKind: AGENT_TOOL_PRINCIPAL_KIND,
            workspaceId: routeDeps.workspaceId,
            key: requireString(input, "key"),
            expectedVersion: requireNumber(input, "expectedVersion"),
          },
        }),
      );
    },
    collections_content_type_tombstone: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      return fromContentTypeResult(() =>
        tombstoneContentType({
          deps: contentTypesDeps(routeDeps),
          input: {
            actorId: ctx.principal.id,
            principalKind: AGENT_TOOL_PRINCIPAL_KIND,
            workspaceId: routeDeps.workspaceId,
            key: requireString(input, "key"),
            expectedVersion: requireNumber(input, "expectedVersion"),
          },
        }),
      );
    },
  };

  return buildDomainRegistrations({
    domain: "content-types",
    catalogModule: "features/content-types/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    handlers,
    derivedRisk: contentTypesDerivedRisk,
    unwiredToolIds: UNWIRED_CONTENT_TYPES_TOOL_IDS,
  });
}
