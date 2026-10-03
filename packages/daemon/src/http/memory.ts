/**
 * @module memory
 *
 * Generic memory/notes HTTP surface — thin route wrappers over a
 * frontmatter-backed note store, an extraction-attempt log, and a
 * verify-outcome log, plus a multiplexed SSE change feed. Ported from OD's
 * `apps/daemon/src/routes/memory.ts` (690 lines) — see `archived provenance ledger`'s
 * 2026-07-21 memory-routes section for the full per-route classification.
 *
 * **Deliberately does NOT depend on `@jini-ai/memory`.** That package exists in
 * this repo (`packages/memory/`, `createNoteStore`/`createExtractionLog`/
 * `createVerifyLog` structurally match every collaborator type below field
 * for field). The host supplies the concrete memory implementation rather than
 * making the daemon transport depend on that implementation's release policy.
 * The types below (`MemoryNoteStore`/`MemoryExtractionLog`/`MemoryVerifyLog`) are
 * structural mirrors of `@jini-ai/memory`'s real `NoteStore`/`ExtractionLog`/
 * `VerifyLog` interfaces — a real instance satisfies them with zero adapter
 * code, following the dependency-injection convention established by
 * `daemon-status.ts`/`host-tools.ts`/`db-ops.ts`. The route pack remains replaceable, locked
 * or not. If/when `@jini-ai/memory` is promoted to `"stable"`, a follow-up can
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
 * `archived provenance ledger` for the full reasoning per route):**
 * - `POST /api/memory/rules/suggest` — OD's canvas/deck-annotation shape.
 * - `POST /api/memory/connectors/suggest` / `.../connectors/extract` — OD's
 *   project-scoped connector-mining pipeline.
 * - `POST /api/memory/extract` — the heuristic-regex pre-turn phase and the
 *   BYOK-chat-provider-passthrough LLM post-turn phase are both OD-specific
 *   composition, per this repo's root `AGENTS.md`'s existing note that
 *   `@jini-ai/memory`'s "heuristic-regex... prompt-composition pieces" were
 *   "explicitly left un-ported."
 * - `GET /api/memory/system-prompt` — depends on `composeMemoryBody`, which
 *   does not exist anywhere in `@jini-ai/memory` yet (same `AGENTS.md` note).
 * - The four extra `MemoryConfigPatch` boolean toggles
 *   (`chatExtractionEnabled`/`profileEnabled`/`rewriteEnabled`/
 *   `verifyEnabled`) and the whole `extraction` (LLM-provider) config
 *   sub-object: `@jini-ai/memory`'s `NoteStoreOptions` is `{enabled: boolean}`
 *   only — a real, documented capability gap in the underlying store, not a
 *   route-level scoping choice. A host needing those toggles today has to
 *   layer its own config storage alongside `NoteStore.writeConfig`.
 */
import type { Express, Request, Response } from 'express';
import { createApiError } from '@jini-ai/protocol';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from '@jini-ai/http-kit';
import { guardSameOrigin } from '@jini-ai/http-kit';
import { validationError } from '@jini-ai/http-kit';
import { sendApiError, statusForError } from '@jini-ai/http-kit';
import { createSseChannel, type SseEvent } from '@jini-ai/http-kit';
import { err, ok, type Result, type RouteInputContext } from '@jini-ai/http-kit';

// ---------------------------------------------------------------------------
// Local structural mirrors of @jini-ai/memory's NoteStore/ExtractionLog/VerifyLog
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

/** Minimal event-emitter surface every collaborator's `events` field needs — satisfied structurally by a real `node:events` `EventEmitter`. Its positional methods are a framework ABI, exempt from the object-argument convention. */
export interface MemoryChangeEmitter {
  on(event: string, listener: (event: unknown) => void): unknown;
  off(event: string, listener: (event: unknown) => void): unknown;
}

export interface MemoryNoteStore {
  readonly events: MemoryChangeEmitter;
  dir({ dataDir }: { dataDir: string }): string;
  readConfig({ dataDir }: { dataDir: string }): Promise<MemoryNoteStoreOptions>;
  writeConfig({ dataDir, patch }: { dataDir: string; patch: Partial<MemoryNoteStoreOptions> }): Promise<MemoryNoteStoreOptions>;
  readIndex({ dataDir }: { dataDir: string }): Promise<string>;
  writeIndex({ dataDir, body }: { dataDir: string; body: string }): Promise<void>;
  listEntries({ dataDir }: { dataDir: string }): Promise<readonly MemoryNoteEntrySummary[]>;
  readEntry({ dataDir, id }: { dataDir: string; id: string }): Promise<MemoryNoteEntry | null>;
  upsertEntry({ dataDir, input }: { dataDir: string; input: { id?: string; name: string; description?: string; type: string; body?: string } }
  ): Promise<MemoryNoteEntry>;
  deleteEntry({ dataDir, id }: { dataDir: string; id: string }): Promise<void>;
  updateTreeNode({ dataDir, id, patch }: { dataDir: string; id: string; patch: { name?: string; description?: string; type?: string; body?: string } }
  ): Promise<MemoryNoteEntry>;
  buildTree({ dataDir }: { dataDir: string }): Promise<readonly MemoryTreeNode[]>;
}

export interface MemoryExtractionLog {
  readonly events: MemoryChangeEmitter;
  list(): readonly unknown[];
  remove({ id }: { id: string }): number;
  clear(): number;
}

export interface MemoryVerifyLog {
  readonly events: MemoryChangeEmitter;
  list(): readonly unknown[];
  remove({ id }: { id: string }): number;
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
  return typeof id === 'string' && id.length > 0 ? ok({ value: id }) : err({ error: validationError({ message: 'id must be a non-empty path parameter' }) });
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
  parse: () => ok({ value: undefined }),
  handle: async ({ input: _input, deps }) => {
    const [config, index, entries] = await Promise.all([
      deps.notes.readConfig({ dataDir: deps.dataDir }),
      deps.notes.readIndex({ dataDir: deps.dataDir }),
      deps.notes.listEntries({ dataDir: deps.dataDir }),
    ]);
    return ok({ value: { enabled: config.enabled, rootDir: deps.notes.dir({ dataDir: deps.dataDir }), index, entries } });
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
  parse: () => ok({ value: undefined }),
  handle: async ({ input: _input, deps }) => {
    const [config, tree] = await Promise.all([deps.notes.readConfig({ dataDir: deps.dataDir }), deps.notes.buildTree({ dataDir: deps.dataDir })]);
    return ok({ value: { enabled: config.enabled, rootDir: deps.notes.dir({ dataDir: deps.dataDir }), tree } });
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
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const patch: MemoryTreeNodePatch = {};
  for (const key of ['name', 'description', 'type', 'body'] as const) {
    const value = input.body[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') return err({ error: validationError({ message: `${key} must be a string when provided` }) });
    (patch as Record<string, string>)[key] = value;
  }
  return ok({ value: { id: parsedId.value, patch } });
}

export const memoryUpdateTreeNodeRoute = defineJsonRoute<
  MemoryUpdateTreeNodeInput,
  MemoryUpdateTreeNodeResponse,
  MemoryHttpDeps
>({
  method: 'patch',
  path: '/api/memory/tree/:id',
  parse: parseUpdateTreeNode,
  handle: async ({ input: { id, patch }, deps }) => {
    try {
      const entry = await deps.notes.updateTreeNode({ dataDir: deps.dataDir, id, patch });
      const tree = await deps.notes.buildTree({ dataDir: deps.dataDir });
      return ok({ value: { entry, tree } });
    } catch (error) {
      const message = errorMessage(error);
      return err({ error: createApiError({ code: message === 'note not found' ? 'NOT_FOUND' : 'BAD_REQUEST', message }) });
    }
  },
}, { requireSameOrigin: true });

// ---------------------------------------------------------------------------
// PUT /api/memory/index
// ---------------------------------------------------------------------------

export interface MemoryIndexResponse {
  readonly index: string;
}

/**
 * Requires `index` to be present and a string — it is not defaulted.
 *
 * Coercing anything else to `''` meant a malformed PUT *succeeded* and wrote an empty document over
 * the caller's entire memory index: a misspelled field (`{ notes: "…" }`), a client that sent the
 * value as a number, or a body that failed to serialize all landed on the same destructive path and
 * returned 200. Clearing the index is still supported, because it is a real thing to want — it just
 * has to be asked for explicitly with `{ index: "" }`, which no typo and no serialization accident
 * produces by chance.
 */
function parseIndexBody(input: RouteInputContext): Result<string> {
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const index = input.body.index;
  if (typeof index !== 'string') {
    return err({
      error: validationError({ message: 'index must be a string — send an explicit empty string to clear it' }, {
        issues: [
          { path: 'index', message: 'required string' },
        ]
      })
    });
  }
  return ok({ value: index });
}

export const memoryWriteIndexRoute = defineJsonRoute<string, MemoryIndexResponse, MemoryHttpDeps>({
  method: 'put',
  path: '/api/memory/index',
  parse: parseIndexBody,
  handle: async ({ input: index, deps }) => {
    try {
      await deps.notes.writeIndex({ dataDir: deps.dataDir, body: index });
      return ok({ value: { index } });
    } catch (error) {
      return err({ error: createApiError({ code: 'BAD_REQUEST', message: errorMessage(error) }) });
    }
  },
}, { requireSameOrigin: true });

// ---------------------------------------------------------------------------
// PATCH /api/memory/config — `enabled` only, see module doc for the gap
// ---------------------------------------------------------------------------

export interface MemoryConfigResponse {
  readonly enabled: boolean;
}

function parseConfigPatch(input: RouteInputContext): Result<Partial<MemoryNoteStoreOptions>> {
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  if (input.body.enabled === undefined) return ok({ value: {} });
  if (typeof input.body.enabled !== 'boolean') return err({ error: validationError({ message: 'enabled must be a boolean when provided' }) });
  return ok({ value: { enabled: input.body.enabled } });
}

export const memoryWriteConfigRoute = defineJsonRoute<Partial<MemoryNoteStoreOptions>, MemoryConfigResponse, MemoryHttpDeps>({
  method: 'patch',
  path: '/api/memory/config',
  parse: parseConfigPatch,
  handle: async ({ input: patch, deps }) => {
    try {
      const next = await deps.notes.writeConfig({ dataDir: deps.dataDir, patch });
      return ok({ value: { enabled: next.enabled } });
    } catch (error) {
      return err({ error: createApiError({ code: 'BAD_REQUEST', message: errorMessage(error) }) });
    }
  },
}, { requireSameOrigin: true });

// ---------------------------------------------------------------------------
// Extraction history: GET/DELETE /api/memory/extractions, DELETE .../:id
// ---------------------------------------------------------------------------

export interface MemoryExtractionsResponse {
  readonly extractions: readonly unknown[];
}

export const memoryListExtractionsRoute = defineJsonRoute<void, MemoryExtractionsResponse, MemoryHttpDeps>({
  method: 'get',
  path: '/api/memory/extractions',
  parse: () => ok({ value: undefined }),
  handle: async ({ input: _input, deps }) => ok({ value: { extractions: deps.extractions.list() } }),
});

export interface MemoryRemovedResponse {
  readonly removed: number;
}

export const memoryClearExtractionsRoute = defineJsonRoute<void, MemoryRemovedResponse, MemoryHttpDeps>({
  method: 'delete',
  path: '/api/memory/extractions',
  parse: () => ok({ value: undefined }),
  handle: async ({ input: _input, deps }) => ok({ value: { removed: deps.extractions.clear() } }),
}, { requireSameOrigin: true });

export const memoryRemoveExtractionRoute = defineJsonRoute<string, MemoryRemovedResponse, MemoryHttpDeps>({
  method: 'delete',
  path: '/api/memory/extractions/:id',
  parse: parseIdParam,
  handle: async ({ input: id, deps }) => ok({ value: { removed: deps.extractions.remove({ id }) } }),
}, { requireSameOrigin: true });

// ---------------------------------------------------------------------------
// Verification history: GET/DELETE /api/memory/verifications, DELETE .../:id
// ---------------------------------------------------------------------------

export interface MemoryVerificationsResponse {
  readonly verifications: readonly unknown[];
}

export const memoryListVerificationsRoute = defineJsonRoute<void, MemoryVerificationsResponse, MemoryHttpDeps>({
  method: 'get',
  path: '/api/memory/verifications',
  parse: () => ok({ value: undefined }),
  handle: async ({ input: _input, deps }) => ok({ value: { verifications: deps.verifications.list() } }),
});

export const memoryClearVerificationsRoute = defineJsonRoute<void, MemoryRemovedResponse, MemoryHttpDeps>({
  method: 'delete',
  path: '/api/memory/verifications',
  parse: () => ok({ value: undefined }),
  handle: async ({ input: _input, deps }) => ok({ value: { removed: deps.verifications.clear() } }),
}, { requireSameOrigin: true });

export const memoryRemoveVerificationRoute = defineJsonRoute<string, MemoryRemovedResponse, MemoryHttpDeps>({
  method: 'delete',
  path: '/api/memory/verifications/:id',
  parse: parseIdParam,
  handle: async ({ input: id, deps }) => ok({ value: { removed: deps.verifications.remove({ id }) } }),
}, { requireSameOrigin: true });

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
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const { name, type } = input.body;
  if (typeof name !== 'string' || name.length === 0) {
    return err({ error: validationError({ message: 'name is required' }, { issues: [{ path: 'name', message: 'required non-empty string' }] }) });
  }
  if (typeof type !== 'string' || type.length === 0) {
    return err({ error: validationError({ message: 'type is required' }, { issues: [{ path: 'type', message: 'required non-empty string' }] }) });
  }
  const description = input.body.description;
  if (description !== undefined && typeof description !== 'string') {
    return err({ error: validationError({ message: 'description must be a string when provided' }) });
  }
  const body = input.body.body;
  if (body !== undefined && typeof body !== 'string') {
    return err({ error: validationError({ message: 'body must be a string when provided' }) });
  }
  return ok({
    value: {
      name,
      type,
      ...(description === undefined ? {} : { description }),
      ...(body === undefined ? {} : { body }),
    }
  });
}

export const memoryCreateEntryRoute = defineJsonRoute<MemoryEntryInput, MemoryEntryResponse, MemoryHttpDeps>({
  method: 'post',
  path: '/api/memory',
  parse: parseEntryInput,
  handle: async ({ input, deps }) => {
    try {
      const entry = await deps.notes.upsertEntry({ dataDir: deps.dataDir, input });
      return ok({ value: { entry } });
    } catch (error) {
      return err({ error: createApiError({ code: 'BAD_REQUEST', message: errorMessage(error) }) });
    }
  },
}, { requireSameOrigin: true, successStatus: 201 });

export const memoryReadEntryRoute = defineJsonRoute<string, MemoryEntryResponse, MemoryHttpDeps>({
  method: 'get',
  path: '/api/memory/:id',
  parse: parseIdParam,
  handle: async ({ input: id, deps }) => {
    const entry = await deps.notes.readEntry({ dataDir: deps.dataDir, id });
    return entry === null ? err({ error: createApiError({ code: 'NOT_FOUND', message: 'memory not found' }) }) : ok({ value: { entry } });
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
  return ok({ value: { id: parsedId.value, input: parsedInput.value } });
}

export const memoryUpdateEntryRoute = defineJsonRoute<MemoryUpdateEntryInput, MemoryEntryResponse, MemoryHttpDeps>({
  method: 'put',
  path: '/api/memory/:id',
  parse: parseUpdateEntry,
  handle: async ({ input: { id, input }, deps }) => {
    try {
      const entry = await deps.notes.upsertEntry({ dataDir: deps.dataDir, input: { ...input, id } });
      return ok({ value: { entry } });
    } catch (error) {
      return err({ error: createApiError({ code: 'BAD_REQUEST', message: errorMessage(error) }) });
    }
  },
}, { requireSameOrigin: true });

export interface MemoryDeleteEntryResponse {
  readonly ok: true;
}

export const memoryDeleteEntryRoute = defineJsonRoute<string, MemoryDeleteEntryResponse, MemoryHttpDeps>({
  method: 'delete',
  path: '/api/memory/:id',
  parse: parseIdParam,
  handle: async ({ input: id, deps }) => {
    try {
      await deps.notes.deleteEntry({ dataDir: deps.dataDir, id });
      return ok({ value: { ok: true } });
    } catch (error) {
      return err({ error: createApiError({ code: 'BAD_REQUEST', message: errorMessage(error) }) });
    }
  },
}, { requireSameOrigin: true });

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
 * whose underlying event name is `'attempt'` — see `@jini-ai/memory`'s
 * `extraction-log.ts`), and `verify` (relayed from `deps.verifications.events`).
 * Uses `sse.ts`'s generic channel rather than OD's bespoke `createSseResponse`;
 * no Last-Event-ID replay (unlike `runs.ts`) since none of the three
 * underlying emitters buffer history for reconnect — this mirrors the OD
 * origin's own behavior (a live tail only, no replay).
 *
 * Bypasses `mountJsonRoute` (raw `app.get`, for the SSE response shape), so it does not get
 * `requireSameOrigin` for free the way the JSON routes below do — the guard is applied here
 * directly, before the SSE channel is opened, so a cross-origin request never gets a stream.
 */
export function registerMemoryEventStream({ app, deps, adapter }: { readonly app: Express; readonly deps: MemoryHttpDeps; readonly adapter: AdapterContext }, _optional: Record<string, never> = {}): void {
  app.get('/api/memory/events', (req: Request, res: Response) => {
    const origin = guardSameOrigin({ req, origin: adapter });
    if (!origin.ok) {
      sendApiError({ res, status: statusForError({ error: origin.error }), error: origin.error });
      return;
    }
    let seq = 0;
    const channel = createSseChannel<MemoryStreamEvent>({ res });
    const emit = (kind: string, data: unknown): void => {
      channel.enqueue({ event: { opaqueCursor: String(seq++), kind, data } });
    };

    const onChange = (event: unknown): void => emit('change', event);
    const onExtraction = (event: unknown): void => emit('extraction', event);
    const onVerify = (event: unknown): void => emit('verify', event);

    deps.notes.events.on('change', onChange);
    deps.extractions.events.on('attempt', onExtraction);
    deps.verifications.events.on('verify', onVerify);

    channel.onClose({
      callback: () => {
        deps.notes.events.off('change', onChange);
        deps.extractions.events.off('attempt', onExtraction);
        deps.verifications.events.off('verify', onVerify);
      }
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
export function registerMemoryRoutes({ app, deps, adapter }: { readonly app: Express; readonly deps: MemoryHttpDeps; readonly adapter: AdapterContext }, _optional: Record<string, never> = {}): void {
  mountJsonRoute({ app, spec: memoryOverviewRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryTreeRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryUpdateTreeNodeRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryWriteIndexRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryWriteConfigRoute, deps, adapter });
  registerMemoryEventStream({ app, deps, adapter });
  mountJsonRoute({ app, spec: memoryListExtractionsRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryClearExtractionsRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryRemoveExtractionRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryListVerificationsRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryClearVerificationsRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryRemoveVerificationRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryCreateEntryRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryReadEntryRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryUpdateEntryRoute, deps, adapter });
  mountJsonRoute({ app, spec: memoryDeleteEntryRoute, deps, adapter });
}
