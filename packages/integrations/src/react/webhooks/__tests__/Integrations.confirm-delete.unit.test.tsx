// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminWebhookSubscriptionResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import { Integrations, type IntegrationsProps } from "../Integrations.js";

afterEach(cleanup);

it("opens confirmation before deleting and confirms only the selected row", async () => {
  const row: AdminWebhookSubscriptionResponse = {
    id: "sub-A", label: "First webhook", targetUrl: "https://example.com/hooks", topics: ["post.*"],
    status: "active", secretVersion: 1, previousSecretVersion: null, createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z", disabledAt: null, lastDelivery: null,
  };
  const deleted = vi.fn();
  const useIntegrationsHook: IntegrationsProps["useIntegrationsHook"] = () => {
    const [pendingDelete, setPendingDelete] = useState<AdminWebhookSubscriptionResponse | null>(null);
    return {
      subscriptions: [row], error: null, formOpen: false, setFormOpen: vi.fn(), label: "", setLabel: vi.fn(),
      targetUrl: "", setTargetUrl: vi.fn(), topics: "", setTopics: vi.fn(), saving: false, formError: null,
      pendingDelete, setPendingDelete, deleting: false, onCreate: vi.fn(async () => {}),
      onTogglePause: vi.fn(async () => {}), onDelete: async () => { deleted(pendingDelete?.id); },
      t: ({ key }) => key, locale: "en",
    };
  };
  const kit: IntegrationsProps["kit"] = {
    DataTable: ({ rows, columns }) => <>{rows.map((row, index) => <div key={row.id}>{columns.map(column => <span key={column.key}>{column.cell(row, index)}</span>)}</div>)}</>,
    RowMenu: ({ items, triggerLabel }) => {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>{triggerLabel}</button>{open ? items.map(item => <button key={item.key} onClick={item.onSelect}>{item.label}</button>) : null}</>;
    },
    ConfirmDialog: ({ open, title, body, onConfirm, onCancel }) => open ? <div role="dialog"><h2>{title}</h2>{body}<button onClick={onConfirm}>Confirm delete</button><button onClick={onCancel}>Cancel</button></div> : null,
  };
  render(<Integrations useIntegrationsHook={useIntegrationsHook} kit={kit} ServerLabel={({ value }) => <>{value}</>}
    translate={({ key }) => key} actionsForWebhookLabel={({ label }) => `Actions for ${label}`}
    deleteWebhookBody={({ label }) => `Delete ${label}?`} />);
  fireEvent.click(screen.getByText("Actions for First webhook"));
  fireEvent.click(screen.getByText("Delete"));
  expect(screen.getByRole("dialog").textContent).toContain("Delete First webhook?");
  expect(deleted).toHaveBeenCalledTimes(0);
  fireEvent.click(screen.getByText("Confirm delete"));
  await waitFor(() => expect(deleted).toHaveBeenCalledExactlyOnceWith("sub-A"));
});
