// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FetchQueryAdapter, QueryKey } from "@jini-ai/core/fetch";
import type { AdminWebhookDeliveryResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import { useIntegrationDeliveries } from "../use-integration-deliveries.hooks.js";

afterEach(cleanup);

it("uses distinct subscription keys and displays B's delivery after A", async () => {
  const responses: Record<string, AdminWebhookDeliveryResponse[]> = {
    A: [{ id: "delivery-A", subscriptionId: "A", eventId: "event-A", topic: "post.*", status: "delivered", attempts: 1,
      nextAttemptAt: "2026-01-01T00:00:00Z", lastResponseStatus: 200, lastError: null, signedWithVersion: 1,
      createdAt: "2026-01-01T00:00:00Z", deliveredAt: "2026-01-01T00:00:00Z", deadAt: null }],
    B: [{ id: "delivery-B", subscriptionId: "B", eventId: "event-B", topic: "post.*", status: "pending", attempts: 0,
      nextAttemptAt: "2026-01-02T00:00:00Z", lastResponseStatus: null, lastError: null, signedWithVersion: null,
      createdAt: "2026-01-02T00:00:00Z", deliveredAt: null, deadAt: null }],
  };
  const keys: QueryKey[] = [];
  const useFetchQuery: FetchQueryAdapter["useFetchQuery"] = <T,>({ key, fetch }: { key: QueryKey; fetch: () => Promise<T> }) => {
    const [data, setData] = useState<T>();
    const cacheKey = JSON.stringify(key);
    useEffect(() => { keys.push(key); void fetch().then(setData); }, [cacheKey]);
    return { data, error: null, status: "success", isFetching: false, refetch: () => {} };
  };
  const port = { listIntegrationDeliveries: vi.fn(async ({ subscriptionId }: { subscriptionId: string }) => ({ deliveries: responses[subscriptionId] ?? [] })) };
  const { result, rerender } = renderHook(({ subscriptionId }) => useIntegrationDeliveries({
    subscriptionId, port, t: ({ key }) => key, queryHooks: { useFetchQuery }, describeApiError: ({ fallback }) => fallback,
  }), { initialProps: { subscriptionId: "A" } });
  await waitFor(() => expect(result.current.deliveries).toEqual(responses.A));
  rerender({ subscriptionId: "B" });
  await waitFor(() => expect(result.current.deliveries).toEqual(responses.B));
  expect(keys).toEqual([["integration-deliveries", "A"], ["integration-deliveries", "B"]]);
  expect(port.listIntegrationDeliveries.mock.calls).toEqual([[{ subscriptionId: "A" }], [{ subscriptionId: "B" }]]);
});
