import type { AdminObservabilityStatus } from "../api/observability-api.types.js";
import type { ObservabilityApi } from "../api/observability-api.js";
import type { ObservabilityStatusPort } from "./observability-status-port.hooks.js";

/**
 * @file The only place under `features/observability`'s hook that reaches `lib/api` — see
 * `observability-status-port.hooks.ts` for why the split exists. Mirrors
 * `features/plugins/hooks/agent-plugins-dependencies.hooks.ts`'s identical split for its sibling
 * screen.
 * Now: the client is the host-bound {@link ObservabilityApi}.
 */

/**
 * The live port over the host-bound {@link ObservabilityApi}. Methods are read off `api` at call
 * time, so a host test that spies on its client sees every call.
 */
export function createObservabilityStatusPort(
  { api }: { api: Pick<ObservabilityApi, "getObservabilityStatus" | "sendObservabilityTestError"> },
  _optional: Record<string, never> = {},
): ObservabilityStatusPort {
  return {
    getObservabilityStatus: () => api.getObservabilityStatus(),
    sendTestError: () => api.sendObservabilityTestError(),
  };
}

/** Seed state for {@link createFakeObservabilityStatusPort}. */
export interface FakeObservabilityStatusPortOptions {
  status?: AdminObservabilityStatus;
  /** Makes `getObservabilityStatus` reject with this instead of resolving — for the hook's own
   *  failure-path test. */
  failWith?: unknown;
}

/** An in-memory {@link ObservabilityStatusPort} for tests — mirrors
 *  `createFakeAgentPluginsPort`'s identical role. */
export function createFakeObservabilityStatusPort(
  options: FakeObservabilityStatusPortOptions = {},
): ObservabilityStatusPort {
  return {
    async getObservabilityStatus() {
      if (options.failWith !== undefined) throw options.failWith;
      return options.status ?? { enabled: false, serviceName: null };
    },
  };
}
