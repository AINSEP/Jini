// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "../../../__tests__/fetch-query-support.js";
import { createElement, useState } from "react";
import { describe, expect, it } from "vitest";
import { LocalSiteConfirmDialog } from "../LocalSiteConfirmDialog.js";
import { useSiteConfirm, type SiteConfirmPresentation } from "../use-site-confirm.hooks.js";

/**
 * @file The host's per-action confirmation, moved with its tests: the host injects each action's
 * title/confirm keys and tone; the hook titles the shared dialog from them and settles the caller's
 * promise. Literal fixtures (the host's own presentation table), no module mocks.
 */

const t = (key: string) => key;
type Action = "trash" | "delete" | "switch" | "stop-serving";
const presentation: Record<Action, SiteConfirmPresentation> = {
  trash: { titleKey: "Move site to Trash?", confirmKey: "Move to Trash", tone: "danger" },
  delete: { titleKey: "Delete site permanently?", confirmKey: "Delete permanently", tone: "danger" },
  switch: { titleKey: "Switch to this site now?", confirmKey: "Switch now", tone: "warning" },
  "stop-serving": { titleKey: "Stop this site?", confirmKey: "Stop", tone: "warning" },
};

describe("useSiteConfirm", () => {
  it("resolves true/false from the dialog and titles itself per action", async () => {
    const { result } = renderHook(() => useSiteConfirm({ t, presentation }));
    expect(result.current.dialog.open).toBe(false);
    let answer!: Promise<boolean>;
    act(() => { answer = result.current.confirm({ message: "Move this site to Trash? You can restore it later.", action: "trash" }); });
    expect(result.current.dialog).toMatchObject({ open: true, title: "Move site to Trash?", confirmLabel: "Move to Trash", tone: "danger" });
    expect(result.current.dialog.body).toEqual(createElement("p", null, "Move this site to Trash? You can restore it later."));
    act(() => result.current.dialog.onConfirm());
    await expect(answer).resolves.toBe(true);
    expect(result.current.dialog.open).toBe(false);
    act(() => { answer = result.current.confirm({ message: "Switch now? Unsaved changes will be lost.", action: "switch" }); });
    expect(result.current.dialog).toMatchObject({ title: "Switch to this site now?", confirmLabel: "Switch now", tone: "warning" });
    act(() => result.current.dialog.onCancel());
    await expect(answer).resolves.toBe(false);
  });

  it("a second request cancels the first instead of leaving it pending", async () => {
    const { result } = renderHook(() => useSiteConfirm({ t, presentation }));
    let first!: Promise<boolean>, second!: Promise<boolean>;
    act(() => { first = result.current.confirm({ message: "one", action: "trash" }); });
    act(() => { second = result.current.confirm({ message: "two", action: "delete" }); });
    await expect(first).resolves.toBe(false);
    expect(result.current.dialog).toMatchObject({ title: "Delete site permanently?", confirmLabel: "Delete permanently" });
    expect(result.current.dialog.body).toEqual(createElement("p", null, "two"));
    act(() => result.current.dialog.onConfirm());
    await expect(second).resolves.toBe(true);
  });

  it("the shared confirmation modal presents and settles a site switch", async () => {
    const { result, unmount } = renderHook(() => useSiteConfirm({ t, presentation }));
    let answer!: Promise<boolean>;
    act(() => { answer = result.current.confirm({ message: "Switch now? Unsaved changes will be lost.", action: "switch" }); });
    expect(result.current.dialog.open).toBe(true); expect(result.current.dialog.title).toBe("Switch to this site now?");
    expect(result.current.dialog.confirmLabel).toBe("Switch now"); expect(result.current.dialog.tone).toBe("warning");
    act(() => result.current.dialog.onConfirm()); expect(await answer).toBe(true); expect(result.current.dialog.open).toBe(false); unmount();
  });
});

describe("LocalSiteConfirmDialog", () => {
  function Harness() {
    const dialog = useSiteConfirm({ t, presentation });
    const [answer, setAnswer] = useState("none");
    return <>
      <button type="button" onClick={() => void dialog.confirm({ message: "Move this site to Trash? You can restore it later.", action: "trash" }).then((ok) => setAnswer(String(ok)))}>Ask</button>
      <p>answer:{answer}</p>
      <LocalSiteConfirmDialog dialog={dialog} />
    </>;
  }

  it("renders the shared ConfirmDialog for the open request and answers the awaiting caller", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByText("Move this site to Trash? You can restore it later.")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Move to Trash" })); });
    expect(screen.getByText("answer:true")).toBeInTheDocument();
  });

  it("renders nothing without a controller", () => {
    const { container } = render(<LocalSiteConfirmDialog />);
    expect(container.innerHTML).toBe("");
  });
});
