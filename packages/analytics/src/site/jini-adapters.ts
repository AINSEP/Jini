import type { BrowserAnalyticsSource, VisitorAnalyticsDeps } from "./contracts.js";
/** Host ports/presets around the shared ingestion engine; no normalization or buffer logic lives here. */
import {
  createFanOutAnalyticsSink,
  LocalBufferSink,
  type AnalyticsForwardLimiter,
  type AnalyticsForwardReport,
  type BoundAnalyticsForwarder,
  type AnalyticsPrivacyPolicy,
  type AnalyticsSaltContext,
  type IngestHitDeps,
  type IngestHitOptional,
} from "../index.js";
import type { AnalyticsSinkPort, IngestDeps } from "./ports.js";
import type { NormalizedHit } from "../index.js";

/**
 * Preserve bounded event bags (ADR-022 bounded-cost discipline: 20 keys and 200-char strings)
 * and 30-minute same-day sessions (ADR-035). A visit crossing a time-window edge gets two IDs;
 * true cross-window stitching is a later rollup/session-table concern.
 */
export const analyticsPrivacyPolicy: AnalyticsPrivacyPolicy = {
  maxEventPropCount: 20,
  maxEventPropStringLength: 200,
  sessionWindowMinutes: 30,
};

/** Existing HTTP dependencies retain the host clock, IDs and plugin hook ABI. */
export interface AnalyticsIngestRouteDeps<Request = unknown> extends IngestDeps, VisitorAnalyticsDeps<Request> {
  resolveWorkspaceForHost: (host: string) => Promise<string | null> | string | null;
  analyticsSeed: string;
  /**
   * Host-owned HKDF wire context: changing either string changes existing visitor/session hashes,
   * so the host defines it (byte-identical across releases) and this package never does.
   */
  saltContext: AnalyticsSaltContext;
  /**
   * Host reporter for vendor forward failures (forwarder id, outcome and message only — never the
   * hit or a payload). The host owns the channel and any line prefix.
   */
  reportForwardFailure: AnalyticsForwardReport;
  browserAnalytics?: BrowserAnalyticsSource;
  /**
   * Per-request vendor forwarders (site `core.analytics.sink` + visitor consent, `forwarding.ts`).
   * Absent or empty → the built-in sink alone, exactly the pre-forwarding path.
   */
  forwarders?: (required: { request: unknown }) => Promise<readonly BoundAnalyticsForwarder[]>;
  vendorHooksAllowed?: (required: { request: Request }) => Promise<boolean>;
}

/**
 * Convert host ports to the package's object arguments and supply explicit host policy/context.
 * Hooks receive only normalized hits; adapter failures propagate to the HTTP error boundary.
 * `optional.forwarders` (already consent-checked for this request) receive minimised hits after
 * the built-in sink accepts; their failures go to the host's `reportForwardFailure`, never propagated.
 * `optional.limiter` is the route's shared in-flight cap (sinks are built per request, so the cap
 * must outlive them).
 * @returns Required Jini deps and separate optional hooks, without invoking any port.
 * @example const { deps, optional } = createAnalyticsIngestBinding({ deps: hostDeps });
 * @complexity O(1).
 */
export function createAnalyticsIngestBinding<Request>(
  required: { deps: AnalyticsIngestRouteDeps<Request> },
  optional: { forwarders?: readonly BoundAnalyticsForwarder[]; limiter?: AnalyticsForwardLimiter; skipHooks?: boolean } = {},
): { deps: IngestHitDeps; optional: IngestHitOptional } {
  const host = required.deps;
  const hooks = optional.skipHooks ? undefined : host.hooks;
  // The host's built-in sink stays the awaited primary; forwarders are detached and isolated.
  const sink = createFanOutAnalyticsSink({
    primary: {
      capabilities: () => host.sink.capabilities(),
      accept: ({ hit }) => host.sink.accept({ hit }),
      acceptBatch: ({ hits }) => host.sink.acceptBatch({ hits }),
      list: (_required, listOptional) => host.sink.list({}, listOptional),
    },
  }, { forwarders: optional.forwarders ?? [], report: host.reportForwardFailure, ...(optional.limiter ? { limiter: optional.limiter } : {}) });
  return {
    deps: {
      config: host.config,
      sink,
      resolveWorkspaceForHost: ({ host: siteHost }) => host.resolveWorkspaceForHost(siteHost),
      rootKeySeed: host.analyticsSeed, // site-key-legacy: installed @jini-ai/analytics seed field; remove on/after 2026-11-01
      saltContext: host.saltContext,
      privacyPolicy: analyticsPrivacyPolicy,
    },
    optional: hooks ? { hooks: { beforeIngest: ({ hit }) => hooks.beforeIngest({ hit }) } } : {},
  };
}

/**
 * Adapt Jini's process-local buffer to the host sink port and inspection getter.
 * The package owns copying, list bounds/order and durable=false; SQL adapters keep the same port.
 * @returns A fresh buffer adapter; contents disappear on process restart.
 * @example const sink = createLocalAnalyticsSink({}, { initialHits: [] });
 * @complexity O(n) for n initial hits; subsequent costs are those of LocalBufferSink.
 */
export function createLocalAnalyticsSink(
  _required: Record<string, never>,
  optional: { initialHits?: readonly NormalizedHit[] } = {},
): AnalyticsSinkPort & { all(): NormalizedHit[] } {
  // Deleted repo.memory.ts/LocalBufferSink fork: @jini-ai/analytics owns the implementation (DELETED-CODE.md).
  const sink = new LocalBufferSink({}, optional);
  return {
    capabilities: () => sink.capabilities({}),
    accept: ({ hit }, _optional = {}) => sink.accept({ hit }),
    acceptBatch: ({ hits }, _optional = {}) => sink.acceptBatch({ hits }),
    list: (_required, optional = {}) => sink.list({}, optional),
    all: () => sink.all({}),
  };
}
