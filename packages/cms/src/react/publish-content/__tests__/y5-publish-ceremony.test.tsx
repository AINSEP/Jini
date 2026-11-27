import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { overwriteTooltipFor, reportRowNote } from "../hooks/publish-content-confirm.rules.js";
import { afterEach, expect, test, vi } from "vitest";
import { bindPublishContentDialog, PublishContentDialog } from "../PublishContentDialog.js";
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
import { bindPublishContentConfirm, type usePublishContentConfirm } from "../hooks/use-publish-content-confirm.hooks.js";
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

function ceremony(peers = [peer], prepare: Parameters<typeof usePublishContentConfirm>[0]["deps"]["preparePublishConfirmation"] =
  required => preparePublishConfirmation({ ...required, driftMessage: "Changed" })) {
  let now = 1000;
  const plan: PublishContentPlanResult = { planId: "plan", planHash: "hash", bundleId: "bundle", details: report, liveCanOverwrite: true };
  const port = {
    listPeers: vi.fn(async () => ({ peers })),
    getDestination: vi.fn<PublishContentPort["getDestination"]>(async () => ({ connected: false, site: null, candidateUrl: "https://live.test", message: "Connect", nextStep: null })),
    connectDestination: vi.fn<PublishContentPort["connectDestination"]>(async () => ({ connected: true, site: peer, candidateUrl: null, message: "Connected", nextStep: null })),
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
    preparePublishConfirmation: prepare,
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

test("bound dialog swaps plan for a fresh confirm control and routes native close through the active hook", () => {
  const onDismiss = vi.fn(), onPrimary = vi.fn();
  const plannedHook = vi.fn(() => ({ ...view, connectOffer: null, primaryLabel: "Review plan" }));
  const confirmingHook = vi.fn(() => ({ ...view, connectOffer: null, primaryKind: "confirm" as const,
    primaryLabel: "Publish 2 items", dismissible: false, onDismiss, onPrimary }));
  const Bound = bindPublishContentDialog({ kit, deps, hooks: { usePublishContentConfirmHook: plannedHook } });
  const onCancel = vi.fn(), t = (key: string) => key;
  const { rerender } = render(<Bound {...{ onCancel, t }} />);
  const planButton = screen.getByRole("button", { name: "Review plan" });
  expect(planButton.getAttribute("data-agent-element")).toBe("dashboard-publish-content-plan");
  rerender(<Bound {...{ onCancel, t }} usePublishContentConfirmHook={confirmingHook} />);
  const confirm = screen.getByRole("button", { name: "Publish 2 items" });
  expect(confirm).not.toBe(planButton);
  expect(planButton.isConnected).toBe(false);
  expect(confirm.getAttribute("data-agent-element")).toBe("dashboard-publish-content-confirm");
  fireEvent.click(confirm);
  expect(onPrimary).toHaveBeenCalledExactlyOnceWith();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onDismiss).toHaveBeenCalledExactlyOnceWith();
  expect(onCancel).not.toHaveBeenCalled();
  expect(plannedHook).toHaveBeenCalledExactlyOnceWith({ onCancel, t, criteria: undefined, scope: undefined, port: undefined, onPlanned: undefined, confirmArmDelayMs: undefined });
  expect(confirmingHook).toHaveBeenCalledExactlyOnceWith({ onCancel, t, criteria: undefined, scope: undefined, port: undefined, onPlanned: undefined, confirmArmDelayMs: undefined });
});

test("report shows partial selection, notices and outcome-specific rows and reveals up-to-date entries on request", () => {
  const entries = toPublishReportRows({ report: { ...report, rows: [
    { entityType: "form", entityId: "signup", entityLabel: "Signup", outcome: "created", writes: true, reason: null },
    { entityType: "post", entityId: "overlap", entityLabel: "Overlap", outcome: "blocked", writes: false, reason: null, canOverwrite: true },
    { entityType: "post", entityId: "same", entityLabel: "Same article", outcome: "unchanged", writes: false, reason: null },
    { entityType: "post", entityId: "retired", entityLabel: "Retired story", outcome: "applied", writes: true, reason: null, trashes: true },
  ] }, policy: TEST_POLICY });
  const signup = entries.find(row => row.entityId === "signup")!;
  const overlap = { ...entries.find(row => row.entityId === "overlap")!, retiresLabel: "Live overlap", referencedByLabels: ["Footer", "Main menu"], reason: "Changed on live" };
  const same = { ...entries.find(row => row.entityId === "same")!, reason: null };
  const retired = { ...entries.find(row => row.entityId === "retired")!, usedByNote: "Used by archive", reason: "fallback reason" };
  const rows = [signup, overlap, same, retired];
  const onToggleAll = vi.fn(), onToggleAllOverwrite = vi.fn(), onToggleRow = vi.fn(), onToggleOverwrite = vi.fn();
  const base = {
    ...view, connectOffer: null, rows, listedRows: [signup, overlap, retired], upToDateRows: [same],
    upToDateLabel: "1 already up to date", columnCount: 5, showOverwriteColumn: true,
    summary: { total: 4, publishing: 2, unchanged: 1, skipped: 1 }, overwriteOfferKeys: new Set(["post:overlap"]),
    selectedKeys: new Set(["form:signup"]), someSelected: true, someOverwriteTicked: true,
    overwriteWarning: "Live content will be replaced", overwriteMismatch: "Plan changed on live",
    overwriteUnavailable: "Upgrade the live site", refusalReason: "One write was refused", errorMessage: "Transport error",
    doneMessage: "Published 2 changes.", doneNotices: ["Menu links could not be updated"],
    doneProblems: ["Signup could not be verified"], liveGapNotices: ["One dependency is missing on live"],
    onToggleAll, onToggleAllOverwrite, onToggleRow, onToggleOverwrite,
  };
  function Probe({ locked = false }: { locked?: boolean }) {
    const [upToDateExpanded, setExpanded] = useState(false);
    return <PublishContentDialog onCancel={() => {}} t={key => key} kit={kit} deps={deps}
      hooks={{ usePublishContentConfirmHook: () => ({ ...base, upToDateExpanded, selectionEnabled: !locked, onToggleUpToDate: () => setExpanded(open => !open) }) }} />;
  }
  const { rerender } = render(<Probe />);
  expect(screen.getByText("Recipients remain local").textContent).toBe("Recipients remain local");
  expect(screen.getByText("2 to publish · 1 unchanged · 1 skipped").textContent).toBe("2 to publish · 1 unchanged · 1 skipped");
  expect(screen.getAllByRole("alert").map(alert => alert.textContent)).toEqual([
    "One write was refused", "Transport error", "Published, but these won't show correctly on the live site:Signup could not be verified", "Plan changed on live",
  ]);
  for (const line of ["Published 2 changes.", "Menu links could not be updated", "One dependency is missing on live", "Live content will be replaced", "Upgrade the live site"]) {
    expect(screen.getByText(line).textContent).toBe(line);
  }
  const selectAll = screen.getByRole<HTMLInputElement>("checkbox", { name: "Publish every item that can be published" });
  const overwriteAll = screen.getByRole<HTMLInputElement>("checkbox", { name: "Overwrite every item that can replace something on live" });
  expect(selectAll.indeterminate).toBe(true);
  expect(overwriteAll.indeterminate).toBe(true);
  fireEvent.click(selectAll);
  fireEvent.click(overwriteAll);
  expect(onToggleAll).toHaveBeenCalledOnce();
  expect(onToggleAllOverwrite).toHaveBeenCalledOnce();
  const overlapRow = screen.getByRole("row", { name: /Overlap/ });
  expect(within(overlapRow).queryByRole("checkbox", { name: /Publish/ })).toBeNull();
  expect(within(overlapRow).getByText("Changed on live").textContent).toBe("Changed on live");
  const overwrite = within(overlapRow).getByRole("checkbox", { name: "Overwrite on live: Live overlap" });
  expect(overwrite.getAttribute("title")).toBe("Live overlap moves to Trash. Menu links follow: Footer, Main menu");
  fireEvent.click(overwrite);
  expect(onToggleOverwrite).toHaveBeenCalledExactlyOnceWith("post:overlap");
  const toggleForm = screen.getByRole<HTMLInputElement>("checkbox", { name: "Publish form Signup" });
  expect(toggleForm.checked).toBe(true);
  fireEvent.click(toggleForm);
  expect(onToggleRow).toHaveBeenCalledExactlyOnceWith({ key: "form:signup" });
  const retiredRow = screen.getByRole("row", { name: /Retired story/ });
  expect(retiredRow.querySelector(".status-trashed")?.textContent).toBe(retired.dispositionLabel);
  expect(within(retiredRow).getByText("Used by archive").textContent).toBe("Used by archive");
  expect(within(retiredRow).queryByText("fallback reason")).toBeNull();
  const fold = screen.getByRole("button", { name: "1 already up to date" });
  expect(fold.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Same article")).toBeNull();
  fireEvent.click(fold);
  expect(fold.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("Same article").textContent).toBe("Same article");
  expect(overlapRow.querySelector(".status-warning")?.textContent).toBe(overlap.dispositionLabel);
  expect(screen.getByRole("row", { name: /Same article/ }).querySelector(".status-draft")?.textContent).toBe(same.dispositionLabel);
  rerender(<Probe locked />);
  expect(selectAll.disabled).toBe(true);
  expect(overwriteAll.disabled).toBe(true);
});

test("row notes and retirement tooltips distinguish absent data from actionable reasons", () => {
  const t = (key: string) => `[ ${key} ]`;
  expect(overwriteTooltipFor({ retiresLabel: null, referencedByLabels: [] }, t)).toBeUndefined();
  expect(overwriteTooltipFor({ retiresLabel: "Old page", referencedByLabels: [] }, t)).toBe("Old page [ moves to ] [ Trash ]");
  expect(reportRowNote({ usedByNote: null, reason: null }, t)).toBeNull();
  expect(reportRowNote({ usedByNote: "Used by Home", reason: "Ignored" }, t)).toBe("[ Used by Home ]");
  expect(reportRowNote({ usedByNote: null, reason: "Changed on live" }, t)).toBe("Changed on live");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const identity = (key: string) => key;

test("discovery errors stay visible and never become connection offers", async () => {
  const first = ceremony();
  first.port.listPeers.mockRejectedValueOnce(new Error("Targets inaccessible"));
  const peers = renderHook(() => first.useConfirm({ onCancel: () => {}, t: identity }));
  await waitFor(() => expect(peers.result.current.errorMessage).toBe("Targets inaccessible"));
  expect(peers.result.current.connectOffer).toBeNull();
  expect(first.port.getDestination).not.toHaveBeenCalled();
  peers.unmount();

  const second = ceremony([]);
  second.port.getDestination.mockRejectedValueOnce("opaque network rejection");
  const destination = renderHook(() => second.useConfirm({ onCancel: () => {}, t: identity }));
  await waitFor(() => expect(destination.result.current.errorMessage).toBe("Could not check whether this install can publish yet."));
  expect(destination.result.current.connectOffer).toBeNull();
  act(() => destination.result.current.onPrimary());
  expect(second.port.planPublish).not.toHaveBeenCalled();
  expect(second.port.connectDestination).not.toHaveBeenCalled();
});

test("a missing site or failed connect leaves planning untouched and a later successful connect can proceed", async () => {
  const { port, useConfirm } = ceremony([]);
  port.connectDestination.mockResolvedValueOnce({ connected: false, site: null, candidateUrl: null, message: "Incomplete", nextStep: null });
  port.connectDestination.mockRejectedValueOnce(new Error("Could not reach host"));
  const { result } = renderHook(() => useConfirm({ onCancel: () => {}, t: identity }));
  await waitFor(() => expect(result.current.connectOffer?.candidateUrl).toBe("https://live.test"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.errorMessage).toBe("Could not connect."));
  expect(result.current.primaryDisabled).toBe(false);
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.errorMessage).toBe("Could not reach host"));
  expect(port.planPublish).not.toHaveBeenCalled();
  expect(result.current.selectedPeerId).toBeNull();
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  expect(result.current.errorMessage).toBeNull();
  expect(port.connectDestination.mock.calls).toEqual([[{}], [{}], [{}]]);
  expect(port.planPublish).toHaveBeenCalledExactlyOnceWith({ peerId: "live" });
});

test("a late connection response after unmount never starts planning for its newly connected site", async () => {
  const { port, useConfirm } = ceremony([]);
  const pending = deferred<Awaited<ReturnType<PublishContentPort["connectDestination"]>>>();
  port.connectDestination.mockReturnValueOnce(pending.promise);
  const { result, unmount } = renderHook(() => useConfirm({ onCancel: () => {}, t: identity }));
  await waitFor(() => expect(result.current.connectOffer?.candidateUrl).toBe("https://live.test"));
  act(() => result.current.onPrimary());
  expect(port.connectDestination).toHaveBeenCalledExactlyOnceWith({});
  unmount();
  await act(async () => pending.resolve({ connected: true, site: peer, candidateUrl: null, message: "Connected", nextStep: null }));
  expect(port.planPublish).not.toHaveBeenCalled();
});

test("a failed plan can be retried, and an older live site warns only about conflicts it cannot overwrite", async () => {
  const { port, plan, useConfirm } = ceremony();
  port.planPublish.mockRejectedValueOnce(new Error("Staging failed"));
  const blocked = { ...report.rows[0]!, outcome: "blocked" as const, writes: false, canOverwrite: true };
  port.planPublish.mockResolvedValueOnce({ ...plan, liveCanOverwrite: false, details: { ...report, rows: [blocked] } });
  const { result } = renderHook(() => useConfirm({ onCancel: () => {}, t: identity }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.errorMessage).toBe("Staging failed"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.overwriteUnavailable).toBe("Live Update the host first"));
  expect(result.current.errorMessage).toBeNull();
  expect(result.current.showOverwriteColumn).toBe(false);
  expect(result.current.primaryDisabled).toBe(true);
  expect(port.planPublish.mock.calls).toEqual([[{ peerId: "live" }], [{ peerId: "live" }]]);
  expect(port.confirmPublish).not.toHaveBeenCalled();
});

test("bulk and per-row selection update both the checked rows and the dependencies they carry", async () => {
  const { port, useConfirm } = ceremony();
  const { result } = renderHook(() => useConfirm({ onCancel: () => {}, t: identity, confirmArmDelayMs: 0 }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  expect([...result.current.selectedKeys]).toEqual(["post:one", "post:two"]);
  act(() => result.current.onToggleRow({ key: "post:one" }));
  expect([...result.current.selectedKeys]).toEqual(["post:two"]);
  act(() => result.current.onToggleRow({ key: "post:one" }));
  expect([...result.current.carriedAlongKeys]).toEqual(["media:photo"]);
  act(() => result.current.onToggleAll());
  expect([...result.current.selectedKeys]).toEqual([]);
  expect([...result.current.carriedAlongKeys]).toEqual([]);
  expect(result.current.primaryDisabled).toBe(true);
  act(() => result.current.onPrimary());
  expect(port.confirmPublish).not.toHaveBeenCalled();
  act(() => result.current.onToggleAll());
  expect([...result.current.selectedKeys]).toEqual(["post:one", "post:two"]);
  expect([...result.current.carriedAlongKeys]).toEqual(["media:photo"]);
  expect(result.current.primaryDisabled).toBe(false);
});

test("criteria report an overwrite only after its replan and bulk untick restores the reviewed base", async () => {
  const { port, plan, useConfirm } = ceremony();
  const blocked = { ...report.rows[0]!, outcome: "blocked" as const, writes: false, canOverwrite: true };
  const base = { ...plan, details: { ...report, rows: [blocked, report.rows[1]!] } };
  const refreshed = deferred<PublishContentPlanResult>();
  port.planPublish.mockResolvedValueOnce(base).mockReturnValueOnce(refreshed.promise);
  const onPlanned = vi.fn();
  const { result } = renderHook(() => useConfirm({ onCancel: () => {}, t: identity, criteria: { items: ["One"], overwrite: true }, onPlanned }));
  await waitFor(() => expect(port.planPublish).toHaveBeenLastCalledWith({ peerId: "live", overwriteEntityKeys: ["post:one"] }));
  expect(onPlanned).not.toHaveBeenCalled();
  expect(result.current.primaryDisabled).toBe(true);
  const forced = { ...base, overwriteEntityKeys: ["post:one"], details: { ...base.details, rows: [{ ...blocked, outcome: "forced" as const, writes: true }, report.rows[1]!] } };
  await act(async () => refreshed.resolve(forced));
  await waitFor(() => expect(onPlanned).toHaveBeenCalledExactlyOnceWith({
    opened: true, planned: true, site: "Live", willPublish: ["One"], willOverwrite: ["One"],
    leftAlone: [], unmatchedItems: [], unknownTypes: [], nextStep: "Check the list in the Publish dialog, then click Publish.",
  }));
  expect(result.current.allOverwriteTicked).toBe(true);
  act(() => result.current.onToggleAllOverwrite());
  expect(result.current.rows.find(row => row.key === "post:one")?.disposition).toBe("skipped");
  expect(port.planPublish).toHaveBeenCalledTimes(2);
  port.planPublish.mockResolvedValueOnce(forced);
  act(() => result.current.onToggleAllOverwrite());
  await waitFor(() => expect(result.current.rows.find(row => row.key === "post:one")?.outcome).toBe("forced"));
  expect(port.planPublish).toHaveBeenLastCalledWith({ peerId: "live", overwriteEntityKeys: ["post:one"] });
  expect(onPlanned).toHaveBeenCalledTimes(1);
  expect(port.confirmPublish).not.toHaveBeenCalled();
});

test("an overwrite replan failure is shown and clears the pending state for a fresh review", async () => {
  const { port, plan, useConfirm } = ceremony();
  const blocked = { ...report.rows[0]!, outcome: "blocked" as const, writes: false, canOverwrite: true };
  port.planPublish.mockResolvedValueOnce({ ...plan, details: { ...report, rows: [blocked] } });
  const { result } = renderHook(() => useConfirm({ onCancel: () => {}, t: identity }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.showOverwriteColumn).toBe(true));
  port.planPublish.mockRejectedValueOnce("peer unavailable");
  act(() => result.current.onToggleOverwrite("post:one"));
  await waitFor(() => expect(result.current.errorMessage).toBe("Could not work out what would be published."));
  expect(port.planPublish).toHaveBeenLastCalledWith({ peerId: "live", overwriteEntityKeys: ["post:one"] });
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  expect(result.current.errorMessage).toBeNull();
  expect([...result.current.overwriteKeys]).toEqual([]);
  expect(port.confirmPublish).not.toHaveBeenCalled();
});

test("a narrowed plan with different writes replaces the review without confirming unseen rows", async () => {
  const { port, plan, useConfirm } = ceremony();
  const changed = { ...plan, details: { ...report, rows: [{ ...report.rows[1]!, entityId: "surprise", entityLabel: "Unexpected row" }] } };
  port.planPublish.mockResolvedValueOnce(plan).mockResolvedValueOnce(changed);
  const { result } = renderHook(() => useConfirm({ onCancel: () => {}, t: identity, confirmArmDelayMs: 0 }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  act(() => result.current.onToggleRow({ key: "post:one" }));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.overwriteMismatch).toBe("Live changed while you were deciding. Check the list again."));
  expect(result.current.rows.map(row => row.entityLabel)).toEqual(["Unexpected row"]);
  expect(port.planPublish).toHaveBeenLastCalledWith({ peerId: "live", selectedEntityKeys: ["post:two"] });
  expect(port.confirmPublish).not.toHaveBeenCalled();
  expect(port.executePublish).not.toHaveBeenCalled();
});

test("a narrowed plan with an explicit refusal goes back to review without a confirmation token", async () => {
  const prepare = vi.fn<Parameters<typeof usePublishContentConfirm>[0]["deps"]["preparePublishConfirmation"]>(
    async ({ plan }) => ({ ...plan, details: { ...report, refused: true, refusalReason: "Live refuses this plan", rows: [] } }),
  );
  const { port, useConfirm } = ceremony([peer], prepare);
  const { result } = renderHook(() => useConfirm({ onCancel: () => {}, t: identity, confirmArmDelayMs: 0 }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  act(() => result.current.onToggleRow({ key: "post:one" }));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.refusalReason).toBe("Live refuses this plan"));
  expect(result.current.phase.kind).toBe("planned");
  expect(result.current.primaryDisabled).toBe(true);
  expect(port.confirmPublish).not.toHaveBeenCalled();
  expect(port.executePublish).not.toHaveBeenCalled();
});

test("a rejected confirmation does not execute and a rejected execution does not look completed", async () => {
  const { port, useConfirm } = ceremony();
  port.confirmPublish.mockRejectedValueOnce(new Error("Confirmation expired"));
  const running = deferred<Awaited<ReturnType<PublishContentPort["executePublish"]>>>();
  port.executePublish.mockReturnValueOnce(running.promise);
  const onCancel = vi.fn();
  const { result } = renderHook(() => useConfirm({ onCancel, t: identity, confirmArmDelayMs: 0 }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.errorMessage).toBe("Confirmation expired"));
  expect(port.executePublish).not.toHaveBeenCalled();
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("executing"));
  expect(result.current.dismissible).toBe(false);
  act(() => result.current.onDismiss());
  expect(onCancel).not.toHaveBeenCalled();
  await act(async () => running.reject(new Error("Live apply failed")));
  expect(port.executePublish).toHaveBeenCalledExactlyOnceWith({ peerId: "live", bundleId: "bundle", confirmationToken: "confirmed" });
  expect(result.current.phase.kind).toBe("failed");
  expect(result.current.errorMessage).toBe("Live apply failed");
  expect(result.current.doneMessage).toBeNull();
  act(() => result.current.onDismiss());
  expect(onCancel).toHaveBeenCalledExactlyOnceWith();
});

test.each([
  ["legacy", undefined, "Published 2 changes."],
  ["one applied and one skipped", [true, false], "Published 1 change. 1 item skipped. Menu links updated: 3."],
  ["everything skipped", [false, false], "Nothing published. 2 items skipped. Menu links updated: 3."],
] as const)("completion uses actual outcomes rather than change-set counts for %s", async (scenario, writes, message) => {
  const { port, useConfirm } = ceremony();
  port.executePublish.mockResolvedValueOnce({
    runId: "run", restorePointId: "restore", changeSetIds: ["change-1", "change-2"],
    ...(writes === undefined ? {} : {
      report: { ...report, rows: writes.map((written, i) => ({ ...report.rows[i]!, writes: written,
        outcome: written ? "applied" : "blocked", reason: written ? null : "Live changed" })) },
      menuLinksUpdated: 3,
      menuLinksNotUpdated: ["Menu grants missing", "Menu grants missing"],
      verificationProblems: ["No poster", "No poster"],
    }),
  });
  const { result } = renderHook(() => useConfirm({ onCancel: () => {}, t: identity, confirmArmDelayMs: 0 }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  expect(result.current.doneMessage).toBeNull();
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.doneMessage).toBe(message));
  expect(result.current.doneNotices).toEqual(scenario === "legacy" ? [] : ["Menu grants missing"]);
  expect(result.current.doneProblems).toEqual(scenario === "legacy" ? [] : ["No poster"]);
});

test("replacing the discovery port ignores an earlier target-list rejection", async () => {
  const original = ceremony();
  const replacing = ceremony([{ ...peer, id: "staging", label: "Staging" }]);
  const read = deferred<Awaited<ReturnType<PublishContentPort["listPeers"]>>>();
  original.port.listPeers.mockReturnValueOnce(read.promise);
  const { result, rerender } = renderHook(({ port }: { port: PublishContentPort }) =>
    original.useConfirm({ onCancel: () => {}, t: identity, port }), { initialProps: { port: original.port } });
  expect(original.port.listPeers).toHaveBeenCalledExactlyOnceWith();
  rerender({ port: replacing.port });
  await waitFor(() => expect(result.current.selectedPeerId).toBe("staging"));
  await act(async () => read.reject(new Error("Outdated request")));
  expect(result.current.errorMessage).toBeNull();
  expect(result.current.peers.map(site => site.label)).toEqual(["Staging"]);
  expect(original.port.getDestination).not.toHaveBeenCalled();
  expect(replacing.port.getDestination).not.toHaveBeenCalled();
});

test("unticking the last overwrite suppresses a late error for the now-superseded tick", async () => {
  const { port, plan, useConfirm } = ceremony();
  const blocked = { ...report.rows[0]!, outcome: "blocked" as const, writes: false, canOverwrite: true };
  port.planPublish.mockResolvedValueOnce({ ...plan, details: { ...report, rows: [blocked] } });
  const pending = deferred<PublishContentPlanResult>();
  port.planPublish.mockReturnValueOnce(pending.promise);
  const { result } = renderHook(() => useConfirm({ onCancel: () => {}, t: identity }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  act(() => result.current.onToggleOverwrite("post:one"));
  expect(port.planPublish).toHaveBeenLastCalledWith({ peerId: "live", overwriteEntityKeys: ["post:one"] });
  act(() => result.current.onToggleOverwrite("post:one"));
  expect(result.current.overwriteKeys.size).toBe(0);
  expect(port.planPublish).toHaveBeenCalledTimes(2);
  await act(async () => pending.reject(new Error("Superseded request failed")));
  expect(result.current.phase.kind).toBe("planned");
  expect(result.current.rows.map(row => [row.key, row.disposition])).toEqual([["post:one", "skipped"]]);
  expect(result.current.errorMessage).toBeNull();
});

test("confirmed execution uses the replan bundle and overwrite echo, not the original unreviewed bundle", async () => {
  const { port, plan, useConfirm } = ceremony();
  const blocked = { ...report.rows[0]!, outcome: "blocked" as const, writes: false, canOverwrite: true };
  const unchanged = { ...report.rows[1]!, outcome: "unchanged" as const, writes: false };
  const base = { ...plan, details: { ...report, rows: [blocked, unchanged] } };
  const reviewed = { ...base, bundleId: "reviewed-bundle", planId: "overwrite-plan", planHash: "overwrite-hash",
    overwriteEntityKeys: ["post:one"], details: { ...base.details, rows: [{ ...blocked, outcome: "forced" as const, writes: true }, unchanged] } };
  port.planPublish.mockResolvedValueOnce(base).mockResolvedValueOnce(reviewed);
  const { result } = renderHook(() => useConfirm({ onCancel: () => {}, t: identity, confirmArmDelayMs: 0 }));
  await waitFor(() => expect(result.current.selectedPeerId).toBe("live"));
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("planned"));
  expect(result.current.upToDateExpanded).toBe(false);
  expect(result.current.upToDateRows.map(row => row.key)).toEqual(["post:two"]);
  act(() => result.current.onToggleUpToDate());
  expect(result.current.upToDateExpanded).toBe(true);
  act(() => result.current.onToggleOverwrite("post:one"));
  await waitFor(() => expect(result.current.rows.find(row => row.key === "post:one")?.outcome).toBe("forced"));
  expect(result.current.overwriteWarning).toBe("Ticked items will replace what's on the live site, and stay recoverable in its Trash or history.");
  expect(port.executePublish).not.toHaveBeenCalled();
  act(() => result.current.onPrimary());
  await waitFor(() => expect(result.current.phase.kind).toBe("done"));
  expect(port.confirmPublish).toHaveBeenCalledExactlyOnceWith({ peerId: "live", planId: "overwrite-plan", planHash: "overwrite-hash" });
  expect(port.executePublish).toHaveBeenCalledExactlyOnceWith({
    peerId: "live", bundleId: "reviewed-bundle", confirmationToken: "confirmed", overwriteEntityKeys: ["post:one"],
  });
});

test("a report with no selectable rows shows why nothing writes and disables bulk selection", () => {
  const rows = toPublishReportRows({ report: { ...report, rows: [
    { entityType: "post", entityId: "owned", entityLabel: "Edited on live", outcome: "conflict", writes: false, reason: "Live copy changed" },
  ] }, policy: TEST_POLICY }, { completed: true });
  const onToggleAll = vi.fn();
  const readOnly = { ...view, connectOffer: null, rows, listedRows: rows, onToggleAll, primaryKind: "confirm" as const,
    primaryLabel: "Nothing to publish", primaryDisabled: true };
  render(<PublishContentDialog onCancel={() => {}} t={identity} kit={kit} deps={deps} hooks={{ usePublishContentConfirmHook: () => readOnly }} />);
  const row = screen.getByRole("row", { name: /Edited on live/ });
  expect(within(row).getByText("Live copy changed").textContent).toBe("Live copy changed");
  expect(within(row).queryByRole("checkbox")).toBeNull();
  const all = screen.getByRole<HTMLInputElement>("checkbox", { name: "Publish every item that can be published" });
  expect(all.disabled).toBe(true);
  expect(all.indeterminate).toBe(false);
  fireEvent.click(all);
  expect(onToggleAll).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Nothing to publish" }).disabled).toBe(true);
});
