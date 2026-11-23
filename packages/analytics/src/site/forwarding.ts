import {
  cacheAnalyticsProviderLoad, composeBeforeIngestHooks, DEFAULT_ANALYTICS_PROVIDERS_TTL_MS, LOCAL_ANALYTICS_SINK_ID, selectAnalyticsForwarder,
  type AnalyticsForwarderCredential, type AnalyticsForwarderModule, type AnalyticsHooks as EngineAnalyticsHooks,
  type BoundAnalyticsForwarder,
} from "@jini-ai/analytics";
import type { Clock as ClockPort, HttpClientPort as EngineHttpClientPort } from "@jini-ai/core/primitives";
import { orFallback } from "@jini-ai/core/errors/idioms";
import type { ProviderRegistry } from "@jini-ai/core/provider-registry";
import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
import type { AnalyticsConfigPort, AnalyticsHooks } from "./ports.js";

/**
 * @file Site wiring for analytics vendor forwarding and `beforeIngest` hooks
 * (the host's `.cloud-coord/analytics-DESIGN.md`). The mechanism — registry, fan-out sink, hook chain, the
 * minimised forwarded hit — is `@jini-ai/analytics`; this file only decides, per beacon request,
 * WHICH forwarder (if any) the site's `core.analytics.sink` names and WHETHER this visitor's
 * cookie consent allows it, and binds the vendor to its credential.
 *
 * Every function here fails toward NOT sending data to a vendor and never throws into the beacon:
 * the built-in sink must keep receiving hits whatever a vendor, plugin or credential does.
 *
 * Every warning goes through the host's REQUIRED `warn` reporter as a plain message: the host owns
 * the log channel and any line prefix, so this package never logs on its own.
 */

/** What forwarding needs from the plugin-contributed provider set. */
export interface AnalyticsProviderSet {
  readonly forwarders: ProviderRegistry<AnalyticsForwarderModule>;
  readonly hooks: readonly EngineAnalyticsHooks[];
  readonly refusals: readonly string[];
}

/** Re-read cadence for plugin providers; the rationale lives with the engine default. */
export const ANALYTICS_PROVIDERS_TTL_MS = DEFAULT_ANALYTICS_PROVIDERS_TTL_MS;

/**
 * Host binding of the engine's `cacheAnalyticsProviderLoad` (TTL memo; a failed load is not
 * cached): refusals are reported once per successful load, through the host's warn.
 * @complexity O(1) per call; one plugin load per TTL window.
 */
export function cacheAnalyticsProviders(
  required: { load: () => Promise<AnalyticsProviderSet>; clock: Pick<ClockPort, "nowMs">; warn: (message: string) => void },
  optional: { ttlMs?: number } = {},
): () => Promise<AnalyticsProviderSet> {
  const { load, clock, warn } = required;
  const { ttlMs = ANALYTICS_PROVIDERS_TTL_MS } = optional;
  return cacheAnalyticsProviderLoad({ load, clock }, {
    ttlMs,
    onLoad: (set) => { for (const refusal of set.refusals) warn(refusal); },
  });
}

export interface AnalyticsForwardingRequired<R> {
  workspaceId: string;
  config: AnalyticsConfigPort;
  loadProviders: () => Promise<AnalyticsProviderSet>;
  /** The site's cookie-consent decision for this request's visitor (the consent engine's own reader). */
  consentAllowsAnalytics: (required: { request: R }) => Promise<boolean>;
  /** Resolves a vendor key from the host credential store; null when none is saved. */
  resolveCredential: (required: { label: string }) => Promise<AnalyticsForwarderCredential | null>;
  httpClient: EngineHttpClientPort;
  /** The host's warn reporter; receives plain messages (no prefix) and never key material. */
  warn: (message: string) => void;
}

/** The forwarder this site names and this visitor allows, or none. @complexity O(1) + I/O. */
async function resolveForwarders<R>({ required, request }: { required: AnalyticsForwardingRequired<R>; request: R }, _optional = {}): Promise<BoundAnalyticsForwarder[]> {
  const { sink } = await required.config.get({ workspaceId: required.workspaceId });
  // "local" (or unset) is decided before any plugin load: the built-in-only path costs nothing.
  if (sink === "" || sink === LOCAL_ANALYTICS_SINK_ID) return [];
  const { forwarders } = await required.loadProviders();
  const { entry, warning } = selectAnalyticsForwarder({ registry: forwarders, sinkId: sink });
  if (warning) required.warn(warning);
  if (!entry || !(await required.consentAllowsAnalytics({ request }))) return [];
  const label = entry.provider.credentialLabel;
  const credential = label === undefined ? null : await required.resolveCredential({ label });
  if (label !== undefined && credential === null) {
    required.warn(`analytics sink '${entry.id}' has no saved "${label}" credential; hits stay in the built-in sink only`);
    return [];
  }
  const forwarder = entry.provider.create({ credential, kit: { httpClient: required.httpClient } });
  return [{ id: entry.id, forwarder, context: { workspaceId: required.workspaceId, mode: "live" } }];
}

/**
 * Builds the per-request forwarder resolver the beacon route hands to the fan-out sink.
 * `"local"` short-circuits before any plugin load or consent read. Any failure → no forwarders.
 * @complexity O(1) per request: one cached config read, one cached provider load, at most one
 * consent receipt read and one credential read.
 */
export function createAnalyticsForwarding<R>(
  required: AnalyticsForwardingRequired<R>,
  _optional: Record<string, never> = {},
): (required: { request: R }) => Promise<readonly BoundAnalyticsForwarder[]> {
  return async ({ request }) => {
    try {
      return await resolveForwarders({ required, request });
    } catch (error) {
      // Fixed text: a vendor constructor or credential read may throw with the key in its message.
      required.warn(`vendor forwarding skipped: resolution failed Cause: ${describeErrorForLog({ err: error })}`);
      return [];
    }
  };
}

/**
 * Host-shaped (`beforeIngest({ hit })`) hooks over the plugin-contributed chain. The chain is read per
 * hit through the cached loader, so hooks need no boot-time await; with no handlers (or a failed
 * load) the hit passes through unchanged — exactly the hook-free path.
 * @complexity O(h) handlers per hit.
 */
export function createPluginAnalyticsHooks(
  required: { loadProviders: () => Promise<AnalyticsProviderSet>; warn: (message: string) => void },
  _optional: Record<string, never> = {},
): AnalyticsHooks {
  const report = ({ index, message }: { index: number; message: string }) => required.warn(`beforeIngest hook #${index} failed and was skipped: ${message}`);
  return {
    beforeIngest: async ({ hit }, _optional = {}) => {
      const hooks = await orFallback({ work: async () => (await required.loadProviders()).hooks, fallback: null, step: "Read analytics enrichment hooks" });
      if (hooks === null) return hit;
      const chain = composeBeforeIngestHooks({ hooks }, { report });
      return chain ? chain.beforeIngest({ hit }) : hit;
    },
  };
}
