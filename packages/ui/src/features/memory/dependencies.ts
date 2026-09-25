/**
 * The only file in this feature allowed to touch a concrete transport
 * adapter. Everything else in the slice depends on `ports.ts`.
 *
 * Split, deliberately, into two different defaults:
 *
 * - `memoryConfigPort`/`memoryEntriesPort`/`memoryExtractionsPort` bind REAL
 *   `fetch`-based adapters against a plain `/api/memory*` REST surface (list/
 *   tree/entry CRUD, config PATCH, extraction history CRUD). Unlike
 *   `features/connectors`' data port — which fakes its transport by design,
 *   because the real one is a specific third-party OAuth-catalog vendor's
 *   API shape — this is a generic JSON/REST contract with no vendor coupling,
 *   and the pinned source's one open bug (`fetchMemoryList()` trusting an
 *   under-validated response — see the fix below and
 *   `packages/ui/source-map.md`) only exists to fix in a real, testable
 *   adapter. A host is still free to supply its own binding; this default
 *   just isn't a fake.
 * - `memoryConnectorsPort` binds a fake/in-memory connector catalogue (same
 *   reasoning as `features/connectors`' own fake — the real catalogue is a
 *   vendor-specific OAuth discovery transport this package doesn't assume),
 *   plus REAL browser-only bridges for the two pieces that touch only
 *   generic browser APIs: pending-authorization persistence (sessionStorage)
 *   and the cross-tab "connectors changed" signal (a `CustomEvent`).
 *   `saveMemoryEntry` on this port is the same real HTTP adapter the entries
 *   cluster uses — saving a connector suggestion is an ordinary memory write,
 *   not a connector-transport concern.
 */
import { FETCH_TIMEOUT_MS, fetchWithTimeout } from '@jini-ai/platform/fetch-with-timeout';
import type { Connector, ConnectorActionResult, ConnectorStatusMap } from '../connectors/types.js';
import {
  DEFAULT_CONNECTOR_PROVIDER,
  MEMORY_CONNECTOR_PENDING_AUTH_STORAGE_KEY,
} from './constants.js';
import type {
  MemoryConfigPort,
  MemoryConnectorsPort,
  MemoryEntriesPort,
  MemoryExtractionsPort,
} from './ports.js';
import type {
  ConnectorMemorySuggestionResponse,
  DraftEntry,
  MemoryEntry,
  MemoryExtractionRecord,
  MemoryExtractionsResponse,
  MemoryListResponse,
  MemoryTreeListResponse,
  MemoryTreeNode,
  UpdateMemoryConfigRequest,
} from './types.js';

// ─── Shared response-field validators ───────────────────────────────────────
//
// WHY THIS EXISTS: a malformed 2xx response missing a field this slice relies
// on must surface as a failure, not silently collapse into whatever fallback
// value an ordinary empty/cleared result would also produce. Every adapter
// below that needs to trust a required response field routes through here.

function requiredField<T extends object, K extends keyof T>(json: T, field: K, context: string): T[K] {
  // A field can be intentionally `null` (e.g. "the daemon cleared this
  // value") — only its ABSENCE from the response is a contract break, not
  // whatever value it holds.
  if (!json || typeof json !== 'object' || !(field in json)) {
    throw new Error(`${context} succeeded without a '${String(field)}' field`);
  }
  return json[field];
}

/** Like `requiredField`, but for a field with no legitimate null/undefined
 *  success case — e.g. a saved/fetched entity a caller can't do anything
 *  useful with as `null`. */
function requiredNonNullField<T extends object, K extends keyof T>(
  json: T,
  field: K,
  context: string,
): NonNullable<T[K]> {
  const value = requiredField(json, field, context);
  if (value === null || value === undefined) {
    throw new Error(`${context} succeeded without a '${String(field)}' field`);
  }
  return value as NonNullable<T[K]>;
}

// ─── Config cluster (real HTTP) ─────────────────────────────────────────────

async function patchMemoryConfig(patch: UpdateMemoryConfigRequest): Promise<boolean> {
  const resp = await fetchWithTimeout(
    '/api/memory/config',
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  return resp.ok;
}

export const memoryConfigPort: MemoryConfigPort = {
  patchConfig: patchMemoryConfig,
};

// ─── Entries/index cluster (real HTTP) ──────────────────────────────────────

/**
 * `entries` drives the saved-memory list; `rootDir`/`index`/`enabled` are
 * consumed directly (no fallback) by `useMemoryEntries.reload()` and
 * `useMemoryConfig.hydrate()`.
 *
 * BUG FIX (ported from the pinned source with this fix applied — see
 * `packages/ui/source-map.md`): the pinned source validated only `entries`
 * here, even though `hydrate()`/`reload()` read `enabled`/`rootDir`/`index`
 * off this same response with no fallback. A malformed `200` like
 * `{ entries: [] }` passed validation and then silently hydrated those other
 * fields to `undefined`. Fixed the same way `fetchMemoryEntry()` below
 * already handles a missing required field: validate every field this
 * shared read path's callers actually trust unconditionally, and throw
 * instead of returning a response that looks like a legitimate empty state.
 * The four per-hook flags are deliberately NOT added to this list — they
 * keep their own established legacy-default semantics in `hydrate()`
 * (`list.xEnabled !== false`), so their absence is intentionally not a
 * transport failure.
 */
export async function fetchMemoryList(): Promise<MemoryListResponse> {
  const resp = await fetchWithTimeout('/api/memory', {}, { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
  if (!resp.ok) throw new Error(`Memory list request failed (${resp.status})`);
  const json = (await resp.json()) as MemoryListResponse;
  requiredField(json, 'entries', 'Memory list request');
  requiredField(json, 'rootDir', 'Memory list request');
  requiredField(json, 'index', 'Memory list request');
  requiredField(json, 'enabled', 'Memory list request');
  return json;
}

async function fetchMemoryTree(): Promise<MemoryTreeNode[]> {
  const resp = await fetchWithTimeout('/api/memory/tree', {}, { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
  if (!resp.ok) throw new Error(`Memory tree request failed (${resp.status})`);
  const json = (await resp.json()) as MemoryTreeListResponse;
  return requiredField(json, 'tree', 'Memory tree request');
}

async function fetchMemoryEntry(id: string): Promise<MemoryEntry | null> {
  const resp = await fetchWithTimeout(`/api/memory/${encodeURIComponent(id)}`, {}, { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
  // Only a genuine not-found maps to null. A 5xx or other transport failure
  // is not "this entry doesn't exist" — collapsing both into null would let
  // the caller silently render an empty preview or a no-op edit for what is
  // actually a required read that failed.
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Memory entry request failed (${resp.status})`);
  const json = (await resp.json()) as { entry?: MemoryEntry };
  return requiredNonNullField(json, 'entry', 'Memory entry request');
}

async function saveMemoryEntry(draft: DraftEntry): Promise<MemoryEntry | null> {
  const url = draft.id ? `/api/memory/${encodeURIComponent(draft.id)}` : '/api/memory';
  const resp = await fetchWithTimeout(
    url,
    { method: draft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) },
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  if (!resp.ok) return null;
  const json = (await resp.json()) as { entry?: MemoryEntry };
  return requiredNonNullField(json, 'entry', 'Memory entry save');
}

async function deleteMemoryEntry(id: string): Promise<boolean> {
  const resp = await fetchWithTimeout(
    `/api/memory/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  return resp.ok;
}

async function saveMemoryIndex(index: string): Promise<boolean> {
  const resp = await fetchWithTimeout(
    '/api/memory/index',
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }) },
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  return resp.ok;
}

export const memoryEntriesPort: MemoryEntriesPort = {
  fetchMemoryList,
  fetchMemoryTree,
  fetchMemoryEntry,
  saveMemoryEntry,
  deleteMemoryEntry,
  saveMemoryIndex,
};

// ─── Extraction history cluster (real HTTP) ─────────────────────────────────

async function fetchExtractions(): Promise<MemoryExtractionRecord[]> {
  const resp = await fetchWithTimeout('/api/memory/extractions', {}, { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
  if (!resp.ok) throw new Error(`Memory extractions request failed (${resp.status})`);
  const json = (await resp.json()) as MemoryExtractionsResponse;
  return requiredField(json, 'extractions', 'Memory extractions request');
}

async function deleteExtraction(id: string): Promise<boolean> {
  const resp = await fetchWithTimeout(
    `/api/memory/extractions/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  return resp.ok;
}

async function clearExtractionHistory(): Promise<boolean> {
  const resp = await fetchWithTimeout(
    '/api/memory/extractions',
    { method: 'DELETE' },
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  return resp.ok;
}

export const memoryExtractionsPort: MemoryExtractionsPort = {
  fetchExtractions,
  deleteExtraction,
  clearExtractionHistory,
};

// ─── Connectors cluster: fake catalogue + real browser bridges ─────────────

export interface FakeMemoryConnectorsPortOptions {
  connectors?: Connector[];
  suggestionResponse?: ConnectorMemorySuggestionResponse | null;
  /** Simulated network latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
}

/**
 * An in-memory test/demo double for the connector-catalogue transport (same
 * rationale as `features/connectors`' own `createFakeConnectorsPort`). Real
 * memory writes still go through the real `saveMemoryEntry` HTTP adapter
 * above — only the connector catalogue/status/suggest transport is faked.
 */
export function createFakeMemoryConnectorsPort(options: FakeMemoryConnectorsPortOptions = {}): MemoryConnectorsPort {
  let connectors = options.connectors ? options.connectors.map((c) => ({ ...c })) : [];
  const latencyMs = options.latencyMs ?? 0;
  const delay = <T>(value: T): Promise<T> =>
    latencyMs > 0 ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs)) : Promise.resolve(value);

  return {
    fetchMemoryConnectors() {
      return delay(connectors.map((c) => ({ ...c })));
    },
    fetchConnectorStatuses() {
      const statuses: ConnectorStatusMap = {};
      for (const c of connectors) {
        statuses[c.id] = { status: c.status, ...(c.accountLabel ? { accountLabel: c.accountLabel } : {}) };
      }
      return delay(statuses);
    },
    connectConnector(connectorId: string): Promise<ConnectorActionResult> {
      const idx = connectors.findIndex((c) => c.id === connectorId);
      if (idx === -1) {
        const created: Connector = {
          id: connectorId,
          name: connectorId,
          provider: DEFAULT_CONNECTOR_PROVIDER,
          category: 'Memory source',
          status: 'connected',
          tools: [],
        };
        connectors = [...connectors, created];
        return delay({ connector: { ...created }, auth: { kind: 'connected' } });
      }
      connectors[idx] = { ...connectors[idx]!, status: 'connected' };
      return delay({ connector: { ...connectors[idx]! }, auth: { kind: 'connected' } });
    },
    suggestConnectorMemories() {
      return delay(options.suggestionResponse ?? null);
    },
    saveMemoryEntry,
    readPendingConnectorAuthIds: readPendingConnectorAuthIdsFromSession,
    writePendingConnectorAuthIds: writePendingConnectorAuthIdsToSession,
    notifyConnectorsChanged,
  };
}

function readPendingConnectorAuthIdsFromSession(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(MEMORY_CONNECTOR_PENDING_AUTH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0));
  } catch {
    return new Set();
  }
}

function writePendingConnectorAuthIdsToSession(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    if (ids.size === 0) {
      window.sessionStorage.removeItem(MEMORY_CONNECTOR_PENDING_AUTH_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(MEMORY_CONNECTOR_PENDING_AUTH_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Session storage can be blocked; the in-memory state still works.
  }
}

const CONNECTORS_CHANGED_EVENT = 'jini:memory-connectors-changed';

/** Broadcasts a same-page `CustomEvent` other surfaces (e.g. a connectors
 *  manager panel) can listen for to refresh. Generic browser API, no
 *  backend-specific shape — a host that needs a real cross-TAB signal
 *  supplies its own `MemoryConnectorsPort.notifyConnectorsChanged`. */
function notifyConnectorsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CONNECTORS_CHANGED_EVENT));
}

export const memoryConnectorsPort: MemoryConnectorsPort = createFakeMemoryConnectorsPort();
