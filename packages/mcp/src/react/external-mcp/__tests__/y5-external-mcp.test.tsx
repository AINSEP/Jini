import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AdminExternalMcpServer } from "@jini-ai/core/contracts/site/cms-external-mcp";
import { bindExternalMcpAdmissions } from "../hooks/use-external-mcp-admissions.hooks.js";
import { useExternalMcp } from "../hooks/use-external-mcp.hooks.js";

afterEach(cleanup);

const server: AdminExternalMcpServer = {
  serverId: "saved", version: 7, label: "Saved", transport: "stdio", authMode: "none", enabled: true, command: "server", url: null, args: [],
  allowedToolNames: ["read"], writeAllowedToolNames: [], writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: [],
  oauth: { providerId: null, grant: null, clientId: null, scopes: [], status: "none", expiresAt: null, tokenEnvName: null, hasStoredToken: false },
};

test("saved updates carry the saved version and conflicts retain the last known row without probing", async () => {
  const probeExternalMcpServer = vi.fn(async () => ({ tools: [] }));
  const saveExternalMcpServer = vi.fn(async (_required: Parameters<Parameters<typeof useExternalMcp>[0]["deps"]["port"]["saveExternalMcpServer"]>[0]) => { throw new Error("conflict"); });
  const deps: Parameters<typeof useExternalMcp>[0]["deps"] = {
    port: { listExternalMcpServers: async () => ({ servers: [server] }), saveExternalMcpServer, deleteExternalMcpServer: async () => ({ removed: true, restartRequired: true }), probeExternalMcpServer },
    credentialText: ({ id }) => id,
    formatCredentialHint: () => "hint", formatCredentialHints: () => "hints", translateCredentialMessage: ({ message }) => message,
    credentialDraftError: () => null, describeApiError: ({ e }) => String(e),
    VERSION_CONFLICT_MESSAGE: "This server changed elsewhere.", isVersionConflict: ({ error }) => error instanceof Error && error.message === "conflict",
    translate: ({ key }) => key,
    mergeSourceUpdate: ({ previous, patch }) => ({ fields: { ...previous?.fields, ...patch.fields }, enabled: patch.enabled ?? previous?.enabled ?? true, label: patch.label ?? previous?.label }),
    resolveExternalMcpEffectiveAuthMode: fields => fields.authMode || "none",
    resolveExternalMcpEffectiveTransport: fields => fields.transport || "stdio",
    validateExternalMcpOAuthIdentity: () => null,
    now: () => 0,
  };
  const { result } = renderHook(() => useExternalMcp({ deps, hooks: { useAdminLocaleHook: () => "en", useSerialWrites: () => ({ run: ({ task }) => task() }) } }));
  const items = await result.current.dependencies.port.fetchSources();
  expect(probeExternalMcpServer).not.toHaveBeenCalled();
  let updated;
  await act(async () => { updated = await result.current.dependencies.port.updateSource("saved", { enabled: false }); });
  expect(saveExternalMcpServer.mock.calls[0]?.[0]).toMatchObject({ serverId: "saved", body: { expectedVersion: 7, enabled: false, command: "server", allowedToolNames: "read" } });
  expect(updated).toEqual({ ...items[0], statusMessage: "This server changed elsewhere." });
  expect(result.current.restartRequired).toBe(false);
  expect(probeExternalMcpServer).not.toHaveBeenCalled();
});

test("admissions binding retains transient classification and resolves wired copy inside the hook", () => {
  const useCopyHook = vi.fn(() => (key: string) => `copy:${key}`);
  const bound = bindExternalMcpAdmissions({
    hooks: {
      useCopyHook,
      useFetchQuery: () => ({ data: undefined, error: null, status: "loading", isFetching: true, refetch: () => {} }),
      useFetchMutation: ({ run }) => ({ status: "idle", error: null, mutate: ({ input }) => run({ input }), reset: () => {} }),
    },
    deps: {
      port: { getAdmissions: vi.fn(), me: vi.fn(), restartAssistantDaemon: vi.fn() },
      hasPermission: () => false, describeAdmissionDrift: () => [], admissionRestartHelps: () => false,
      driftCopy: {}, describeApiError: ({ fallback }) => fallback,
      isApiError: (error): error is import("@jini-ai/core/admin-runtime").AdminHttpError => error instanceof Error && "status" in error && "code" in error,
      apiUnreachableCode: "UNREACHABLE", requestTimeoutCode: "TIMEOUT", setTimeout, clearTimeout,
      reportRestartFailure: vi.fn(),
    },
  });
  expect(useCopyHook).not.toHaveBeenCalled();
  expect(bound.isAssistantStartingError({ error: Object.assign(new Error("booting"), { status: 503, code: "AGENT_DAEMON_UNAVAILABLE" }) })).toBe(true);
  expect(bound.isAssistantStartingError({ error: Object.assign(new Error("denied"), { status: 403, code: "DENIED" }) })).toBe(false);
  const { result } = renderHook(() => bound.useWiredExternalMcpAdmissions({}));
  expect(useCopyHook).toHaveBeenCalledOnce();
  expect(result.current.canRestart).toBe(false);
  expect(result.current.restartAccepted).toBe(false);
});
