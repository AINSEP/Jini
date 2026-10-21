/**
 * Vendor forwarding: the write-only provider contract that lets a host send normalized hits to an
 * external analytics vendor (Plausible / PostHog / GA4-style) next to its built-in sink.
 *
 * Two roles, deliberately not one: the host's built-in sink stays the PRIMARY `AnalyticsSinkPort`
 * (it is the only thing dashboards and recent-hits read), and vendors are FORWARDERS. A vendor can
 * therefore never become the primary, so switching or removing one never loses or hides local data.
 */
import type { HttpClientPort } from "@jini-ai/core/primitives";
import {
  createProviderRegistry, type ProviderContext, type ProviderDefinition, type ProviderRegistry, type ProviderResult, type RegisteredProvider,
} from "@jini-ai/core/provider-registry";
import type { AnalyticsHooks, AnalyticsSinkPort } from "./ports.js";
import type { NormalizedHit } from "./types.js";

/** Registry contract name; plugin contributions must declare the same string. */
export const ANALYTICS_FORWARDER_CONTRACT = "analytics.forwarder";

/** Registry contract name for plugin-contributed `beforeIngest` handlers. */
export const ANALYTICS_INGEST_HOOK_CONTRACT = "analytics.ingest_hook";

/** Setting value meaning "built-in sink only, forward nowhere" (the default). */
export const LOCAL_ANALYTICS_SINK_ID = "local";

/**
 * The subset of a hit a vendor receives (data minimisation). Raw IP/UA never exist past ingest, so
 * they cannot appear here; `region` and `sessionId` are dropped too. `visitorHash` stays (daily
 * rotating, per-site salted, not reversible) so a vendor can count uniques.
 */
export type ForwardedHit = Pick<
  NormalizedHit,
  | "workspaceId" | "occurredAt" | "kind" | "path" | "referrerHost" | "utm" | "country"
  | "deviceClass" | "browserFamily" | "osFamily" | "visitorHash" | "eventName" | "eventProps"
>;

/** One vendor bound to its credential. Returns a result instead of throwing (shared provider policy). */
export interface AnalyticsForwarder {
  forward(required: { hit: ForwardedHit; context: ProviderContext }): Promise<ProviderResult<void>>;
}

/** A credential the host resolved from its own store; `null` for vendors that need none. */
export interface AnalyticsForwarderCredential {
  readonly token: string;
  readonly baseUrl: string;
  readonly username?: string;
}

/** What a vendor module exports (same shape as host mail adapter modules). */
export interface AnalyticsForwarderModule {
  /** Host credential-store label the vendor key is saved under; absent for vendors that need none. */
  readonly credentialLabel?: string;
  create(required: { credential: AnalyticsForwarderCredential | null; kit: { httpClient: HttpClientPort } }): AnalyticsForwarder;
}

/** Copies only the forwarded fields. @complexity O(1). */
export function toForwardedHit(required: { hit: NormalizedHit }, _optional: Record<string, never> = {}): ForwardedHit {
  const { hit } = required;
  return {
    workspaceId: hit.workspaceId, occurredAt: hit.occurredAt, kind: hit.kind, path: hit.path,
    referrerHost: hit.referrerHost, utm: { ...hit.utm }, country: hit.country, deviceClass: hit.deviceClass,
    browserFamily: hit.browserFamily, osFamily: hit.osFamily, visitorHash: hit.visitorHash,
    eventName: hit.eventName, eventProps: hit.eventProps,
  };
}

/** @returns Why `exported` is not a forwarder module, or the module itself. @complexity O(1). */
export function asAnalyticsForwarderModule(required: { exported: unknown }, _optional: Record<string, never> = {}): AnalyticsForwarderModule | string {
  const candidate = required.exported as { create?: unknown } | null;
  if (typeof candidate !== "object" || candidate === null || typeof candidate.create !== "function") {
    return "its module has no create() function";
  }
  const label = (candidate as { credentialLabel?: unknown }).credentialLabel;
  if (label !== undefined && (typeof label !== "string" || label.trim() === "")) return "its credentialLabel must be a non-empty string";
  return candidate as AnalyticsForwarderModule;
}

/** @returns Why `exported` is not a `beforeIngest` hook, or the hook itself. @complexity O(1). */
export function asAnalyticsIngestHook(required: { exported: unknown }, _optional: Record<string, never> = {}): AnalyticsHooks | string {
  const candidate = required.exported as { beforeIngest?: unknown } | null;
  if (typeof candidate !== "object" || candidate === null || typeof candidate.beforeIngest !== "function") {
    return "its module has no beforeIngest() function";
  }
  return candidate as AnalyticsHooks;
}

/**
 * The keyed forwarder registry. `"local"` is reserved: it names the built-in-only choice.
 * @complexity As `createProviderRegistry`.
 */
export function createAnalyticsForwarderRegistry(
  _required: Record<string, never> = {},
  optional: { seed?: readonly ProviderDefinition<AnalyticsForwarderModule>[] } = {},
): ProviderRegistry<AnalyticsForwarderModule> {
  return createProviderRegistry<AnalyticsForwarderModule>({ contract: ANALYTICS_FORWARDER_CONTRACT }, {
    validate: ({ provider }) => {
      const reason = asAnalyticsForwarderModule({ exported: provider });
      return typeof reason === "string" ? reason : undefined;
    },
    ...(optional.seed ? { seed: optional.seed } : {}),
  });
}

/**
 * Resolves the per-site `sink` setting to a registered forwarder. `"local"` (or empty) means the
 * built-in sink only. An unknown id fails toward NOT sending data and says why.
 * @complexity O(1).
 */
export function selectAnalyticsForwarder(
  required: { registry: ProviderRegistry<AnalyticsForwarderModule>; sinkId: string },
  _optional: Record<string, never> = {},
): { entry?: RegisteredProvider<AnalyticsForwarderModule>; warning?: string } {
  const { registry, sinkId } = required;
  if (sinkId === "" || sinkId === LOCAL_ANALYTICS_SINK_ID) return {};
  const entry = registry.get({ id: sinkId });
  if (entry) return { entry };
  return { warning: `analytics sink '${sinkId}' is not installed; hits stay in the built-in sink only` };
}

/** One forwarder bound for a request, plus the id used in log-safe reports. */
export interface BoundAnalyticsForwarder {
  readonly id: string;
  readonly forwarder: AnalyticsForwarder;
  readonly context: ProviderContext;
}

/** Log-safe failure report: never carries the hit or a vendor payload. */
export type AnalyticsForwardReport = (required: { forwarderId: string; outcome: "rejected" | "unknown" | "threw"; message: string }) => void;

/** Runs one forward; every failure becomes a report, never a throw. @complexity O(1) + vendor call. */
async function forwardOne(required: { bound: BoundAnalyticsForwarder; hit: ForwardedHit; report: AnalyticsForwardReport }): Promise<void> {
  const { bound, hit, report } = required;
  try {
    const result = await bound.forwarder.forward({ hit, context: bound.context });
    if (result.status !== "ok") report({ forwarderId: bound.id, outcome: result.status, message: result.error.message });
  } catch (error) {
    report({ forwarderId: bound.id, outcome: "threw", message: error instanceof Error ? error.message : String(error) });
  }
}

/** Default: detach. The beacon response must never wait on a vendor (ADR-035 §5). */
const detach = (_task: Promise<void>): void => undefined;

/**
 * Composite sink: the primary is awaited (its failures propagate exactly as before); each forwarder
 * then receives the minimised hit without being awaited. Reads and capabilities are the primary's.
 * With no forwarders this is behaviourally the primary itself.
 * @param optional.schedule - Receives each in-flight forward; tests await it, production detaches.
 * @complexity accept O(f) forwarders scheduled; acceptBatch O(n·f).
 */
export function createFanOutAnalyticsSink(
  required: { primary: AnalyticsSinkPort },
  optional: { forwarders?: readonly BoundAnalyticsForwarder[]; report?: AnalyticsForwardReport; schedule?: (task: Promise<void>) => void } = {},
): AnalyticsSinkPort {
  const { primary } = required;
  const { forwarders = [], report = () => undefined, schedule = detach } = optional;
  const fanOut = (hit: NormalizedHit): void => {
    const forwarded = toForwardedHit({ hit });
    for (const bound of forwarders) schedule(forwardOne({ bound, hit: forwarded, report }));
  };
  return {
    capabilities: (input) => primary.capabilities(input),
    list: (input, listOptional) => primary.list(input, listOptional),
    accept: async ({ hit }) => {
      await primary.accept({ hit });
      fanOut(hit);
    },
    acceptBatch: async ({ hits }) => {
      await primary.acceptBatch({ hits });
      for (const hit of hits) fanOut(hit);
    },
  };
}

/** Report for a `beforeIngest` handler that threw; the hit passed through it unchanged. */
export type AnalyticsHookReport = (required: { index: number; message: string }) => void;

/**
 * Chains `beforeIngest` handlers in order. `null` from any handler drops the hit and stops the
 * chain. A handler that throws is skipped (the hit passes unchanged) and reported: one broken
 * plugin must not silently zero a site's analytics.
 * @returns `undefined` when there are no handlers, so callers keep the hook-free path.
 * @complexity O(h) handlers per hit.
 */
export function composeBeforeIngestHooks(
  required: { hooks: readonly AnalyticsHooks[] },
  optional: { report?: AnalyticsHookReport } = {},
): AnalyticsHooks | undefined {
  const { hooks } = required;
  if (hooks.length === 0) return undefined;
  const report = optional.report ?? (() => undefined);
  return {
    beforeIngest: async ({ hit }) => {
      let current: NormalizedHit = hit;
      for (const [index, hook] of hooks.entries()) {
        try {
          const next = await hook.beforeIngest({ hit: current });
          if (next === null) return null;
          current = next;
        } catch (error) {
          report({ index, message: error instanceof Error ? error.message : String(error) });
        }
      }
      return current;
    },
  };
}
