// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { FetchQueryProvider, useFetchMutation, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { hasPermission } from "@jini-ai/ui/panel-kit";
import type { AdminHttpError } from "@jini-ai/core/admin-runtime";
import { describeAdmissionDrift } from "@jini-ai/admin/screens/settings/external-mcp-connection-drift";
import { admissionRestartHelps } from "@jini-ai/admin/screens/settings/external-mcp-tool-drift";
import { EXTERNAL_MCP_DRIFT_COPY } from "@jini-ai/admin/screens/settings/external-mcp-drift-copy";
import { useExternalMcpAdmissions } from "../use-external-mcp-admissions.hooks.js";

afterEach(() => vi.useRealTimers());

it("stops automatic admissions retries at the existing bound", async () => {
  vi.useFakeTimers();
  const failure = Object.assign(new Error("Starting"), { status: 503, code: "AGENT_DAEMON_UNAVAILABLE" });
  const getAdmissions = vi.fn(async () => { throw failure; });
  const port = { getAdmissions, me: async () => ({ effectivePermissions: ["*"] }), restartAssistantDaemon: async () => ({ ok: true }) };
  const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;
  const { result } = renderHook(() => useExternalMcpAdmissions({ port, savedAllowedToolNamesById: {}, t: (key) => key,
    useFetchQuery, useFetchMutation, hasPermission, describeAdmissionDrift, admissionRestartHelps, driftCopy: EXTERNAL_MCP_DRIFT_COPY,
    isApiError: (error): error is AdminHttpError => error === failure,
    apiUnreachableCode: "UNREACHABLE", requestTimeoutCode: "TIMEOUT", describeApiError: ({ fallback }) => fallback,
    setTimeout, clearTimeout, reportRestartFailure: vi.fn(),
  }), { wrapper });
  await act(async () => {});
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  }
  expect(getAdmissions).toHaveBeenCalledTimes(61);
  expect(result.current.waitingForAssistant).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(getAdmissions).toHaveBeenCalledTimes(61);
  await act(async () => { result.current.restart(); });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
  }
  expect(getAdmissions).toHaveBeenCalledTimes(69);
  expect(result.current.restartAccepted).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(getAdmissions).toHaveBeenCalledTimes(69);
});
