import { useMemo } from "react";
import { orFallback } from "@jini-ai/core/errors/idioms";
import type { ChatPaneAgent } from "../../../../react/kit.js";

import type { AdminHttp } from "../../../lib/admin-http/request.js";
import type { AdminHttpError } from "@jini-ai/core/admin-runtime";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { useAdminBootScope } from "../../../lib/admin-boot-scope.js";
import type { CachedLoader } from "@jini-ai/core/fetch";

/**
 * Mirrors `lib/api.ts`'s `DEFAULT_REQUEST_TIMEOUT_MS` (60s). `listAgents`/`rescanAgents`/
 * `daemonOnline` below bypass that shared `request()` seam entirely — `/api/agents` is not under
 * `request()`'s `/api/admin/v1` base path — so without their own bound they can hang forever under
 * the same per-origin connection-pool exhaustion `api.ts`'s own `REQUEST_TIMEOUT_CODE` doc
 * describes (every open admin tab keeps one `EventSource` connection open forever; see
 * `lib/settings-events.ts`).
 */

/**
 * `ChatPaneAgent` plus the one extra, the host-only field `GET /api/agents` actually serializes for
 * each entry — `host src/assistant/agents.ts`'s `AssistantAgentSummary.carriesOwnMemory`.
 * `@jini-ai/chat`'s own `ChatPaneAgent` type never declares it (it's a the host transport decision, not
 * a `@jini-ai/chat` concern), so this widened alias exists purely so this file can read it off the
 * same response `fetchAgents`/`rescanAgents` already fetch, without a second request.
 */
type AgentWithMemoryFlag = ChatPaneAgent & { carriesOwnMemory?: boolean };

/**
 * The pure half of {@link fetchAgents}/`useRuntimeAccess`'s `rescanAgents`: which agentIds are
 * resume-capable, from an already-fetched `/api/agents` payload. Split out so it's directly
 * testable against a plain fixture — no `fetch` mock, no module-state reset, required.
 */
export function extractResumeCapableAgentIds(agents: readonly AgentWithMemoryFlag[]): ReadonlySet<string> {
  return new Set(agents.filter((agent) => agent.carriesOwnMemory === true).map((agent) => agent.id));
}

/**
 * The last resume-capable agentId set observed from `/api/agents` — instance-owned, same "outlive
 * the component, read fresh per call" shape the provider cache above uses. This is the
 * live binding `useAssistantTransport`'s `getResumeCapableAgentIds` option reads through
 * {@link getResumeCapableAgentIds} below.
 *
 * Starts empty: before the first `/api/agents` response resolves, every agentId fails open to the
 * full-transcript path — see `assistant-transport.ts`'s `CreateAssistantTransportOptions
 * .getResumeCapableAgentIds` doc for why "not yet known" must mean "send everything," not "send
 * only the latest message."
 */
/** Test seam — same purpose as `execution-settings.ts`'s `resetLocalAgentDetectionCache`: the
 *  injected state persists across cases in a file, so a suite asserting on it needs to start cold. */
export function resetResumeCapableAgentIds({ resumeCapableAgentIds }: Parameters<typeof getResumeCapableAgentIds>[0]): void {
  resumeCapableAgentIds.current = new Set();
}

/**
 * {@link useAssistantTransport}'s `getResumeCapableAgentIds` — bound by the host to its instance (same
 * "never captured by value" shape `isAgUiTransportEnabled` already has for `getAgUiEnabled`) so the
 * memoized transport always reads the CURRENT set, not whatever was live when it was built.
 *
 * Exported for the same reason {@link extractResumeCapableAgentIds} is: a test asserting that
 * `listAgents`/`rescanAgents` actually populated the instance state needs a way to read it back.
 */
export function getResumeCapableAgentIds({ resumeCapableAgentIds }: { resumeCapableAgentIds: { current: ReadonlySet<string> } }): ReadonlySet<string> {
  return resumeCapableAgentIds.current;
}

/** Records one fresh inventory everywhere that reads it: the resume-capable set the transport
 *  consults, and the localStorage placeholder for the next cold load. Called on what the cache
 *  settles on, not inside {@link fetchAgents}: a GET that was in flight across a rescan answers
 *  with the older list, which must not overwrite what the rescan recorded. */
export function recordAgents<T extends readonly AgentWithMemoryFlag[]>(
  { agents, writeAgentsSnapshot, resumeCapableAgentIds }: { agents: T; resumeCapableAgentIds: Parameters<typeof getResumeCapableAgentIds>[0]["resumeCapableAgentIds"]; writeAgentsSnapshot: (required: { agents: readonly ChatPaneAgent[] }) => void }, _options: Record<string, never> = {},
): T {
  resumeCapableAgentIds.current = extractResumeCapableAgentIds(agents);
  writeAgentsSnapshot({ agents });
  return agents;
}

/**
 * Reads one `/api/agents` (or rescan) response as an inventory, or throws when it is not one.
 *
 * Throws, never resolves `[]`, for both a non-2xx status and an empty list: `ChatPane` reads a
 * RESOLVED list as a finished detection and shows "No usable CLI is selected" when nothing in it is
 * usable, while a REJECTION tells it there is no answer yet, so it shows "Connecting to the
 * assistant…" and retries. The empty case matters because the server lists every CLI it knows
 * (`host src/assistant/agents.ts`, available or not), so `[]` only ever comes from a daemon
 * that is mid-restart — resolving it once cached it (`staleTime: Infinity`) until a hard reload.
 * Throwing also keeps it out of the query cache and the localStorage snapshot.
 */
async function readAgentsResponse(
  { inventory: { agents }, label }: { inventory: { agents?: AgentWithMemoryFlag[] }; label: string },
  _options: Record<string, never> = {},
): Promise<AgentWithMemoryFlag[]> {
  if (!Array.isArray(agents) || agents.length === 0) throw new Error(`${label} answered with no agents`);
  return agents;
}

export async function fetchAgents({ request, agentsUrl, fetchTimeoutMs, ApiError }: { request: AdminHttp<AdminHttpError, string, string>["authenticatedAdminRequest"]; agentsUrl: string; fetchTimeoutMs: number; ApiError: new (required: { message: string; status: number }, optional?: { code?: string | undefined; body?: Record<string, unknown> }) => AdminHttpError }, _optional: Record<string, never> = {}): Promise<ChatPaneAgent[]> {
  const inventory = await request<{ agents?: AgentWithMemoryFlag[] }>({ path: "", method: "GET" }, {
    basePath: agentsUrl,
    requireJson: true,
    signal: AbortSignal.timeout(fetchTimeoutMs),
    errorFactory: ({ error }) => new ApiError({ message: `GET ${agentsUrl} answered ${error.status}`, status: error.status }, { code: error.code, ...(error.body === undefined ? {} : { body: error.body }) }),
  });
  return readAgentsResponse({ inventory, label: `GET ${agentsUrl}` });
}

/** The client-side cache key for `/api/agents`, scoped to the current admin boot below. */
const AGENTS_QUERY_KEY = ["assistant", "agents"] as const;

// Match Jini packages/agent-runtime/src/model-discovery.ts:8; its export requires Node APIs.
const AGENTS_STALE_TIME_MS = 15 * 60_000;
const AGENTS_RETRY_TIME_MS = 30_000;
const AGENTS_PENDING_DELAYS_MS = [1_000, 2_000, 4_000] as const;

/** The agents `CachedLoader` plus the accepted snapshot's refresh deadline. */
export type AgentsLoader = CachedLoader<ChatPaneAgent[]> & { refreshAt(): number | undefined };

// Keys are snapshots owned by the boot-scoped query cache, so deadlines cannot leak across boots.
const agentsDeadlines = new WeakMap<ChatPaneAgent[], { expiresAt: number; pendingStep: number }>();

/** Records the server catalog's lifetime, capped at the browser's 15-minute maximum.
 * Pending snapshots advance through a short backoff before the normal failure cooldown.
 * Completed snapshots retaining an expired catalog use the 30-second retry cooldown. */
function rememberAgentsDeadline(
  { agents, pendingStep = 0, clock }: { agents: ChatPaneAgent[]; pendingStep?: number; clock: () => number },
  _options: Record<string, never> = {},
): void {
  const now = clock();
  const pending = agents.some(agent => agent.discoveryPending);
  const lifetime = pending ? (AGENTS_PENDING_DELAYS_MS[pendingStep] ?? AGENTS_RETRY_TIME_MS) : AGENTS_STALE_TIME_MS;
  const expiresAt = pending ? now + lifetime : agents.reduce((deadline, agent) => {
    if (!agent.modelCatalog || agent.discoveryPending) return deadline;
    const catalogExpiry = Date.parse(agent.modelCatalog.expiresAt);
    const failureDeadline = agent.modelCatalog.freshness === "fresh" ? deadline : now + AGENTS_RETRY_TIME_MS;
    const catalogDeadline = catalogExpiry <= now ? now + AGENTS_RETRY_TIME_MS : catalogExpiry;
    return Math.min(deadline, failureDeadline, Number.isFinite(catalogDeadline) ? catalogDeadline : failureDeadline);
  }, now + lifetime);
  agentsDeadlines.set(agents, { expiresAt, pendingStep: pending ? pendingStep + 1 : 0 });
}

/** Writes a fresh inventory into the cache and everything that reads it. */
export function replaceAgents({ loader, agents, clock, writeAgentsSnapshot, resumeCapableAgentIds }: { resumeCapableAgentIds: Parameters<typeof getResumeCapableAgentIds>[0]["resumeCapableAgentIds"]; loader: CachedLoader<ChatPaneAgent[]>; agents: ChatPaneAgent[]; clock: () => number; writeAgentsSnapshot: Parameters<typeof recordAgents>[0]["writeAgentsSnapshot"] }, _options: Record<string, never> = {}): ChatPaneAgent[] {
  recordAgents({ agents, writeAgentsSnapshot, resumeCapableAgentIds });
  loader.replace({ value: agents });
  rememberAgentsDeadline({ agents: loader.peek() ?? agents, clock });
  return agents;
}

/** A rescan: the POST's answer replaces the cached list; when the POST gives no usable answer, a
 *  cache-bypassing GET does instead. When both fail it rejects without touching the cache, so a
 *  failed rescan never overwrites a good inventory (`ChatPane` keeps showing the last good list). */
export async function rescanAgentsInto(
  { loader, request, agentsUrl, fetchTimeoutMs, ApiError, clock, writeAgentsSnapshot, resumeCapableAgentIds }: { resumeCapableAgentIds: Parameters<typeof getResumeCapableAgentIds>[0]["resumeCapableAgentIds"]; loader: CachedLoader<ChatPaneAgent[]>; request: Parameters<typeof fetchAgents>[0]["request"]; agentsUrl: string; fetchTimeoutMs: number; ApiError: Parameters<typeof fetchAgents>[0]["ApiError"]; clock: () => number; writeAgentsSnapshot: Parameters<typeof recordAgents>[0]["writeAgentsSnapshot"] }, _options: Record<string, never> = {},
): Promise<ChatPaneAgent[]> {
  const inventory = await request<{ agents?: AgentWithMemoryFlag[] }>({ path: "/rescan", method: "POST" }, {
    basePath: agentsUrl,
    requireJson: true,
    signal: AbortSignal.timeout(fetchTimeoutMs),
    errorFactory: ({ error }) => new ApiError({ message: `POST ${agentsUrl}/rescan answered ${error.status}`, status: error.status }, { code: error.code, ...(error.body === undefined ? {} : { body: error.body }) }),
  }).catch((error: unknown) => {
    // Fall back on an unusable response; a failed/canceled fetch still rejects as before.
    if ((error instanceof ApiError && error.status > 0) || error instanceof SyntaxError) return null;
    throw error;
  });
  // An empty rescan is normal during daemon restart; the fresh GET below retries it.
  const rescanned = inventory === null ? null : await orFallback({ work: () => readAgentsResponse({ inventory, label: `POST ${agentsUrl}/rescan` }), fallback: null, step: "Decode rescanned agents" });
  return replaceAgents({ loader, agents: rescanned ?? (await fetchAgents({ request, agentsUrl, fetchTimeoutMs, ApiError })), clock, writeAgentsSnapshot, resumeCapableAgentIds });
}

/** Shares GET ownership through Jini's boot-scoped cache; accepted snapshot deadlines govern reads.
 * Structural sharing can publish a different array from the transport result. Overlapping readers
 * and late pre-Rescan GETs must not extend a newer snapshot's deadline. Exposes that same deadline
 * so pane retries can wait out a pending cooldown instead of spending their budget on cached reads. */
export function useAgentsLoader(
  { useBootScope, useLoader, fetchAgents, clock }: {
    useBootScope: typeof useAdminBootScope; useLoader: FetchQueryAdapter["useCachedLoader"];
    fetchAgents: () => Promise<ChatPaneAgent[]>; clock: () => number;
  },
  _optional: Record<string, never> = {},
): AgentsLoader {
  const { queryScope } = useBootScope();
  const key = useMemo(() => [...AGENTS_QUERY_KEY, queryScope], [queryScope]);
  const loader = useLoader({ key, fetch: fetchAgents }, { staleTime: AGENTS_STALE_TIME_MS });
  return useMemo(() => createAgentsLoader({ loader, clock }), [loader, clock]);
}

/** {@link useAgentsLoader}'s deadline rules over any `CachedLoader` — the hook passes the provider's,
 *  a test a plain object. `CachedLoader.peek` may answer `undefined` (its contract promises nothing
 *  more), so each read of the accepted snapshot falls back to the array this call itself holds. */
export function createAgentsLoader({ loader, clock }: { loader: CachedLoader<ChatPaneAgent[]>; clock: () => number }, _optional: Record<string, never> = {}): AgentsLoader {
  return {
    peek: loader.peek,
    replace: loader.replace,
    refreshAt: () => {
      const cached = loader.peek();
      return cached && agentsDeadlines.get(cached)?.expiresAt;
    },
    load: () => {
      const cached = loader.peek();
      const previous = cached && agentsDeadlines.get(cached);
      if (cached && previous && clock() < previous.expiresAt) return Promise.resolve(cached);
      // Bypass freshness only for a due read; retain idle data and join requests without invalidation.
      return loader.load(undefined, { staleTime: 0 }).then(agents => {
        const accepted = loader.peek() ?? agents;
        if (!agentsDeadlines.has(accepted) || agentsDeadlines.get(accepted) === previous) {
          rememberAgentsDeadline({ agents: accepted, pendingStep: previous?.pendingStep ?? 0, clock });
        }
        return accepted;
      }, error => {
        if (cached && agentsDeadlines.get(cached) === previous) {
          agentsDeadlines.set(cached, { expiresAt: clock() + AGENTS_RETRY_TIME_MS, pendingStep: previous?.pendingStep ?? 0 });
        }
        throw error;
      });
    },
  };
}

/**
 * In-flight `daemonOnline()` reads share each runtime-access instance's pending probe so its
 * overlapping callers reuse one transport instead of each starting their own fetch. Health checks
 * bypass the provider's connectivity gate: the browser's internet flag says nothing about the local daemon.
 *
 * `@jini-ai/chat/react`'s `useChatPaneRuntimeInventory` polls `daemonOnline` on a bare
 * `window.setInterval` every 5s while the tab is visible (0.3.11+ pauses it while hidden), and its
 * own de-dup (`useLatestOperation`) only ignores a STALE RESULT — it never
 * aborts the underlying fetch. Under connection-pool exhaustion, a `fetch` that queues forever
 * previously meant a brand new permanently-stuck request was added on every single tick, an
 * unbounded leak for as long as the tab stayed open (see
 * `ADS-memory/reports/2026-08-17-vite-proxy-pool-saturation-investigation.md`). Reusing one
 * in-flight promise caps that cost at one connection per runtime-access instance, the same fixed
 * cost the settings-events SSE already holds, instead of growing without bound.
 */
export async function readDaemonOnline(
  { fetch, agentsUrl, fetchTimeoutMs }: { fetch: typeof globalThis.fetch; agentsUrl: string; fetchTimeoutMs: number }, _options: Record<string, never> = {},
): Promise<boolean> {
  const response = await fetch(agentsUrl, {
    credentials: "same-origin",
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  return response.ok;
}

