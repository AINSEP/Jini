// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminWebhookDeliveryResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import { formatTimestamp } from "@jini-ai/core/text";
import { IntegrationDeliveries, type IntegrationDeliveriesProps } from "../IntegrationDeliveries.js";
import { useIntegrationDeliveries, type IntegrationDeliveriesController } from "../hooks/use-integration-deliveries.hooks.js";

afterEach(cleanup);

function delivery(required: Pick<AdminWebhookDeliveryResponse, "id" | "status">, _optional: Partial<AdminWebhookDeliveryResponse> = {}): AdminWebhookDeliveryResponse {
  return {
    subscriptionId: "sub-A", eventId: `event-${required.id}`, topic: "post.*", attempts: 1, nextAttemptAt: "2026-01-01T00:00:00Z",
    lastResponseStatus: null, lastError: null, signedWithVersion: 1, createdAt: "2026-01-01T00:00:00Z", deliveredAt: null, deadAt: null,
    ...required, ..._optional,
  };
}

const kit: IntegrationDeliveriesProps["kit"] = {
  DataTable: ({ rows, columns, empty, rowKey }) => rows.length === 0 ? <>{empty}</> : (
    <table><tbody>{rows.map((row, index) => <tr key={rowKey(row, index)} data-testid={`row-${rowKey(row, index)}`}>{columns.map(column => <td key={column.key} data-col={column.key}>{column.cell(row, index)}</td>)}</tr>)}</tbody></table>
  ),
};

function renderWith(c: IntegrationDeliveriesController) {
  const seen: string[] = [];
  const utils = render(<IntegrationDeliveries subscriptionId="sub-A" kit={kit} viewerTimeZone="UTC" ServerLabel={({ value }) => <>server:{value}</>}
    useIntegrationDeliveriesHook={({ subscriptionId }) => { seen.push(subscriptionId); return c; }} />);
  return { ...utils, seen };
}

const t: IntegrationDeliveriesController["t"] = ({ key }) => `t:${key}`;

describe("IntegrationDeliveries", () => {
  it("shows only the error notice when loading failed", () => {
    const { container, seen } = renderWith({ deliveries: null, error: "boom", t });
    expect(container.textContent).toBe("boom");
    expect(seen).toEqual(["sub-A"]);
  });

  it("shows the loading notice until deliveries arrive", () => {
    const { container } = renderWith({ deliveries: null, error: null, t });
    expect(container.textContent).toBe("t:Loading delivery log…");
  });

  it("shows the empty state for a subscription with no deliveries", () => {
    renderWith({ deliveries: [], error: null, t });
    expect(screen.getByText("t:No deliveries yet for this subscription.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "t:← Integrations" }).getAttribute("href")).toBe("/admin/addons/integrations?tab=webhooks");
    expect(screen.getByRole("heading", { name: "t:Delivery log" })).not.toBeNull();
  });

  it("renders status, attempts, last response with its error, and the best timestamp", () => {
    const delivered = delivery({ id: "d1", status: "delivered" }, { attempts: 2, lastResponseStatus: 200, deliveredAt: "2026-03-04T05:06:00Z" });
    const failed = delivery({ id: "d2", status: "failed" }, { attempts: 3, lastError: "connection refused" });
    renderWith({ deliveries: [delivered, failed], error: null, t });
    const first = screen.getByTestId("row-d1");
    expect(first.querySelector('[data-col="status"] .status-delivery-delivered')?.textContent).toBe("server:delivered");
    expect(first.querySelector('[data-col="attempts"]')?.textContent).toBe("2");
    expect(first.querySelector('[data-col="last-response"]')?.textContent).toBe("200");
    expect(first.querySelector('[data-col="timestamp"]')?.textContent).toBe(formatTimestamp({ iso: "2026-03-04T05:06:00Z" }, { viewerTimeZone: "UTC" }));
    const second = screen.getByTestId("row-d2");
    expect(second.querySelector('[data-col="last-response"]')?.textContent).toBe("—connection refused");
    expect(second.querySelector('[data-col="last-response"] .save-error')?.textContent).toBe("connection refused");
    expect(second.querySelector('[data-col="timestamp"]')?.textContent).toBe(formatTimestamp({ iso: "2026-01-01T00:00:00Z" }, { viewerTimeZone: "UTC" }));
  });
});

describe("useIntegrationDeliveries error path", () => {
  it("describes a failed load with the hook's fallback and keeps deliveries null", () => {
    const failure = new Error("network down");
    const useFetchQuery: FetchQueryAdapter["useFetchQuery"] = <T,>() => {
      const [data] = useState<T>();
      return { data, error: failure, status: "error", isFetching: false, refetch: () => {} };
    };
    const describeApiError = vi.fn(({ e, fallback }: { e: unknown; fallback: string }) => `${(e as Error).message} / ${fallback}`);
    const port = { listIntegrationDeliveries: vi.fn(async () => ({ deliveries: [] })) };
    const { result } = renderHook(() => useIntegrationDeliveries({ subscriptionId: "A", port, t, queryHooks: { useFetchQuery }, describeApiError }));
    expect(result.current.deliveries).toBeNull();
    expect(result.current.error).toBe("network down / failed to load deliveries");
    expect(describeApiError).toHaveBeenCalledWith({ e: failure, fallback: "failed to load deliveries" });
  });
});
