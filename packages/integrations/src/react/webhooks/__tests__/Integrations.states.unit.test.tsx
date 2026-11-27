// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminWebhookSubscriptionResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import { Integrations, type IntegrationsProps } from "../Integrations.js";
import type { IntegrationsController } from "../hooks/use-integrations.hooks.js";

afterEach(cleanup);

function subscription(required: Pick<AdminWebhookSubscriptionResponse, "id" | "label" | "status">, _optional: Partial<AdminWebhookSubscriptionResponse> = {}): AdminWebhookSubscriptionResponse {
  return {
    targetUrl: `https://example.com/${required.id}`, topics: ["post.*"], secretVersion: 1, previousSecretVersion: null,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", disabledAt: null, lastDelivery: null,
    ...required, ..._optional,
  };
}

function controller(_optional: Partial<IntegrationsController> = {}): IntegrationsController {
  return {
    subscriptions: [], error: null, formOpen: false, setFormOpen: vi.fn(), label: "", setLabel: vi.fn(),
    targetUrl: "", setTargetUrl: vi.fn(), topics: "", setTopics: vi.fn(), saving: false, formError: null,
    pendingDelete: null, setPendingDelete: vi.fn(), deleting: false, onCreate: vi.fn(async () => {}),
    onTogglePause: vi.fn(async () => {}), onDelete: vi.fn(async () => {}), t: ({ key }) => `t:${key}`, locale: "fr",
    ..._optional,
  };
}

const kit: IntegrationsProps["kit"] = {
  DataTable: ({ rows, columns, empty, rowKey }) => rows.length === 0 ? <>{empty}</> : (
    <table><tbody>{rows.map((row, index) => <tr key={rowKey(row, index)} data-testid={`row-${rowKey(row, index)}`}>{columns.map(column => <td key={column.key} data-col={column.key}>{column.cell(row, index)}</td>)}</tr>)}</tbody></table>
  ),
  RowMenu: ({ items, triggerLabel }) => <div aria-label={triggerLabel}>{items.map(item => <button key={item.key} onClick={item.onSelect}>{item.label}</button>)}</div>,
  ConfirmDialog: ({ open, onCancel, pending }) => open ? <div role="dialog" data-pending={String(pending)}><button onClick={onCancel}>Dialog cancel</button></div> : null,
};

function renderWith(c: IntegrationsController) {
  return render(<Integrations useIntegrationsHook={() => c} kit={kit} ServerLabel={({ value }) => <>server:{value}</>}
    translate={({ locale, key }) => `${locale}:${key}`} actionsForWebhookLabel={({ label }) => `Actions for ${label}`}
    deleteWebhookBody={({ label }) => `Delete ${label}?`} />);
}

describe("Integrations screen states", () => {
  it("shows only the error notice when the hook reports an error", () => {
    const { container } = renderWith(controller({ error: "load failed", subscriptions: null }));
    expect(container.textContent).toBe("load failed");
    expect(container.querySelector(".notice.error")).not.toBeNull();
  });

  it("shows the translated loading notice before subscriptions arrive", () => {
    const { container } = renderWith(controller({ subscriptions: null }));
    expect(container.textContent).toBe("t:Loading integrations…");
  });

  it("renders the empty state and opens the create form from the intro button", () => {
    const c = controller();
    renderWith(c);
    expect(screen.getByText("t:No webhooks yet.").className).toBe("empty-state-title");
    fireEvent.click(screen.getByRole("button", { name: "t:Add webhook" }));
    expect(c.setFormOpen).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.queryByRole("button", { name: "fr:Create" })).toBeNull();
  });

  it("an open form hides the intro button and wires every field, submit and cancel", () => {
    const c = controller({ formOpen: true, formError: "bad target", label: "L", targetUrl: "https://x.test", topics: "post.*" });
    renderWith(c);
    expect(screen.queryByRole("button", { name: "t:Add webhook" })).toBeNull();
    expect(screen.getByText("bad target").className).toBe("save-error");
    fireEvent.change(screen.getByLabelText("fr:Label"), { target: { value: "Ops hook" } });
    fireEvent.change(screen.getByLabelText("fr:Target URL"), { target: { value: "https://ops.test/h" } });
    fireEvent.change(screen.getByLabelText("fr:Topics (comma-separated, e.g. post.published, post.*)"), { target: { value: "page.*" } });
    expect(c.setLabel).toHaveBeenCalledExactlyOnceWith("Ops hook");
    expect(c.setTargetUrl).toHaveBeenCalledExactlyOnceWith("https://ops.test/h");
    expect(c.setTopics).toHaveBeenCalledExactlyOnceWith("page.*");
    const submit = screen.getByRole("button", { name: "fr:Create" });
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.submit(submit.closest("form")!);
    expect(c.onCreate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "fr:Cancel" }));
    expect(c.setFormOpen).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("a saving form disables submit and shows the saving label without an error line", () => {
    const { container } = renderWith(controller({ formOpen: true, saving: true }));
    expect(screen.getByRole("button", { name: "fr:Saving…" }).hasAttribute("disabled")).toBe(true);
    expect(container.querySelector(".save-error")).toBeNull();
  });

  it("renders each row's link, status, last delivery and the menu only for non-disabled rows", () => {
    const paused = subscription({ id: "sub-p", label: "Paused hook", status: "paused" },
      { lastDelivery: { id: "dl-1", status: "failed", attempts: 3, lastResponseStatus: 500, lastError: "upstream", createdAt: "2026-01-02T00:00:00Z", deliveredAt: null } });
    const disabled = subscription({ id: "sub-d", label: "Dead hook", status: "disabled" });
    const c = controller({ subscriptions: [paused, disabled] });
    renderWith(c);
    const link = screen.getByRole("link", { name: "Paused hook" });
    expect(link.getAttribute("href")).toBe("/admin/addons/integrations/sub-p");
    const pausedRow = screen.getByTestId("row-sub-p");
    expect(pausedRow.querySelector('[data-col="target-url"]')?.textContent).toBe("https://example.com/sub-p");
    expect(pausedRow.querySelector('[data-col="status"]')?.textContent).toBe("server:paused");
    expect(pausedRow.querySelector('[data-col="last-delivery"] .status-delivery-failed')?.textContent).toBe("server:failed");
    const disabledRow = screen.getByTestId("row-sub-d");
    expect(disabledRow.querySelector('[data-col="last-delivery"]')?.textContent).toBe("t:never");
    expect(disabledRow.querySelector('[data-col="actions"]')?.textContent).toBe("—");
    expect(screen.queryByLabelText("Actions for Dead hook")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "fr:Resume" }));
    expect(c.onTogglePause).toHaveBeenCalledExactlyOnceWith(paused);
    fireEvent.click(screen.getByRole("button", { name: "fr:Delete" }));
    expect(c.setPendingDelete).toHaveBeenCalledExactlyOnceWith(paused);
  });

  it("the delete dialog's cancel clears the pending row and passes the deleting flag", () => {
    const row = subscription({ id: "sub-a", label: "A", status: "active" });
    const c = controller({ subscriptions: [row], pendingDelete: row, deleting: true });
    renderWith(c);
    expect(screen.getByRole("dialog").getAttribute("data-pending")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Dialog cancel" }));
    expect(c.setPendingDelete).toHaveBeenCalledExactlyOnceWith(null);
  });
});
