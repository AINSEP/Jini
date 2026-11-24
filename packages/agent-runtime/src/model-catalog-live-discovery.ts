import { createHash } from "node:crypto";
import { type ProviderModelOption } from "@jini-ai/core/contracts/agents";
import type { Clock } from "@jini-ai/core/primitives";
import { listProviderModels } from "./providers/model-catalog.js";
import { ModelCatalogCache, unionModels as unionModelCatalog } from "./model-catalog-cache.js";

/**
 * @file Live model discovery for a Local CLI picker's `claude` entry — the enrichment step a host's
 * `GET /api/agents` handler calls before responding (design: the host's local-CLI live model
 * discovery design, §3.1/§3.5).
 *
 * Two independent concerns, deliberately not folded into one function:
 * - {@link LiveModelDiscovery.getLiveClaudeModels} — the "never a gate" credential branch. Resolves the
 *   principal's own stored execution credential (through the host-injected `resolveCredential`) and
 *   returns immediately, with NO network call, whenever there is no credential, no key, or a protocol
 *   other than `anthropic`. Only a resolved `anthropic` credential reaches the cache/network path below.
 * - The in-memory TTL cache — wraps ONLY the `listProviderModels` call, not the credential check
 *   (that check is a single cheap repo read + decrypt in a typical host, so caching it buys nothing
 *   and would only obscure the "zero network calls" property under a cache hit/miss branch). Sized
 *   so a busy admin dock (mount, tab switch back to the dock) doesn't reissue a live HTTPS call on
 *   every `/api/agents` load — see the design doc's Risks §5 for the accepted staleness window this
 *   trades for that.
 *
 * {@link unionModels} is the §3.5 merge policy: fallback entries (including the `sonnet`/`opus`/
 * `haiku` aliases and the `'default'` sentinel) are ALWAYS present, unconditionally — this function
 * has no code path that can drop one. Live-discovered ids are appended only when not already
 * present, deduped by `id`.
 */

/** How long one successful-or-failed live call is trusted before the next request re-issues it.
 *  Deliberately minutes, not seconds: installing/rotating a stored key is a deliberate admin
 *  action, not one that needs sub-minute staleness (design doc §3.1's own reasoning). */
const LIVE_MODEL_CACHE_TTL_MS = 5 * 60_000;

/** The slice of a host's stored execution credential live discovery reads. */
export interface LiveModelCredential {
  readonly protocol: string;
  readonly apiKey: string;
  /** Null/absent falls back to the host-injected `defaultBaseUrl`. */
  readonly baseUrl?: string | null;
  readonly providerId?: string | null;
}
/** The client-safe projection a live entry is reduced to; a host's fallback entries may carry more. */
export interface LiveModelSummary { readonly id: string; readonly label: string }
/** The tenant tuple a credential (and therefore a cache slot) belongs to. */
export interface LiveModelKey { workspaceId: string; principalId: string }
interface DiscoveryOutcome {
  readonly models: readonly ProviderModelOption[];
}
export interface LiveModelDiscovery {
  /**
   * Resolves the admin's stored execution credential for `(workspaceId, principalId)` and, only
   * when it is a usable `anthropic` credential, returns Claude's live model catalog (cached — see
   * this file's header). Returns `null` for every other outcome: no row, no key, wrong protocol, or
   * a failed/timed-out live call. `null` is not an error signal — the caller's contract
   * (`unionModels`) is to treat it as "nothing to enrich with" and leave the static fallback list
   * exactly as it was, which is what makes this a strict enrichment layer rather than a dependency
   * the picker can be blocked or degraded by.
   *
   * No network call is made at all on the `null`/wrong-protocol paths — verified directly by the
   * tests stubbing `globalThis.fetch` to throw. That is the "never a gate" invariant a
   * Max-subscription admin with no stored key depends on: zero added latency, by construction, not
   * by a cache that merely answers fast.
   *
   * @complexity O(1) plus, at most, one cached network call.
   */
  getLiveClaudeModels(key: LiveModelKey): Promise<readonly ProviderModelOption[] | null>;
}

/** Creates one host-owned discovery/cache instance; generic cache and its rationale now live in
 * `./model-catalog-cache.ts` (`@jini-ai/agent-runtime/model-catalog/cache`). The in-flight call itself is shared so concurrent
 * requests in a TTL window issue one provider call, rather than caching only its eventual value.
 * Successes and failures keep the same five-minute TTL; credentials are resolved before each read.
 * A host may be multi-workspace: delimiter-joined `${workspaceId}:${principalId}` keys would alias
 * tenants if either ID contained `:`. The package encodes the full tuple structurally, including
 * credential and endpoint scope. SHA-256 fingerprints invalidate rotation without retaining a raw key
 * in cache keys. A result wrapper preserves the distinction between a successful empty catalog and failure.
 * The host injects `resolveCredential` (its own credential store read + decrypt) and
 * `defaultBaseUrl` (its provider catalog's Anthropic endpoint).
 */
export function createLiveModelDiscovery(
  { resolveCredential, defaultBaseUrl, clock, discover }: {
    resolveCredential: (key: LiveModelKey) => Promise<LiveModelCredential | null>;
    defaultBaseUrl: string;
    clock: Clock;
    discover: (required: { apiKey: string; baseUrl: string }) => Promise<readonly ProviderModelOption[] | null>;
  },
  { ttlMs = LIVE_MODEL_CACHE_TTL_MS }: { ttlMs?: number } = {},
): LiveModelDiscovery {
  const cache = new ModelCatalogCache<DiscoveryOutcome>({
    clock,
    // Each get supplies a discovery closure AFTER resolving that principal's credential. This
    // required default is fail-closed if a future caller forgets that closure; it never does I/O.
    discover: async () => null,
    merge: ({ live }) => live,
  }, { ttlMs });
  return {
    async getLiveClaudeModels(key) {
      const stored = await resolveCredential(key);
      if (!stored || stored.protocol !== "anthropic" || !stored.apiKey.trim()) return null;
      const baseUrl = stored.baseUrl ?? defaultBaseUrl;
      const credentialFingerprint = createHash("sha256").update(stored.apiKey).digest("hex");
      const outcomes = await cache.get({
        cacheKey: [key.workspaceId, key.principalId, stored.protocol, stored.providerId ?? "", baseUrl, credentialFingerprint],
        fallback: [],
      }, {
        discover: async () => {
          const models = await discover({ apiKey: stored.apiKey, baseUrl });
          return models === null ? null : [{ models }];
        },
      });
      return outcomes[0]?.models ?? null;
    },
  };
}

/**
 * The one network call this module makes, isolated so {@link LiveModelDiscovery.getLiveClaudeModels} stays
 * readable. `listProviderModels` returns expected auth, network, timeout and malformed-response failures
 * as `{ok: false, ...}`. The package cache also catches unexpected discovery rejections and records
 * a null result for the same TTL, so a rejected promise never poisons the slot.
 *
 * Logs on `!result.ok` — deliberately the ONLY log line in this module. A live call only reaches
 * this function once {@link LiveModelDiscovery.getLiveClaudeModels} has already resolved a real `anthropic`
 * credential, so a failure here means an admin who set up BYOK for Claude is silently getting the
 * static fallback list instead of the live one they configured — worth an operator seeing, unlike
 * the no-credential/wrong-protocol paths (expected, quiet by design). One line, not a stack: the
 * `listProviderModels` result already redacts the key (`redactSecrets`), so `result.detail` is
 * safe to log as-is.
 *
 * @complexity O(1) local work; one outbound HTTPS call bounded by `listProviderModels`'s own
 *   12s timeout.
 */
export async function fetchLiveClaudeModels(
  { apiKey, baseUrl, warn }: {
    apiKey: string;
    baseUrl: string;
    /** Receives the one failure line. Injected so the host owns its log sink and any log-line
     *  prefix; the engine never writes to the console. */
    warn: (message: string) => void;
  },
  { listModels = listProviderModels }: { listModels?: typeof listProviderModels } = {},
): Promise<readonly ProviderModelOption[] | null> {
  const result = await listModels({ protocol: "anthropic", baseUrl, apiKey });
  if (!result.ok) {
    const detail = result.detail ? `: ${result.detail}` : "";
    warn(`live Claude model discovery failed (${result.kind}${detail}) — falling back to the static model list`);
    return null;
  }
  return result.models ?? null;
}

/**
 * Merges a live-discovered model list into the static fallback list, per design doc §3.5: UNION,
 * never replace. `fallback` is always fully present in the result, in its original order — there
 * is no code path here that can drop the `'default'` sentinel or the bare `sonnet`/`opus`/`haiku`
 * aliases, because nothing is ever removed from it. `live` entries are appended in their given
 * order, skipping any `id` already present (from `fallback` or an earlier `live` entry).
 *
 * @complexity O(f + l) where f/l are the fallback/live list lengths — one `Set` built from
 *   `fallback`, one pass over `live`.
 */
export function unionModels<Model extends LiveModelSummary>(
  { fallback, live }: { fallback: readonly Model[]; live: readonly ProviderModelOption[] },
  _optional: Record<string, never> = {},
): (Model | LiveModelSummary)[] {
  // Preserve the client-safe projection: fallback metadata survives, while discovered entries
  // expose only the model ID and label. Deduplication/order belong to the package merger.
  return unionModelCatalog<Model | LiveModelSummary>({ fallback, live: live.map(({ id, label }) => ({ id, label })) });
}
