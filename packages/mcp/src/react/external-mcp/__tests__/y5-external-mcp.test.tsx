// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AdminExternalMcpServer } from "@jini-ai/core/contracts/site/cms-external-mcp";
import type { FetchMutationOptions, MutationResult } from "@jini-ai/core/fetch";
import { bindExternalMcpAdmissions } from "../hooks/use-external-mcp-admissions.hooks.js";
import { bindExternalMcp, useExternalMcp } from "../hooks/use-external-mcp.hooks.js";

import { useExternalMcpDriftCopy, useSavedAllowedToolNamesById } from "../ExternalMcpSettingsPanel.hooks.js";
import { bindExternalMcpSettingsPanel, ExternalMcpSettingsPanel, type ExternalMcpSettingsPanelProps } from "../ExternalMcpSettingsPanel.js";

afterEach(cleanup);

const server: AdminExternalMcpServer = {
  serverId: "saved", version: 7, label: "Saved", transport: "stdio", authMode: "none", enabled: true, command: "server", url: null, args: [],
  allowedToolNames: ["read"], writeAllowedToolNames: [], writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: [],
  oauth: { providerId: null, grant: null, clientId: null, scopes: [], status: "none", expiresAt: null, tokenEnvName: null, hasStoredToken: false },
};

type ControllerDeps = Parameters<typeof useExternalMcp>[0]["deps"];

function controllerDeps(port: ControllerDeps["port"]): ControllerDeps {
  return {
    port,
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
}

test("saved updates carry the saved version and conflicts retain the last known row without probing", async () => {
  const probeExternalMcpServer = vi.fn(async () => ({ tools: [] }));
  const saveExternalMcpServer = vi.fn(async (_required: Parameters<Parameters<typeof useExternalMcp>[0]["deps"]["port"]["saveExternalMcpServer"]>[0]) => { throw new Error("conflict"); });
  const deps = controllerDeps({ listExternalMcpServers: async () => ({ servers: [server] }), saveExternalMcpServer,
    deleteExternalMcpServer: async () => ({ removed: true, restartRequired: true }), probeExternalMcpServer });
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


function panelFixture() {
  const probe = vi.fn();
  const source: Awaited<ReturnType<ExternalMcpSettingsPanelProps["dependencies"]["port"]["fetchSources"]>>[number] = { id: "saved", label: "Saved server", enabled: true, fields: { transport: "streamable_http", authMode: "none", allowedToolNames: "read,write" } };
  const dependencies = { port: { fetchSources: async () => [source], addSource: async () => ({ ok: false }), removeSource: async () => true } };
  type List = ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useWiredSourceConfigListHook"]>;
  const list = { sources: [source], loading: false, error: null as List["error"], testResults: {} as List["testResults"],
    capabilities: { canRefresh: false, canSetTrust: false, canTest: true, canUpdate: true },
    isPending: vi.fn<List["isPending"]>(() => false), reload: vi.fn(async () => {}), addSourceToList: vi.fn(),
    remove: vi.fn(async () => {}), refresh: vi.fn(async () => {}), test: vi.fn(async () => {}),
    setTrust: vi.fn(async () => {}), update: vi.fn(async () => {}),
  };
  const noop = () => null;
  const unusedHook = () => { throw new Error("unmounted collaborator"); };
  const collaborators: Omit<ExternalMcpSettingsPanelProps, "dependencies"> = {
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
  };
  return { collaborators, dependencies, source, list, probe };
}

test("the saved Tools count renders without a probe; opening mounts the picker for that server", async () => {
  const { collaborators, dependencies, probe } = panelFixture();
  const Bound = bindExternalMcpSettingsPanel(collaborators);
  render(<Bound dependencies={dependencies} />);
  expect(screen.getByRole("button", { name: "Open tool permissions for Saved server — 2 enabled" })).toBeTruthy();
  expect(probe).not.toHaveBeenCalled();
  act(() => screen.getByRole("button", { name: "Open tool permissions for Saved server — 2 enabled" }).click());
  expect(probe).toHaveBeenCalledExactlyOnceWith({ serverId: "saved" });
  expect(screen.getByRole("dialog").textContent).toContain("read,write");
  act(() => screen.getByText("close").click());
  expect(screen.queryByRole("dialog")).toBeNull();

});

function renderController(deps: ControllerDeps) {
  const useController = bindExternalMcp({ deps, hooks: {
    useAdminLocaleHook: () => "fr",
    useSerialWrites: () => ({ run: ({ task }) => task() }),
  } });
  return renderHook(() => useController({}));
}

function controllerPorts() {
  return {
    listExternalMcpServers: vi.fn(async () => ({ servers: [server] })),
    saveExternalMcpServer: vi.fn<ControllerDeps["port"]["saveExternalMcpServer"]>(),
    deleteExternalMcpServer: vi.fn<ControllerDeps["port"]["deleteExternalMcpServer"]>(),
    probeExternalMcpServer: vi.fn<ControllerDeps["port"]["probeExternalMcpServer"]>(),
  };
}

test("a hosted add preserves the sealed-token boundary, warns on failed probe and becomes a versioned edit", async () => {
  const ports = controllerPorts();
  const accessTokenHint = { last4: "1234", length: 12 };
  const hosted: AdminExternalMcpServer = {
    ...server, serverId: "hosted", label: "Remote", authMode: "static_env", transport: "streamable_http",
    command: "", url: "https://example.test/mcp", hasAccessToken: true, accessTokenHint,
  };
  ports.saveExternalMcpServer.mockResolvedValueOnce({ server: hosted })
    .mockResolvedValueOnce({ server: { ...hosted, enabled: false, version: 8 } });
  const offline = new Error("offline");
  ports.probeExternalMcpServer.mockRejectedValueOnce(offline);
  const { result } = renderController({
    ...controllerDeps(ports),
    formatCredentialHint: ({ hint, locale }) => `${locale}:${hint.last4}`,
    translateCredentialMessage: ({ message, locale }) => `${locale}:${message}`,
  });
  const input = { fields: { id: " hosted ", label: "Remote", transport: "streamable_http", authMode: "static_env",
    url: "https://example.test/mcp", accessToken: "test-token", allowedToolNames: "read" } };
  await act(async () => {
    expect(await result.current.dependencies.port.addSource(input)).toMatchObject({
      ok: true, source: { id: "hosted", statusMessage: "set (fr:1234) · fr:Error: offline", fields: { accessToken: "", version: "7" } },
    });
  });
  expect(ports.saveExternalMcpServer).toHaveBeenNthCalledWith(1, { serverId: "hosted", body: {
    label: "Remote", transport: "streamable_http", enabled: true, command: "", url: "https://example.test/mcp",
    args: "", allowedToolNames: "read", writeAllowedToolNames: "", authMode: "static_env", accessToken: "test-token",
  } });
  expect(ports.probeExternalMcpServer).toHaveBeenCalledExactlyOnceWith({ serverId: "hosted" });
  expect(result.current.restartRequired).toBe(true);
  await act(async () => {
    expect(await result.current.dependencies.port.updateSource("hosted", { enabled: false }))
      .toMatchObject({ id: "hosted", enabled: false, fields: { version: "8", accessToken: "" } });
  });
  expect(ports.saveExternalMcpServer).toHaveBeenNthCalledWith(2, { serverId: "hosted", body: {
    label: "Remote", transport: "streamable_http", enabled: false, command: "", url: "https://example.test/mcp",
    args: "", allowedToolNames: "read", writeAllowedToolNames: "", authMode: "static_env", expectedVersion: 7,
  } });
  expect(ports.probeExternalMcpServer).toHaveBeenCalledTimes(1);
});

test("blank, duplicate, and invalid credential drafts are refused before they can overwrite a connection", async () => {
  const ports = controllerPorts();
  const credentialDraftError = vi.fn<ControllerDeps["credentialDraftError"]>(() => "Enter a token.");
  const { result } = renderController({
    ...controllerDeps(ports), credentialDraftError,
    validateExternalMcpOAuthIdentity: (fields, { t }) => fields.authMode === "oauth" ? t("Select an OAuth provider.") : null,
  });
  const port = result.current.dependencies.port;
  await port.fetchSources();
  expect(await port.addSource({ fields: {} })).toEqual({ ok: false, message: "An ID is required." });
  expect(await port.addSource({ fields: { id: " saved " } }))
    .toEqual({ ok: false, message: "A server with this ID already exists. Edit that server instead." });
  expect(await port.addSource({ fields: { id: "new", transport: "streamable_http", authMode: "static_env" } }))
    .toEqual({ ok: false, message: "Enter a token." });
  expect(credentialDraftError).toHaveBeenCalledExactlyOnceWith({ value: "" }, { locale: "fr", required: true });
  expect(await port.addSource({ fields: { id: "new", authMode: "oauth" } }))
    .toEqual({ ok: false, message: "Select an OAuth provider." });
  expect(ports.saveExternalMcpServer).not.toHaveBeenCalled();
  expect(ports.probeExternalMcpServer).not.toHaveBeenCalled();
  expect(result.current.restartRequired).toBe(false);
});

test("a failed removal keeps a connection reserved until deleting that exact id succeeds", async () => {
  const ports = controllerPorts();
  ports.deleteExternalMcpServer.mockRejectedValueOnce(new Error("locked"))
    .mockResolvedValueOnce({ removed: true, restartRequired: true });
  ports.saveExternalMcpServer.mockResolvedValueOnce({ server: { ...server, version: 1 } });
  const { result } = renderController(controllerDeps(ports));
  const port = result.current.dependencies.port;
  await port.fetchSources();
  const input = { fields: { id: "saved", command: "server", allowedToolNames: "read" } };
  expect(await port.removeSource("saved")).toBe(false);
  expect(await port.addSource(input)).toEqual({ ok: false, message: "A server with this ID already exists. Edit that server instead." });
  expect(ports.saveExternalMcpServer).not.toHaveBeenCalled();
  expect(result.current.restartRequired).toBe(false);
  await act(async () => {
    expect(await port.removeSource("saved")).toBe(true);
  });
  expect(result.current.restartRequired).toBe(true);
  await act(async () => {
    expect(await port.addSource(input)).toMatchObject({ ok: true, source: { id: "saved", statusMessage: "saved" } });
  });
  expect(ports.deleteExternalMcpServer.mock.calls).toEqual([[{ serverId: "saved" }], [{ serverId: "saved" }]]);
  expect(ports.probeExternalMcpServer).not.toHaveBeenCalled();
});

test("probing requires a saved id and reports the count, elapsed time or an actionable refusal", async () => {
  const ports = controllerPorts();
  const now = vi.fn<ControllerDeps["now"]>()
    .mockReturnValueOnce(12).mockReturnValueOnce(30).mockReturnValueOnce(80).mockReturnValueOnce(110).mockReturnValueOnce(225);
  ports.probeExternalMcpServer.mockResolvedValueOnce({ tools: [{ name: "read" }] })
    .mockResolvedValueOnce({ tools: [{ name: "read" }, { name: "write" }] }).mockRejectedValueOnce(new Error("reconnect"));
  const { result } = renderController({ ...controllerDeps(ports), now });
  const probe = result.current.dependencies.port.testSource;
  expect(await probe(undefined)).toEqual({ ok: false, message: "Save this server before you can test it." });
  expect(now).not.toHaveBeenCalled();
  expect(ports.probeExternalMcpServer).not.toHaveBeenCalled();
  expect(await probe("saved")).toEqual({ ok: true, message: "1 tool advertised.", latencyMs: 18 });
  expect(await probe("saved")).toEqual({ ok: true, message: "2 tools advertised.", latencyMs: 30 });
  expect(await probe("saved")).toEqual({ ok: false, message: "Error: reconnect" });
  expect(ports.probeExternalMcpServer.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ serverId: "saved" }]));
});

test("the panel waits for the roster, distinguishes an empty roster, and displays save status", () => {
  const { collaborators, dependencies, list } = panelFixture();
  list.sources = [];
  list.loading = true;
  const props = { ...collaborators, dependencies, showTitle: false, saveStatusLabel: "Saved locally" };
  const view = render(<ExternalMcpSettingsPanel {...props} />);
  expect(screen.getByRole("status").textContent).toBe("Loading…");
  expect(screen.queryByText("No MCP servers configured.")).toBeNull();
  expect(screen.queryByRole("heading", { name: "External MCP servers" })).toBeNull();
  list.loading = false;
  view.rerender(<ExternalMcpSettingsPanel {...props} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("No MCP servers configured.").textContent).toBe("No MCP servers configured.");
  expect(screen.getByText("Saved locally").textContent).toBe("Saved locally");
});

test("the panel tests and submits its visible draft and passes errors to the add form", () => {
  const { collaborators, dependencies, list } = panelFixture();
  const draft = { id: "new", command: "new-server" };
  list.error = "Could not refresh sources.";
  list.testResults.__draft__ = { ok: false, message: "Save before probing." };
  const submit = vi.fn(async () => {});
  const cancel = vi.fn();
  collaborators.hooks.useExternalMcpAddFormHook = () => ({
    formOpen: true, toggleForm: vi.fn(), cancelForm: cancel, fieldSpecs: [],
    addForm: { values: draft, validation: { ok: true, issues: [] }, submitAttempted: true, submitting: false,
      submitError: "Connection already exists.", setField: vi.fn(), submit, reset: vi.fn() },
  });
  collaborators.kit.SourceConfigAddForm = ({ values, submitError, testResult, onSubmit, onTest, onCancel }) =>
    <section aria-label={values.id}><p role="alert">{submitError}</p><p role="status">{testResult?.message}</p><button onClick={onTest}>Test draft</button>
      <button onClick={onSubmit}>Submit draft</button><button onClick={onCancel}>Cancel draft</button></section>;
  render(<ExternalMcpSettingsPanel {...collaborators} dependencies={dependencies} />);
  const form = within(screen.getByRole("region", { name: "new" }));
  expect(form.getByRole("alert").textContent).toBe("Connection already exists.");
  expect(form.getByRole("status").textContent).toBe("Save before probing.");
  expect(screen.getByText("Could not refresh sources.").getAttribute("role")).toBe("alert");
  fireEvent.click(form.getByRole("button", { name: "Test draft" }));
  expect(list.test).toHaveBeenCalledExactlyOnceWith(undefined, draft);
  fireEvent.click(form.getByRole("button", { name: "Submit draft" }));
  expect(submit).toHaveBeenCalledExactlyOnceWith();
  fireEvent.click(form.getByRole("button", { name: "Cancel draft" }));
  expect(cancel).toHaveBeenCalledExactlyOnceWith();
});

test("the admissions repair writes only the named source grants and requires confirmation for removal", () => {
  const { collaborators, dependencies, list, source } = panelFixture();
  list.sources = [{ ...source, fields: { ...source.fields, allowedToolNames: "read,write", writeAllowedToolNames: "existing" } }];
  collaborators.hooks.useExternalMcpAdmissionsHook = () => ({
    loading: false, waitingForAssistant: false, unavailable: null, restartHelps: false, canRestart: false,
    restarting: false, restartError: null, restartAccepted: false, restart: vi.fn(),
    connections: [
      { connectionId: "saved", notLoaded: ["write"], liveToolCount: 1, savedToolCount: 2, entries: [
        { connectionId: "saved", remoteName: "write", kind: "needs-write-grant", messageKey: "Allow write", messageVars: {} },
        { connectionId: "saved", remoteName: null, kind: "missing-launcher", messageKey: "Missing launcher", messageVars: {} },
      ] },
      { connectionId: "deleted", notLoaded: [], liveToolCount: 1, savedToolCount: 0, entries: [
        { connectionId: "deleted", remoteName: "old", kind: "needs-write-grant", messageKey: "Old access", messageVars: {} },
      ] },
    ],
  });
  collaborators.deps.grantWriteFieldValue = ({ currentWriteAllowedToolNames, remoteName }) => `${currentWriteAllowedToolNames},${remoteName}`;
  collaborators.kit.ExternalMcpRemoveConfirmDialog = ({ name, cardHandle, onConfirm, onCancel }) =>
    <div role="dialog" aria-label={name} data-handle={cardHandle}><button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button></div>;
  render(<ExternalMcpSettingsPanel {...collaborators} dependencies={dependencies} />);
  const grant = (message: string) => within(screen.getByText(message).closest("li")!).getByRole("checkbox", { name: "Allow changes" });
  fireEvent.click(grant("Old access"));
  expect(list.update).not.toHaveBeenCalled();
  fireEvent.click(grant("Allow write"));
  expect(list.update).toHaveBeenCalledExactlyOnceWith("saved", { fields: { writeAllowedToolNames: "existing,write" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  let dialog = screen.getByRole("dialog", { name: "Saved server" });
  expect(dialog.getAttribute("data-handle")).toBe("mcp-saved");
  expect(list.remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(list.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  dialog = screen.getByRole("dialog", { name: "Saved server" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
  expect(list.remove).toHaveBeenCalledExactlyOnceWith("saved");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the built-in card can be disabled without exposing removal controls", () => {
  const { collaborators, dependencies, list, source } = panelFixture();
  list.sources = [{ ...source, id: "built-in", label: "Site tools", fields: { builtIn: "true" } }];
  collaborators.deps.isBuiltInExternalMcpSource = ({ source }) => source.fields.builtIn === "true";
  collaborators.kit.SourceConfigItemCard = ({ onRemove }) => <button onClick={onRemove}>Remove server</button>;
  collaborators.kit.InfoTip = ({ triggerLabel, label }) => <button aria-label={triggerLabel} title={label}>?</button>;
  const props = { ...collaborators, dependencies };
  const view = render(<ExternalMcpSettingsPanel {...props} />);
  const card = within(screen.getByRole("region", { name: "Site tools" }));
  expect(card.getByText("Built-in").textContent).toBe("Built-in");
  expect(card.queryByRole("button", { name: "Remove server" })).toBeNull();
  expect(card.getByRole("button", { name: "About Site tools" }).getAttribute("title"))
    .toBe("Lets this site's assistant list your other Host sites, add a site pointer, and reveal a site folder.");
  const toggle = card.getByRole("checkbox", { name: "Enable Site tools" });
  expect(toggle).toHaveProperty("checked", true);
  fireEvent.click(toggle);
  expect(list.update).toHaveBeenCalledExactlyOnceWith("built-in", { enabled: false });
  list.isPending.mockImplementation((id, kind) => id === "built-in" && kind === "update");
  view.rerender(<ExternalMcpSettingsPanel {...props} />);
  expect(card.getByRole("checkbox", { name: "Enable Site tools" })).toHaveProperty("disabled", true);
});

test("the OAuth row shows the current sign-in phase and sends shared sign-in to the correct destination", () => {
  const { collaborators, dependencies, list, source } = panelFixture();
  list.sources = [{ ...source, fields: { ...source.fields, authMode: "oauth", oauthGrant: "device_code" } }];
  type Connect = ExternalMcpSettingsPanelProps["hooks"]["useConnect"];
  let state: ReturnType<Connect>["state"] = { phase: "idle" };
  const connect = vi.fn<ReturnType<Connect>["connect"]>(async () => {});
  const cancel = vi.fn();
  const connectForSource = vi.fn<Connect>(() => ({ state, connect, cancel }));
  collaborators.hooks.useConnect = connectForSource;
  collaborators.deps.externalMcpNeedsSignIn = ({ source }) => source.fields.authMode === "oauth";
  collaborators.kit.ExternalMcpSharedChoice = ({ serverId, busy, signIn, onChanged }) => (
    <div><button disabled={busy} onClick={signIn}>Shared sign-in for {serverId}</button><button onClick={onChanged}>Apply shared choice</button></div>
  );
  const props = { ...collaborators, dependencies };
  const view = render(<ExternalMcpSettingsPanel {...props} />);
  const signIn = () => screen.getByRole("button", { name: "Sign in to Saved server" });
  expect(signIn().textContent).toBe("Connect");
  const [connectTarget, connectOptions] = connectForSource.mock.lastCall!;
  expect(connectTarget).toMatchObject({ serverId: "saved", grant: "device_code" });
  expect(connectOptions).toEqual({ fallbackError: "Sign-in could not start." });
  fireEvent.click(signIn());
  fireEvent.click(screen.getByRole("button", { name: "Shared sign-in for saved" }));
  expect(connect.mock.calls).toEqual([[], [{ destination: "shared" }]]);
  fireEvent.click(screen.getByRole("button", { name: "Apply shared choice" }));
  expect(list.reload).toHaveBeenCalledExactlyOnceWith();
  connectTarget.onConnected();
  expect(list.reload.mock.calls).toEqual([[], []]);

  state = { phase: "starting" };
  view.rerender(<ExternalMcpSettingsPanel {...props} />);
  expect(signIn()).toHaveProperty("disabled", true);
  expect(screen.queryByRole("status")).toBeNull();
  state = { phase: "device", userCode: "ABCD-1234", verificationUri: "https://login.example.test/activate?device=1" };
  view.rerender(<ExternalMcpSettingsPanel {...props} />);
  const device = within(screen.getByRole("status"));
  expect(device.getByText("ABCD-1234").textContent).toBe("ABCD-1234");
  expect(device.getByRole("link", { name: "login.example.test" }).getAttribute("href")).toBe("https://login.example.test/activate?device=1");
  fireEvent.click(device.getByRole("button", { name: "Cancel" }));
  expect(cancel).toHaveBeenCalledExactlyOnceWith();
  state = { phase: "waiting" };
  view.rerender(<ExternalMcpSettingsPanel {...props} />);
  expect(screen.getByRole("status").textContent).toContain("Finish signing in in the new window.");
  state = { phase: "idle", error: "Sign-in timed out." };
  view.rerender(<ExternalMcpSettingsPanel {...props} />);
  expect(screen.getByRole("alert").textContent).toBe("Sign-in timed out.");
});

test("saved intent defaults legacy rows without treating deliberately disabled sources as active", () => {
  const local = { id: "legacy", fields: { command: "local-launcher" } };
  const remote = { id: "remote", enabled: false, fields: { transport: "streamable_http", allowedToolNames: "read,create" } };
  const resolveTransport = (fields: Record<string, string>) => fields.transport ?? "stdio";
  const { result } = renderHook(() => useSavedAllowedToolNamesById({
    sources: [local, remote], resolveTransport, needsSignIn: ({ source }) => source.id === "remote",
  }));
  expect(result.current).toEqual({
    legacy: { enabled: true, transport: "stdio", allowedToolNames: "", command: "local-launcher", needsSignIn: false },
    remote: { enabled: false, transport: "streamable_http", allowedToolNames: "read,create", command: "", needsSignIn: true },
  });
});

test("drift messages use the active locale after a locale change", () => {
  const translate = ({ locale, key }: { locale: string; key: string }) => `${locale}:${key}`;
  const { result, rerender } = renderHook(
    ({ locale }) => useExternalMcpDriftCopy({ useLocaleHook: () => locale, translate }),
    { initialProps: { locale: "en" } },
  );
  expect(result.current("Needs review")).toBe("en:Needs review");
  rerender({ locale: "fr" });
  expect(result.current("Needs review")).toBe("fr:Needs review");
});

test("a hosted OAuth edit retains stored identity without submitting blank endpoints or secrets", async () => {
  const ports = controllerPorts();
  const oauth: AdminExternalMcpServer = { ...server, transport: "streamable_http", authMode: "oauth", command: "",
    url: "https://docs.example.test/mcp", envNames: ["DOCS_REGION", "DOCS_KEY"],
    oauth: { ...server.oauth, status: "connected", providerId: "documents", clientId: "client-a", scopes: ["read", "write"],
      grant: "authorization_code", hasStoredToken: true },
  };
  ports.listExternalMcpServers.mockResolvedValue({ servers: [oauth] });
  ports.saveExternalMcpServer.mockResolvedValue({ server: { ...oauth, version: 8, label: "Renamed docs" } });
  const { result } = renderController({ ...controllerDeps(ports), formatCredentialHints: () => "" });
  const port = result.current.dependencies.port;
  const loaded = await port.fetchSources();
  expect(loaded).toMatchObject([{ id: "saved", statusMessage: "Credentials set: DOCS_REGION, DOCS_KEY",
    fields: { env: "", oauthClientSecret: "", oauthProviderId: "documents", oauthScopes: "read write", oauthStatus: "connected" } }]);
  await act(async () => {
    expect(await port.updateSource("saved", { label: "Renamed docs", fields: { oauthTokenEndpoint: "https://login.example.test/token" } }))
      .toMatchObject({ id: "saved", label: "Renamed docs", fields: { version: "8" } });
  });
  expect(ports.saveExternalMcpServer).toHaveBeenCalledExactlyOnceWith({ serverId: "saved", body: {
    label: "Renamed docs", transport: "streamable_http", enabled: true, expectedVersion: 7,
    command: "", url: "https://docs.example.test/mcp", args: "", allowedToolNames: "read", writeAllowedToolNames: "",
    authMode: "oauth", oauth: { providerId: "documents", clientId: "client-a", grant: "authorization_code",
      scopes: "read write", tokenEnvName: "", tokenEndpoint: "https://login.example.test/token" },
  } });
  expect(ports.probeExternalMcpServer).not.toHaveBeenCalled();
});

test("failed saves return localized copy without installing a source or setting restart required", async () => {
  const ports = controllerPorts();
  const failure = new Error("conflict-free write unavailable");
  ports.saveExternalMcpServer.mockRejectedValue(failure);
  const describeApiError = vi.fn<ControllerDeps["describeApiError"]>(({ fallback }) => fallback);
  const { result } = renderController({ ...controllerDeps(ports), describeApiError, translateCredentialMessage: ({ message, locale }) => `${locale}:${message}` });
  const port = result.current.dependencies.port;
  expect(await port.addSource({ fields: { id: "new", command: "new-server" } }))
    .toEqual({ ok: false, message: "fr:That server could not be saved." });
  expect(describeApiError).toHaveBeenCalledExactlyOnceWith({ e: failure, fallback: "That server could not be saved." });
  expect(await port.updateSource("new", { enabled: false })).toBeNull();
  expect(result.current.restartRequired).toBe(false);
  expect(ports.probeExternalMcpServer).not.toHaveBeenCalled();
});

test("updating a credential probes the saved source but never echoes the token", async () => {
  const ports = controllerPorts();
  const hosted = { ...server, transport: "streamable_http", authMode: "static_env", command: "", url: "https://example.test/mcp" };
  ports.listExternalMcpServers.mockResolvedValue({ servers: [hosted] });
  ports.saveExternalMcpServer.mockResolvedValue({ server: { ...hosted, version: 8, hasAccessToken: true } });
  ports.probeExternalMcpServer.mockResolvedValue({ tools: [] });
  const { result } = renderController(controllerDeps(ports));
  const port = result.current.dependencies.port;
  await port.fetchSources();
  await act(async () => {
    expect(await port.updateSource("saved", { fields: { accessToken: "fixture-token" } })).toMatchObject({
      id: "saved", statusMessage: "set · connected", fields: { accessToken: "", version: "8" },
    });
  });
  expect(ports.saveExternalMcpServer).toHaveBeenCalledExactlyOnceWith({ serverId: "saved", body: {
    expectedVersion: 7, label: "Saved", transport: "streamable_http", authMode: "static_env", enabled: true,
    command: "", url: "https://example.test/mcp", args: "", allowedToolNames: "read", writeAllowedToolNames: "", accessToken: "fixture-token",
  } });
  expect(ports.probeExternalMcpServer).toHaveBeenCalledExactlyOnceWith({ serverId: "saved" });
});

test("an unrelated edit round-trips empty and whitespace-bearing stdio arguments", async () => {
  const ports = controllerPorts();
  const original = { ...server, args: ["", "path with spaces", "--quiet"] };
  ports.listExternalMcpServers.mockResolvedValue({ servers: [original] });
  ports.saveExternalMcpServer.mockResolvedValue({ server: { ...original, enabled: false, version: 8 } });
  const { result } = renderController(controllerDeps(ports));
  const port = result.current.dependencies.port;
  await port.fetchSources();
  await act(async () => { await port.updateSource("saved", { enabled: false }); });
  expect(ports.saveExternalMcpServer.mock.calls.map(([request]) => ({
    serverId: request.serverId, enabled: request.body.enabled, args: request.body.args,
  }))).toEqual([{ serverId: "saved", enabled: false, args: '"" "path with spaces" --quiet' }]);
});
