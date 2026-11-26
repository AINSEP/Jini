// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AdminExternalMcpServer } from "@jini-ai/core/contracts/site/cms-external-mcp";
import type { FetchMutationOptions, MutationResult } from "@jini-ai/core/fetch";
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
    mergeSourceUpdate: ({ previous, patch }) => {
      const label = patch.label ?? previous?.label;
      return { fields: { ...previous?.fields, ...patch.fields }, enabled: patch.enabled ?? previous?.enabled ?? true, ...(label !== undefined && { label }) };
    },
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
      useFetchMutation: <TInput, TOutput>({ run }: Pick<FetchMutationOptions<TInput, TOutput>, "run">): MutationResult<TInput, TOutput> =>
        ({ status: "idle", error: null, mutate: ({ input }) => run({ input }), reset: () => {} }),
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


test("the saved Tools count renders without a probe; opening mounts the picker for that server", async () => {
  const { bindExternalMcpSettingsPanel } = await import("../ExternalMcpSettingsPanel.js");
  const probe = vi.fn();
  const source = { id: "saved", label: "Saved server", enabled: true, fields: { transport: "streamable_http", authMode: "none", allowedToolNames: "read,write" } };
  const dependencies = { port: { fetchSources: async () => [source], addSource: async () => ({ ok: false }), removeSource: async () => true } };
  const list = { sources: [source], loading: false, error: null, testResults: {},
    capabilities: { canRefresh: false, canSetTrust: false, canTest: true, canUpdate: true },
    isPending: () => false, reload: vi.fn(async () => {}), addSourceToList: vi.fn(),
    remove: vi.fn(async () => {}), refresh: vi.fn(async () => {}), test: vi.fn(async () => {}),
    setTrust: vi.fn(async () => {}), update: vi.fn(async () => {}),
  };
  const noop = () => null;
  const unusedHook = () => { throw new Error("unmounted collaborator"); };
  const Bound = bindExternalMcpSettingsPanel({
    hooks: {
      useTHook: () => key => key, useExternalMcpDriftCopyHook: () => key => key,
      useWiredSourceConfigListHook: () => list,
      useExternalMcpAddFormHook: () => ({ formOpen: false, toggleForm: vi.fn(), cancelForm: vi.fn(), fieldSpecs: [],
        addForm: { values: {}, validation: { ok: true, issues: [] }, submitAttempted: false, submitting: false, submitError: null,
          setField: vi.fn(), submit: vi.fn(async () => {}), reset: vi.fn() } }),
      useSavedAllowedToolNamesByIdHook: () => ({}),
      useExternalMcpAdmissionsHook: () => ({ loading: false, waitingForAssistant: false, unavailable: null,
        connections: [], restartHelps: false, canRestart: false, restarting: false, restartError: null, restartAccepted: false, restart: vi.fn() }),
      useKitT: () => key => key, useFocusTrap: unusedHook, useExternalMcpToolsModalEscape: unusedHook, useExternalMcpRemoveConfirm: unusedHook, useHostExternalMcpSharedChoice: unusedHook,
      useConnect: () => ({ state: { phase: "idle" }, connect: vi.fn(async () => {}), cancel: vi.fn() }),
    },
    kit: {
      Icon: noop, InfoTip: noop, SourceConfigAddForm: noop, ConfirmActionDialog: noop,
      SourceConfigItemCard: ({ source }) => <div>{source.label}</div>,
      ExternalMcpToolsModal: ({ serverId, allowedToolNames, onClose }) => {
        probe({ serverId });
        return <div role="dialog"><span>{allowedToolNames}</span><button onClick={onClose}>close</button></div>;
      },
      ExternalMcpSharedChoice: noop,
      ExternalMcpRemoveConfirmDialog: noop,
    },
    deps: {
      buildExternalMcpCardHandles: ({ sourceIds }) => sourceIds.map(id => `mcp-${id}`),
      buildExternalMcpFieldSpecs: () => [], sourceDisplayLabel: ({ source }) => source.label ?? source.id,
      isBuiltInExternalMcpSource: () => false, externalMcpNeedsSignIn: () => false,
      resolveExternalMcpEffectiveTransport: fields => fields.transport === "streamable_http" ? "streamable_http" : "stdio",
      resolveExternalMcpEffectiveAuthMode: () => "none", parseSavedToolNames: ({ value }) => value?.split(",") ?? [],
      grantWriteFieldValue: ({ remoteName }) => remoteName, describeDriftHeadline: () => "drift",
      buildExternalMcpRemoveConfirmCopy: () => ({ title: "Remove", body: "Confirm removal" }),
      driftCopy: {
        refusal: {
          "remote-declares-destructive": { kind: "destructive", key: "destructive" },
          "remote-declares-not-read-only": { kind: "needs-write-grant", key: "grant" },
          "missing-or-invalid-input-schema": { kind: "server-side-defect", key: "schema" },
          "invalid-remote-tool-name": { kind: "server-side-defect", key: "name" },
          "duplicate-remote-tool-name": { kind: "server-side-defect", key: "duplicate" },
          "connection-tool-cap-reached": { kind: "server-side-defect", key: "cap" },
        },
        refusedFallback: "refused", notOffered: "absent", inertWriteGrant: "inert", stillLive: "live", notRunning: "stopped",
        disabledButRunning: "disabled", removedButStillRunning: "removed", decryptFailed: "decrypt", failedToStart: "start",
        launcherMissing: "launcher", restartHeadline: "restart", noRestartHeadline: "no restart", needsSignIn: "sign in",
      },
      pickerCollaborators: { useExternalMcpDriftCopyHook: () => key => key, useTHook: () => key => key,
        productVars: { productName: "Host" }, useWiredExternalMcpToolPickerHook: unusedHook, useToolRowHandlesHook: unusedHook, useToolPickerFilterHook: unusedHook },
      EXTERNAL_MCP_PRODUCT_VARS: { productName: "Host" }, EXTERNAL_MCP_ADD_FORM_HANDLE: "mcp-add",
    },
  });
  render(<Bound dependencies={dependencies} />);
  expect(screen.getByRole("button", { name: "Open tool permissions for Saved server — 2 enabled" })).toBeTruthy();
  expect(probe).not.toHaveBeenCalled();
  act(() => screen.getByRole("button", { name: "Open tool permissions for Saved server — 2 enabled" }).click());
  expect(probe).toHaveBeenCalledExactlyOnceWith({ serverId: "saved" });
  expect(screen.getByRole("dialog").textContent).toContain("read,write");
  act(() => screen.getByText("close").click());
  expect(screen.queryByRole("dialog")).toBeNull();

});
