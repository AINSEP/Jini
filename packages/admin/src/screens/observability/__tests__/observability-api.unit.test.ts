import { expect, it } from "vitest";
import { createObservabilityApi, type ObservabilityAdminRequest } from "../api/observability-api.js";

function setup() {
  const prefix = "/workspaces/ops-ws/system";
  const responses = new Map<string, unknown>([
    [`GET ${prefix}/observability-status`, { enabled: true, serviceName: "admin-edge" }],
    [`POST ${prefix}/observability/test-error`, { providers: [{ providerId: "otel", signals: ["error"] }] }],
    [`GET ${prefix}/tool-gaps`, { entries: [] }],
    [`GET ${prefix}/server-logs`, { entries: [], matched: 12, buffered: 12, truncated: false, capturing: true }],
    [`GET ${prefix}/server-logs?level=warn&contains=worker+%2B+queue&limit=0`, {
      entries: [], matched: 3, buffered: 12, truncated: true, capturing: true,
    }],
  ]);
  const request: ObservabilityAdminRequest = async <T>({ path }: { path: string }, options?: { init?: RequestInit }) => {
    const key = `${options?.init?.method ?? "GET"} ${path}`;
    if (!responses.has(key) || options?.init?.body !== undefined) throw new Error(`Unexpected request: ${key}`);
    return responses.get(key) as T;
  };
  return createObservabilityApi({ request, workspaceId: "ops-ws" });
}

it("reads workspace status and gaps, but sends the telemetry test signal with POST", async () => {
  const api = setup();
  await expect(api.getObservabilityStatus()).resolves.toEqual({ enabled: true, serviceName: "admin-edge" });
  await expect(api.getToolGaps()).resolves.toEqual({ entries: [] });
  await expect(api.sendObservabilityTestError()).resolves.toEqual({ providers: [{ providerId: "otel", signals: ["error"] }] });
});

it("leaves the unfiltered log URL bare and encodes defined filters even when the limit is zero", async () => {
  const api = setup();
  await expect(api.getServerLogs()).resolves.toEqual({
    entries: [], matched: 12, buffered: 12, truncated: false, capturing: true,
  });
  await expect(api.getServerLogs({ level: "warn", sinceIso: undefined, contains: "worker + queue", limit: 0 })).resolves.toEqual({
    entries: [], matched: 3, buffered: 12, truncated: true, capturing: true,
  });
});
