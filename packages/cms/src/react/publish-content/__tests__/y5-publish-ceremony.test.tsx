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
