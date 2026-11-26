import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PublishContentDialog } from "../PublishContentDialog.js";
import type { PublishContentConfirmView } from "../hooks/publish-confirm-view.js";

afterEach(cleanup);

const view: PublishContentConfirmView = {
  phase: { kind: "idle" }, peers: [], selectedPeerId: null,
  onSelectPeer: vi.fn(), peerSelectionEnabled: true, dismissible: true, onDismiss: vi.fn(),
  rows: [], listedRows: [], upToDateRows: [], upToDateLabel: null, upToDateExpanded: false,
  onToggleUpToDate: vi.fn(), columnCount: 4, summary: null,
  selectedKeys: new Set(), carriedAlongKeys: new Set(), onToggleRow: vi.fn(), onToggleAll: vi.fn(),
  selectionEnabled: true, allSelected: false, someSelected: false, liveCanOverwrite: true,
  overwriteKeys: new Set(), overwriteOfferKeys: new Set(), showOverwriteColumn: false,
  onToggleOverwrite: vi.fn(), onToggleAllOverwrite: vi.fn(), allOverwriteTicked: false,
  someOverwriteTicked: false, overwriteWarning: null, overwriteMismatch: null,
  overwriteUnavailable: null, title: "Publish", description: "Content",
  primaryKind: "start", primaryLabel: "Connect", primaryDisabled: false, onPrimary: vi.fn(),
  errorMessage: null, refusalReason: null, doneMessage: null, doneNotices: [], doneProblems: [],
  liveGapNotices: [], connectOffer: { message: "Connect the candidate site", candidateUrl: "https://live.test" },
};
const kit: Parameters<typeof PublishContentDialog>[0]["kit"] = {
  Dialog: ({ title, children, onClose }) => <section><h2>{title}</h2>{children}<button onClick={onClose}>Dismiss</button></section>,
};
const deps = { formRecipientNotice: "Recipients remain local" };

test("the no-peer offer uses one primary connect action and the supplied confirmation hook", () => {
  const onCancel = vi.fn();
  const usePublishContentConfirmHook = vi.fn((_required: Parameters<Parameters<typeof PublishContentDialog>[0]["hooks"]["usePublishContentConfirmHook"]>[0]) => view);
  render(<PublishContentDialog onCancel={onCancel} t={key => key} kit={kit} deps={deps} hooks={{ usePublishContentConfirmHook }} />);
  expect(screen.getByText("Connect the candidate site")).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  expect(view.onPrimary).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(view.onDismiss).toHaveBeenCalledOnce();
  expect(usePublishContentConfirmHook.mock.calls[0]?.[0].onCancel).toBe(onCancel);
});

test("a single peer is named and multiple peers expose the controlled target picker", () => {
  const single = { ...view, connectOffer: null, peers: [{ id: "one", label: "One", baseUrl: "https://one.test", remoteWorkspaceId: "one", masked: null, hasCredential: true }] };
  const mounted = render(<PublishContentDialog onCancel={() => {}} t={key => key} kit={kit} deps={deps} hooks={{ usePublishContentConfirmHook: () => single }} />);
  expect(screen.getByText("Publishing to")).toBeTruthy();
  expect(screen.getByText("One")).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  const onSelectPeer = vi.fn();
  const multiple = { ...single, peers: [...single.peers, { id: "two", label: "Two", baseUrl: "https://two.test", remoteWorkspaceId: "two", masked: null, hasCredential: true }], onSelectPeer };
  mounted.rerender(<PublishContentDialog onCancel={() => {}} t={key => key} kit={kit} deps={deps} hooks={{ usePublishContentConfirmHook: () => multiple }} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "two" } });
  expect(onSelectPeer).toHaveBeenCalledExactlyOnceWith({ peerId: "two" });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { bindPublishContentConfirm } from "../hooks/use-publish-content-confirm.hooks.js";
import { applyPublishCriteria, preparePublishConfirmation, toPublishReportRows,
  type PublishContentReport, type PublishContentPlanResult } from "../../../publish/content/ui/index.js";
import { TEST_POLICY } from "../../../publish/content/ui/__tests__/test-policy.js";
import type { PublishContentPort } from "../hooks/publish-content-port.hooks.js";

const peer = { id: "live", label: "Live", baseUrl: "https://live.test", remoteWorkspaceId: "local", masked: null, hasCredential: true };
const report: PublishContentReport = { refused: false, refusalReason: null, applyOrder: ["post", "media"], rows: [
  { entityType: "post", entityId: "one", entityLabel: "One", outcome: "created", writes: true, reason: null },
  { entityType: "post", entityId: "two", entityLabel: "Two", outcome: "created", writes: true, reason: null },
  { entityType: "media", entityId: "photo", entityLabel: "Photo", outcome: "created", writes: true, reason: null, includedFor: ["post:one"] },
] };

function ceremony(peers = [peer]) {
  let now = 1000;
  const plan: PublishContentPlanResult = { planId: "plan", planHash: "hash", bundleId: "bundle", details: report, liveCanOverwrite: true };
  const port = {
    listPeers: vi.fn(async () => ({ peers })),
    getDestination: vi.fn(async () => ({ connected: false, site: null, candidateUrl: "https://live.test", message: "Connect", nextStep: null })),
    connectDestination: vi.fn(async () => ({ connected: true, site: peer, candidateUrl: null, message: "Connected", nextStep: null })),
    planPublish: vi.fn<PublishContentPort["planPublish"]>(async input => {
      const keep = input.selectedEntityKeys === undefined ? null : new Set(input.selectedEntityKeys);
      return { ...plan, bundleId: keep === null ? "bundle" : "narrowed",
        ...(input.overwriteEntityKeys === undefined ? {} : { overwriteEntityKeys: input.overwriteEntityKeys }),
        details: { ...report, rows: report.rows.filter(row => keep === null || keep.has(`${row.entityType}:${row.entityId}`) || row.includedFor?.some(key => keep.has(key))) } };
    }),
    confirmPublish: vi.fn<PublishContentPort["confirmPublish"]>(async () => ({ confirmationToken: "confirmed" })),
    executePublish: vi.fn<PublishContentPort["executePublish"]>(async () => ({ restorePointId: "restore", runId: "run", changeSetIds: ["change"] })),
  };
  const useConfirm = bindPublishContentConfirm({ port, hooks: { useLocaleHook: () => "en" }, deps: {
    applyPublishCriteria: required => applyPublishCriteria({ ...required, typeAliases: {} }),
    preparePublishConfirmation: required => preparePublishConfirmation({ ...required, driftMessage: "Changed" }),
    toPublishReportRows: (required, options) => toPublishReportRows({ ...required, policy: TEST_POLICY }, options),
    publishEntityTypePluralLabel: ({ entityType }) => entityType,
    publishSectionForEntityTypes: () => undefined,
    publishScopeTitleKey: () => "Publish", publishScopeDescriptionKey: () => "Content",
    describeApiError: ({ e, fallback }) => e instanceof Error ? e.message : fallback,
    now: () => now, overwriteUnavailableKey: "Update the host first",
  } });
  return { port, plan, useConfirm, advance: () => { now += 401; } };
}

test("planning cannot execute; one confirmed token executes once after confirm arming", async () => {
  const { port, useConfirm, advance } = ceremony();
  let confirm!: (value: { confirmationToken: string }) => void;
  port.confirmPublish.mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
  const { result } = renderHook(() => useConfirm({ onCancel: vi.fn(), t: key => key }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  expect(port.confirmPublish).not.toHaveBeenCalled();
  expect(port.executePublish).not.toHaveBeenCalled();
  act(() => result.current.onPrimary());
  expect(port.confirmPublish).not.toHaveBeenCalled();
  advance();
  act(() => { result.current.onPrimary(); result.current.onPrimary(); });
  await waitFor(() => expect(port.confirmPublish).toHaveBeenCalledTimes(1));
  expect(port.confirmPublish).toHaveBeenCalledExactlyOnceWith({ peerId: "live", planId: "plan", planHash: "hash" });
  expect(port.executePublish).not.toHaveBeenCalled();
  await act(async () => confirm({ confirmationToken: "confirmed" }));
  await waitFor(() => expect(result.current.phase.kind).toBe("done"));
  expect(port.executePublish).toHaveBeenCalledExactlyOnceWith({ peerId: "live", bundleId: "bundle", confirmationToken: "confirmed" });
});

test("multiple peers require selection; changing peer discards its report and selection", async () => {
  const { port, useConfirm } = ceremony([peer, { ...peer, id: "second", label: "Second" }]);
  const { result } = renderHook(() => useConfirm({ onCancel: vi.fn(), t: key => key }));
  await waitFor(() => expect(result.current.peers).toHaveLength(2));
  expect(result.current.selectedPeerId).toBeNull();
  act(() => result.current.onPrimary());
  expect(port.planPublish).not.toHaveBeenCalled();
  act(() => result.current.onSelectPeer({ peerId: "second" }));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  expect(port.planPublish).toHaveBeenCalledWith({ peerId: "second" });
  expect([...result.current.carriedAlongKeys]).toEqual(["media:photo"]);
  act(() => result.current.onToggleRow({ key: "post:one" }));
  expect(result.current.carriedAlongKeys.size).toBe(0);
  expect(result.current.selectedKeys.has("post:two")).toBe(true);
  act(() => result.current.onSelectPeer({ peerId: "live" }));
  expect(result.current.phase.kind).toBe("idle");
  expect(result.current.rows).toEqual([]);
  expect(port.executePublish).not.toHaveBeenCalled();
});

test("an empty peer list discovers and connects its destination before planning", async () => {
  const { port, useConfirm } = ceremony([]);
  const { result } = renderHook(() => useConfirm({ onCancel: vi.fn(), t: key => key }));
  await waitFor(() => expect(result.current.connectOffer?.candidateUrl).toBe("https://live.test"));
  expect(port.getDestination).toHaveBeenCalledOnce();
  expect(port.planPublish).not.toHaveBeenCalled();
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  expect(port.connectDestination).toHaveBeenCalledExactlyOnceWith({});
  expect(result.current.selectedPeerId).toBe("live");
  expect(port.planPublish).toHaveBeenCalledExactlyOnceWith({ peerId: "live" });
  expect(port.confirmPublish).not.toHaveBeenCalled();
});

test("closing during a plan request drops its response and never confirms or executes", async () => {
  const { port, plan, useConfirm } = ceremony();
  let resolve!: (value: PublishContentPlanResult) => void;
  port.planPublish.mockImplementation(() => new Promise(done => { resolve = done; }));
  const onCancel = vi.fn();
  const { result, unmount } = renderHook(() => useConfirm({ onCancel, t: key => key }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  expect(result.current.phase.kind).toBe("planning");
  act(() => result.current.onSelectPeer({ peerId: "other" }));
  expect(result.current.selectedPeerId).toBe("live");
  act(() => result.current.onDismiss());
  expect(onCancel).toHaveBeenCalledOnce();
  unmount();
  await act(async () => resolve(plan));
  expect(result.current.phase.kind).toBe("planning");
  expect(port.confirmPublish).not.toHaveBeenCalled();
  expect(port.executePublish).not.toHaveBeenCalled();
});

test("an overwrite replan mismatch shows the new report and requires another review", async () => {
  const { port, plan, useConfirm } = ceremony();
  const blocked = { ...report.rows[0]!, outcome: "blocked" as const, writes: false, canOverwrite: true };
  port.planPublish.mockResolvedValueOnce({ ...plan, details: { ...report, rows: [blocked, report.rows[1]!] } });
  const { result } = renderHook(() => useConfirm({ onCancel: vi.fn(), t: key => key }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  port.planPublish.mockResolvedValueOnce({ ...plan, overwriteEntityKeys: ["post:one"], details: { ...report, rows: [{ ...blocked, outcome: "forced", writes: true }] } });
  act(() => result.current.onToggleOverwrite("post:one"));
  await waitFor(() => expect(result.current.overwriteMismatch).toContain("Live changed while you were deciding"));
  expect(result.current.rows).toHaveLength(1);
  expect(port.confirmPublish).not.toHaveBeenCalled();
  expect(port.executePublish).not.toHaveBeenCalled();
  let release!: (value: PublishContentPlanResult) => void;
  port.planPublish.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  act(() => result.current.onToggleOverwrite("post:one"));
  act(() => result.current.onSelectPeer({ peerId: "other" }));
  await act(async () => release(plan));
  expect(result.current.selectedPeerId).toBe("other");
  expect(result.current.phase.kind).toBe("idle");
  expect(result.current.rows).toEqual([]);

});

test("criteria pre-plan the scoped selection and carry its media into the confirmed bundle", async () => {
  const { port, useConfirm, advance } = ceremony();
  const onPlanned = vi.fn();
  const scope = { entityTypes: ["post"] };
  const { result } = renderHook(() => useConfirm({ onCancel: vi.fn(), t: key => key,
    criteria: { items: ["One"] }, scope, onPlanned }));
  await waitFor(() => expect(onPlanned).toHaveBeenCalledOnce());
  expect(port.planPublish).toHaveBeenCalledExactlyOnceWith({ peerId: "live", scope });
  expect([...result.current.selectedKeys]).toEqual(["post:one"]);
  expect([...result.current.carriedAlongKeys]).toEqual(["media:photo"]);
  expect(port.confirmPublish).not.toHaveBeenCalled();
  expect(port.executePublish).not.toHaveBeenCalled();
  advance();
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("done"));
  expect(port.planPublish).toHaveBeenLastCalledWith({ peerId: "live", scope, selectedEntityKeys: ["post:one"] });
  expect(port.executePublish).toHaveBeenCalledExactlyOnceWith({ peerId: "live", bundleId: "narrowed", confirmationToken: "confirmed" });
});
