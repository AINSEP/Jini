/**
 * @module memory
 *
 * Generic memory/notes HTTP surface — thin route wrappers over a
 * frontmatter-backed note store, an extraction-attempt log, and a
 * verify-outcome log, plus a multiplexed SSE change feed. Ported from OD's
 * `apps/daemon/src/routes/memory.ts` (690 lines) — see `source-map.md`'s
 * 2026-07-21 memory-routes section for the full per-route classification.
 *
 * **Deliberately does NOT depend on `@injini/memory`.** That package exists in
 * this repo (`packages/memory/`, `createNoteStore`/`createExtractionLog`/
 * `createVerifyLog` structurally match every collaborator type below field
 * for field), but it is listed in this repo's root `UNLOCKED.md` with
 * `"lockedPackagesMayImport": false` — `@injini/http` is one of
 * `scripts/check-engine-boundaries.ts`'s fourteen locked packages, so
 * importing `@injini/memory` directly would fail `pnpm guard`'s R7 check
 * outright (the same constraint `packages/media/src/sqlite-task-store.ts`'s
 * `ADS-memory/reports/proposals/PROP-media-durable-tasks-2026-07-21.md`
 * documents for `@injini/sqlite`/`@injini/media`). The types below
 * (`MemoryNoteStore`/`MemoryExtractionLog`/`MemoryVerifyLog`) are local,
 * structural mirrors of `@injini/memory`'s real `NoteStore`/`ExtractionLog`/
 * `VerifyLog` interfaces — a real `@injini/memory` instance satisfies them
 * with zero adapter code (this is the same "host supplies the real
 * collaborator" DI convention `daemon-status.ts`/`host-tools.ts`/`db-ops.ts`
 * already established), but this package incurs no dependency on it, locked
 * or not. If/when `@injini/memory` is promoted to `"stable"`, a follow-up can
 * replace these local types with direct imports — a mechanical change, not
 * a redesign, since the shapes already match.
 *
 * **Ported (generic, no OD coupling):** the config `enabled` toggle, entry
 * CRUD (`POST /api/memory`, `GET/PUT/DELETE /api/memory/:id`), the tree
 * view and single-node patch, the raw index text, the extraction/
 * verification history lists + clear/remove, and the multiplexed
 * `change`/`extraction`/`verify` SSE feed.
 *
 * **Explicitly NOT ported (OD-PRODUCT or missing-primitive, see
 * `source-map.md` for the full reasoning per route):**
 * - `POST /api/memory/rules/suggest` — OD's canvas/deck-annotation shape.
 * - `POST /api/memory/connectors/suggest` / `.../connectors/extract` — OD's
 *   project-scoped connector-mining pipeline.
 * - `POST /api/memory/extract` — the heuristic-regex pre-turn phase and the
 *   BYOK-chat-provider-passthrough LLM post-turn phase are both OD-specific
 *   composition, per this repo's root `AGENTS.md`'s existing note that
 *   `@injini/memory`'s "heuristic-regex... prompt-composition pieces" were
 *   "explicitly left un-ported."
 * - `GET /api/memory/system-prompt` — depends on `composeMemoryBody`, which
 *   does not exist anywhere in `@injini/memory` yet (same `AGENTS.md` note).
 * - The four extra `MemoryConfigPatch` boolean toggles
 *   (`chatExtractionEnabled`/`profileEnabled`/`rewriteEnabled`/
 *   `verifyEnabled`) and the whole `extraction` (LLM-provider) config
 *   sub-object: `@injini/memory`'s `NoteStoreOptions` is `{enabled: boolean}`
 *   only — a real, documented capability gap in the underlying store, not a
 *   route-level scoping choice. A host needing those toggles today has to
 *   layer its own config storage alongside `NoteStore.writeConfig`.
 */
import type { Express, Request, Response } from 'express';
import { createApiError } from '@injini/protocol';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { validationError } from './request.js';
import { createSseChannel, type SseEvent } from './sse.js';
import { err, ok, type Result, type RouteInputContext } from './types.js';

// ---------------------------------------------------------------------------
// Local structural mirrors of @injini/memory's NoteStore/ExtractionLog/VerifyLog
// (see module doc for why these are not imported).
// ---------------------------------------------------------------------------

export interface MemoryNoteEntrySummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly updatedAt: number;
}

export interface MemoryNoteEntry extends MemoryNoteEntrySummary {
  readonly body: string;
}

export interface MemoryTreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly path: string;
  readonly name: string;
  readonly description: string;
  readonly kind: 'folder' | 'entry';
  readonly type: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly childrenCount: number;
}

export interface MemoryNoteStoreOptions {
  readonly enabled: boolean;
}

/** Minimal event-emitter surface every collaborator's `events` field needs — satisfied structurally by a real `node:events` `EventEmitter`. */
export interface MemoryChangeEmitter {
  on(event: string, listener: (event: unknown) => void): unknown;
  off(event: string, listener: (event: unknown) => void): unknown;
}

export interface MemoryNoteStore {
  readonly events: MemoryChangeEmitter;
  dir(dataDir: string): string;
  readConfig(dataDir: string): Promise<MemoryNoteStoreOptions>;
  writeConfig(dataDir: string, patch: Partial<MemoryNoteStoreOptions>): Promise<MemoryNoteStoreOptions>;
  readIndex(dataDir: string): Promise<string>;
  writeIndex(dataDir: string, body: string): Promise<void>;
  listEntries(dataDir: string): Promise<readonly MemoryNoteEntrySummary[]>;
  readEntry(dataDir: string, id: string): Promise<MemoryNoteEntry | null>;
  upsertEntry(
    dataDir: string,
    input: { id?: string; name: string; description?: string; type: string; body?: string },
  ): Promise<MemoryNoteEntry>;
  deleteEntry(dataDir: string, id: string): Promise<void>;
  updateTreeNode(
    dataDir: string,
    id: string,
    patch: { name?: string; description?: string; type?: string; body?: string },
  ): Promise<MemoryNoteEntry>;
  buildTree(dataDir: string): Promise<readonly MemoryTreeNode[]>;
}

export interface MemoryExtractionLog {
  readonly events: MemoryChangeEmitter;
  list(): readonly unknown[];
  remove(id: string): number;
  clear(): number;
}

export interface MemoryVerifyLog {
  readonly events: MemoryChangeEmitter;
  list(): readonly unknown[];
  remove(id: string): number;
  clear(): number;
}

export interface MemoryHttpDeps {
  readonly notes: MemoryNoteStore;
  readonly extractions: MemoryExtractionLog;
  readonly verifications: MemoryVerifyLog;
  /** Forwarded verbatim to every `MemoryNoteStore`/log call — the same `dataDir` a host passes to its own `createNoteStore`-backed instance. */
  readonly dataDir: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseIdParam(input: RouteInputContext): Result<string> {
  const id = input.params.id;
  return typeof id === 'string' && id.length > 0 ? ok(id) : err(validationError('id must be a non-empty path parameter'));
}

// ---------------------------------------------------------------------------
// GET /api/memory
// ---------------------------------------------------------------------------

export interface MemoryOverviewResponse {
  readonly enabled: boolean;
  readonly rootDir: string;
  readonly index: string;
  readonly entries: readonly MemoryNoteEntrySummary[];
}

export const memoryOverviewRoute = defineJsonRoute<void, MemoryOverviewResponse, MemoryHttpDeps>({
  method: 'get',
  path: '/api/memory',
  parse: () => ok(undefined),
  handle: async (_input, deps) => {
    const [config, index, entries] = await Promise.all([
      deps.notes.readConfig(deps.dataDir),
      deps.notes.readIndex(deps.dataDir),
      deps.notes.listEntries(deps.dataDir),
    ]);
    return ok({ enabled: config.enabled, rootDir: deps.notes.dir(deps.dataDir), index, entries });
  },
});

// ---------------------------------------------------------------------------
// GET /api/memory/tree, PATCH /api/memory/tree/:id
// ---------------------------------------------------------------------------

export interface MemoryTreeResponse {
  readonly enabled: boolean;
  readonly rootDir: string;
  readonly tree: readonly MemoryTreeNode[];
}

export const memoryTreeRoute = defineJsonRoute<void, MemoryTreeResponse, MemoryHttpDeps>({
  method: 'get',
  path: '/api/memory/tree',
  parse: () => ok(undefined),
  handle: async (_input, deps) => {
    const [config, tree] = await Promise.all([deps.notes.readConfig(deps.dataDir), deps.notes.buildTree(deps.dataDir)]);
    return ok({ enabled: config.enabled, rootDir: deps.notes.dir(deps.dataDir), tree });
  },
});

export interface MemoryTreeNodePatch {
  readonly name?: string;
  readonly description?: string;
  readonly type?: string;
  readonly body?: string;
}

interface MemoryUpdateTreeNodeInput {
  readonly id: string;
  readonly patch: MemoryTreeNodePatch;
}

export interface MemoryUpdateTreeNodeResponse {
  readonly entry: MemoryNoteEntry;
  readonly tree: readonly MemoryTreeNode[];
}

function parseUpdateTreeNode(input: RouteInputContext): Result<MemoryUpdateTreeNodeInput> {
  const parsedId = parseIdParam(input);
  if (!parsedId.ok) return parsedId;
  if (!isRecord(input.body)) return err(validationError('body must be a JSON object'));
  const patch: MemoryTreeNodePatch = {};
  for (const key of ['name', 'description', 'type', 'body'] as const) {
    const value = input.body[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') return err(validationError(`${key} must be a string when provided`));
    (patch as Record<string, string>)[key] = value;
  }
  return ok({ id: parsedId.value, patch });
}

export const memoryUpdateTreeNodeRoute = defineJsonRoute<
  MemoryUpdateTreeNodeInput,
  MemoryUpdateTreeNodeResponse,
  MemoryHttpDeps
>({
  method: 'patch',
  path: '/api/memory/tree/:id',
  requireSameOrigin: true,
  parse: parseUpdateTreeNode,
  handle: async ({ id, patch }, deps) => {
    try {
      const entry = await deps.notes.updateTreeNode(deps.dataDir, id, patch);
      const tree = await deps.notes.buildTree(deps.dataDir);
      return ok({ entry, tree });
    } catch (error) {
      const message = errorMessage(error);
      return err(createApiError(message === 'note not found' ? 'NOT_FOUND' : 'BAD_REQUEST', message));
    }
  },
});

// ---------------------------------------------------------------------------
// PUT /api/memory/index
// ---------------------------------------------------------------------------

export interface MemoryIndexResponse {
  readonly index: string;
}

function parseIndexBody(input: RouteInputContext): Result<string> {
  const body = isRecord(input.body) ? input.body : {};
  const index = typeof body.index === 'string' ? body.index : '';
  return ok(index);
}

export const memoryWriteIndexRoute = defineJsonRoute<string, MemoryIndexResponse, MemoryHttpDeps>({
  method: 'put',
  path: '/api/memory/index',
  requireSameOrigin: true,
  parse: parseIndexBody,
  handle: async (index, deps) => {
    try {
      await deps.notes.writeIndex(deps.dataDir, index);
      return ok({ index });
    } catch (error) {
      return err(createApiError('BAD_REQUEST', errorMessage(error)));
    }
  },
});

// ---------------------------------------------------------------------------
// PATCH /api/memory/config — `enabled` only, see module doc for the gap
// ---------------------------------------------------------------------------

export interface MemoryConfigResponse {
  readonly enabled: boolean;
}

function parseConfigPatch(input: RouteInputContext): Result<Partial<MemoryNoteStoreOptions>> {
  if (!isRecord(input.body)) return err(validationError('body must be a JSON object'));
  if (input.body.enabled === undefined) return ok({});
  if (typeof input.body.enabled !== 'boolean') return err(validationError('enabled must be a boolean when provided'));
  return ok({ enabled: input.body.enabled });
}

export const memoryWriteConfigRoute = defineJsonRoute<Partial<MemoryNoteStoreOptions>, MemoryConfigResponse, MemoryHttpDeps>({
  method: 'patch',
  path: '/api/memory/config',
  requireSameOrigin: true,
  parse: parseConfigPatch,
  handle: async (patch, deps) => {
    try {
      const next = await deps.notes.writeConfig(deps.dataDir, patch);
      return ok({ enabled: next.enabled });
    } catch (error) {
      return err(createApiError('BAD_REQUEST', errorMessage(error)));
    }
  },
});

// ---------------------------------------------------------------------------
// Extraction history: GET/DELETE /api/memory/extractions, DELETE .../:id
// ---------------------------------------------------------------------------

export interface MemoryExtractionsResponse {
  readonly extractions: readonly unknown[];
}

export const memoryListExtractionsRoute = defineJsonRoute<void, MemoryExtractionsResponse, MemoryHttpDeps>({
  method: 'get',
  path: '/api/memory/extractions',
  parse: () => ok(undefined),
  handle: async (_input, deps) => ok({ extractions: deps.extractions.list() }),
});

export interface MemoryRemovedResponse {
  readonly removed: number;
}

export const memoryClearExtractionsRoute = defineJsonRoute<void, MemoryRemovedResponse, MemoryHttpDeps>({
  method: 'delete',
  path: '/api/memory/extractions',
  requireSameOrigin: true,
  parse: () => ok(undefined),
  handle: async (_input, deps) => ok({ removed: deps.extractions.clear() }),
});

export const memoryRemoveExtractionRoute = defineJsonRoute<string, MemoryRemovedResponse, MemoryHttpDeps>({
  method: 'delete',
  path: '/api/memory/extractions/:id',
  requireSameOrigin: true,
  parse: parseIdParam,
  handle: async (id, deps) => ok({ removed: deps.extractions.remove(id) }),
});

// ---------------------------------------------------------------------------
// Verification history: GET/DELETE /api/memory/verifications, DELETE .../:id
// ---------------------------------------------------------------------------

export interface MemoryVerificationsResponse {
  readonly verifications: readonly unknown[];
}

export const memoryListVerificationsRoute = defineJsonRoute<void, MemoryVerificationsResponse, MemoryHttpDeps>({
  method: 'get',
  path: '/api/memory/verifications',
  parse: () => ok(undefined),
  handle: async (_input, deps) => ok({ verifications: deps.verifications.list() }),
});

export const memoryClearVerificationsRoute = defineJsonRoute<void, MemoryRemovedResponse, MemoryHttpDeps>({
  method: 'delete',
  path: '/api/memory/verifications',
  requireSameOrigin: true,
  parse: () => ok(undefined),
  handle: async (_input, deps) => ok({ removed: deps.verifications.clear() }),
});

export const memoryRemoveVerificationRoute = defineJsonRoute<string, MemoryRemovedResponse, MemoryHttpDeps>({
  method: 'delete',
  path: '/api/memory/verifications/:id',
  requireSameOrigin: true,
  parse: parseIdParam,
  handle: async (id, deps) => ok({ removed: deps.verifications.remove(id) }),
});

// ---------------------------------------------------------------------------
// Entry CRUD: POST /api/memory, GET/PUT/DELETE /api/memory/:id
// ---------------------------------------------------------------------------

export interface MemoryEntryInput {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly type: string;
  readonly body?: string;
}

export interface MemoryEntryResponse {
  readonly entry: MemoryNoteEntry;
}

function parseEntryInput(input: RouteInputContext): Result<MemoryEntryInput> {
  if (!isRecord(input.body)) return err(validationError('body must be a JSON object'));
  const { name, type } = input.body;
  if (typeof name !== 'string' || name.length === 0) {
    return err(validationError('name is required', [{ path: 'name', message: 'required non-empty string' }]));
  }
  if (typeof type !== 'string' || type.length === 0) {
    return err(validationError('type is required', [{ path: 'type', message: 'required non-empty string' }]));
  }
  const description = input.body.description;
  if (description !== undefined && typeof description !== 'string') {
    return err(validationError('description must be a string when provided'));
  }
  const body = input.body.body;
  if (body !== undefined && typeof body !== 'string') {
    return err(validationError('body must be a string when provided'));
  }
  return ok({
    name,
    type,
    ...(description === undefined ? {} : { description }),
    ...(body === undefined ? {} : { body }),
  });
}

export const memoryCreateEntryRoute = defineJsonRoute<MemoryEntryInput, MemoryEntryResponse, MemoryHttpDeps>({
  method: 'post',
  path: '/api/memory',
  requireSameOrigin: true,
  parse: parseEntryInput,
  handle: async (input, deps) => {
    try {
      const entry = await deps.notes.upsertEntry(deps.dataDir, input);
      return ok({ entry });
    } catch (error) {
      return err(createApiError('BAD_REQUEST', errorMessage(error)));
    }
  },
});

export const memoryReadEntryRoute = defineJsonRoute<string, MemoryEntryResponse, MemoryHttpDeps>({
  method: 'get',
  path: '/api/memory/:id',
  parse: parseIdParam,
  handle: async (id, deps) => {
    const entry = await deps.notes.readEntry(deps.dataDir, id);
    return entry === null ? err(createApiError('NOT_FOUND', 'memory not found')) : ok({ entry });
  },
});

interface MemoryUpdateEntryInput {
  readonly id: string;
  readonly input: MemoryEntryInput;
}

function parseUpdateEntry(input: RouteInputContext): Result<MemoryUpdateEntryInput> {
  const parsedId = parseIdParam(input);
  if (!parsedId.ok) return parsedId;
  const parsedInput = parseEntryInput(input);
  if (!parsedInput.ok) return parsedInput;
  return ok({ id: parsedId.value, input: parsedInput.value });
}

export const memoryUpdateEntryRoute = defineJsonRoute<MemoryUpdateEntryInput, MemoryEntryResponse, MemoryHttpDeps>({
  method: 'put',
  path: '/api/memory/:id',
  requireSameOrigin: true,
  parse: parseUpdateEntry,
  handle: async ({ id, input }, deps) => {
    try {
      const entry = await deps.notes.upsertEntry(deps.dataDir, { ...input, id });
      return ok({ entry });
    } catch (error) {
      return err(createApiError('BAD_REQUEST', errorMessage(error)));
    }
  },
});

export interface MemoryDeleteEntryResponse {
  readonly ok: true;
}

export const memoryDeleteEntryRoute = defineJsonRoute<string, MemoryDeleteEntryResponse, MemoryHttpDeps>({
  method: 'delete',
  path: '/api/memory/:id',
  requireSameOrigin: true,
  parse: parseIdParam,
  handle: async (id, deps) => {
    try {
      await deps.notes.deleteEntry(deps.dataDir, id);
      return ok({ ok: true });
    } catch (error) {
      return err(createApiError('BAD_REQUEST', errorMessage(error)));
    }
  },
});

// ---------------------------------------------------------------------------
// GET /api/memory/events — multiplexed SSE change/extraction/verify feed
// ---------------------------------------------------------------------------

interface MemoryStreamEvent extends SseEvent {
  readonly data: unknown;
}

/**
 * `GET /api/memory/events` — one SSE connection multiplexing three channels
 * (matching OD's own reasoning: "so the browser opens one connection instead
 * of two/three"): `connected` (once, on open), `change` (relayed from
 * `deps.notes.events`), `extraction` (relayed from `deps.extractions.events`,
 * whose underlying event name is `'attempt'` — see `@injini/memory`'s
 * `extraction-log.ts`), and `verify` (relayed from `deps.verifications.events`).
 * Uses `sse.ts`'s generic channel rather than OD's bespoke `createSseResponse`;
 * no Last-Event-ID replay (unlike `runs.ts`) since none of the three
 * underlying emitters buffer history for reconnect — this mirrors the OD
 * origin's own behavior (a live tail only, no replay).
 */
export function registerMemoryEventStream(app: Express, deps: MemoryHttpDeps): void {
  app.get('/api/memory/events', (_req: Request, res: Response) => {
    let seq = 0;
    const channel = createSseChannel<MemoryStreamEvent>(res);
    const emit = (kind: string, data: unknown): void => {
      channel.enqueue({ opaqueCursor: String(seq++), kind, data });
    };

    const onChange = (event: unknown): void => emit('change', event);
    const onExtraction = (event: unknown): void => emit('extraction', event);
    const onVerify = (event: unknown): void => emit('verify', event);

    deps.notes.events.on('change', onChange);
    deps.extractions.events.on('attempt', onExtraction);
    deps.verifications.events.on('verify', onVerify);

    channel.onClose(() => {
      deps.notes.events.off('change', onChange);
      deps.extractions.events.off('attempt', onExtraction);
      deps.verifications.events.off('verify', onVerify);
    });

    channel.open();
    emit('connected', { at: Date.now() });
  });
}

/**
 * Mounts every ported memory route. Static sub-resources (`/tree`,
 * `/index`, `/config`, `/events`, `/extractions`, `/verifications`) are
 * mounted BEFORE the `/api/memory/:id` catch-all routes, preserving OD's own
 * ordering discipline ("so an `index`/`config`/`extract` slug can't shadow
 * the real handlers") — Express matches routes in registration order.
 */
export function registerMemoryRoutes(app: Express, deps: MemoryHttpDeps, adapter: AdapterContext): void {
  mountJsonRoute(app, memoryOverviewRoute, deps, adapter);
  mountJsonRoute(app, memoryTreeRoute, deps, adapter);
  mountJsonRoute(app, memoryUpdateTreeNodeRoute, deps, adapter);
  mountJsonRoute(app, memoryWriteIndexRoute, deps, adapter);
  mountJsonRoute(app, memoryWriteConfigRoute, deps, adapter);
  registerMemoryEventStream(app, deps);
  mountJsonRoute(app, memoryListExtractionsRoute, deps, adapter);
  mountJsonRoute(app, memoryClearExtractionsRoute, deps, adapter);
  mountJsonRoute(app, memoryRemoveExtractionRoute, deps, adapter);
  mountJsonRoute(app, memoryListVerificationsRoute, deps, adapter);
  mountJsonRoute(app, memoryClearVerificationsRoute, deps, adapter);
  mountJsonRoute(app, memoryRemoveVerificationRoute, deps, adapter);
  mountJsonRoute(app, memoryCreateEntryRoute, deps, adapter);
  mountJsonRoute(app, memoryReadEntryRoute, deps, adapter);
  mountJsonRoute(app, memoryUpdateEntryRoute, deps, adapter);
  mountJsonRoute(app, memoryDeleteEntryRoute, deps, adapter);
}
