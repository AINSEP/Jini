import { querySuffix } from "@jini-ai/core/admin-runtime";
import type { ToolGapEntry } from "@jini-ai/core/contracts/site/daemon-tool-audit";
import type { AdminObservabilityStatus, AdminServerLogs, AdminServerLogsQuery, AdminTelemetryTestResult } from "./observability-api.types.js";

/**
 * The host's authenticated admin request (its session, CSRF and error mapping). This client never
 * builds its own transport: every call goes through the one the host already authorizes.
 */
export type ObservabilityAdminRequest = <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;

export interface ObservabilityApiDependencies {
  /** The host's authenticated admin request. */
  request: ObservabilityAdminRequest;
  /** The workspace every `system/*` route is scoped under. */
  workspaceId: string;
}

/** The admin API calls of the observability feature, bound to the host's request and workspace. */
export function createObservabilityApi({ request, workspaceId }: ObservabilityApiDependencies, _optional: Record<string, never> = {}) {
  return {
    // Observability panel, Overview tab (the host's `system/observability-status` admin route) —
    // `system.read`-gated, same shape as the deployment overview read.
    /** Whether the host's real OTel adapter is on right now, and under what service
     *  name — never the OTLP endpoint value itself. See {@link AdminObservabilityStatus}. */
    getObservabilityStatus: () =>
      request<AdminObservabilityStatus>({ path: `/workspaces/${workspaceId}/system/observability-status` }),
    sendObservabilityTestError: () => request<AdminTelemetryTestResult>({ path: `/workspaces/${workspaceId}/system/observability/test-error` }, { init: { method: "POST" } }),
    /** Owner-only filter over native CLI fallback entries in the existing audit store. */
    getToolGaps: () => request<{ entries: ToolGapEntry[] }>({ path: `/workspaces/${workspaceId}/system/tool-gaps` }),
    /** Recent captured server log lines (the host's `system/server-logs` route, `system.read`-gated) — the
     *  Observability "Recent errors" tab. */
    getServerLogs: (query: AdminServerLogsQuery = {}) => {
      const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
      const qs = params.toString();
      return request<AdminServerLogs>({ path: `/workspaces/${workspaceId}/system/server-logs${querySuffix({ query: qs })}` });
    },
  };
}

/** The bound client {@link createObservabilityApi} returns. */
export type ObservabilityApi = ReturnType<typeof createObservabilityApi>;
