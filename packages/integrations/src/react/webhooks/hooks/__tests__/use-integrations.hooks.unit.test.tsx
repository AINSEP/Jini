// @vitest-environment jsdom
import { useCallback, useEffect, useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminWebhookSubscriptionResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import type { FetchQueryAdapter, MutationResult, QueryKey, QueryResult } from "@jini-ai/core/fetch";
import { useIntegrations, type IntegrationsPort } from "../use-integrations.hooks.js";

afterEach(cleanup);

const row = (over: Partial<AdminWebhookSubscriptionResponse> = {}): AdminWebhookSubscriptionResponse => ({
  id: "sub-1", label: "Hook", targetUrl: "https://example.com/h", topics: ["post.*"], status: "active", secretVersion: 1, previousSecretVersion: null,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", disabledAt: null, lastDelivery: null, ...over });

/** Minimal in-memory query adapter: real async state transitions, records invalidations. */
function makeQueryHooks(invalidated: QueryKey[]): Pick<FetchQueryAdapter, "useFetchQuery" | "useFetchMutation" | "useInvalidate"> {
  const invalidate = ({ key }: { key: QueryKey }) => { invalidated.push(key); };
  const hooks = {
    useFetchQuery: <T,>({ fetch }: { fetch: () => Promise<T> }): QueryResult<T> => {
      const [state, setState] = useState<{ data: T | undefined; error: Error | null }>({ data: undefined, error: null });
      useEffect(() => { fetch().then(data => setState({ data, error: null }), (error: Error) => setState({ data: undefined, error })); }, []);
      return { data: state.data, error: state.error, status: state.error ? "error" : "success", isFetching: false, refetch: () => undefined } as QueryResult<T>;
    },
    useFetchMutation: <I, O>({ run }: { run: (r: { input: I }) => Promise<O> }, opts?: { invalidates?: QueryKey[] }): MutationResult<I, O> => {
      const [state, setState] = useState<{ status: string; error: Error | null }>({ status: "idle", error: null });
      const mutate = useCallback(async ({ input }: { input: I }) => {
        setState({ status: "pending", error: null });
        try { const out = await run({ input }); opts?.invalidates?.forEach(k => invalidated.push(k)); setState({ status: "success", error: null }); return out; }
        catch (error) { setState({ status: "error", error: error as Error }); throw error; }
      }, [run]);
      return { mutate, status: state.status, error: state.error, reset: () => setState({ status: "idle", error: null }) } as MutationResult<I, O>;
    },
    useInvalidate: () => invalidate,
  };
  return hooks as unknown as Pick<FetchQueryAdapter, "useFetchQuery" | "useFetchMutation" | "useInvalidate">;
}

function setup(port: Partial<IntegrationsPort> = {}) {
  const invalidated: QueryKey[] = [];
  let refresh: (() => void) | undefined;
  const fullPort: IntegrationsPort = {
    listIntegrationSubscriptions: vi.fn(async () => ({ subscriptions: [row()] })),
    createIntegrationSubscription: vi.fn(async () => ({ subscription: row() })),
    pauseIntegrationSubscription: vi.fn(async () => ({ subscription: row() })),
    deleteIntegrationSubscription: vi.fn(async () => ({ subscription: row() })),
    ...port,
  };
  const describeApiError = vi.fn(({ e, fallback }: { e: unknown; fallback: string }) => `${fallback}: ${(e as Error).message}`);
  const hook = renderHook(() => useIntegrations({ port: fullPort, t: ({ key }) => key, locale: "fr", queryHooks: makeQueryHooks(invalidated),
    useContentRefreshSubscriptionHook: ({ resource, onRefresh }) => { expect(resource).toBe("webhooks"); refresh = onRefresh; },
    describeApiError, translate: ({ locale, key }) => `${locale}:${key}` }));
  return { hook, port: fullPort, invalidated, refresh: () => refresh?.(), describeApiError };
}
const submit = { preventDefault: vi.fn() } as unknown as React.FormEvent;

describe("useIntegrations", () => {
  it("loads subscriptions and invalidates the list on a content refresh", async () => {
    const s = setup();
    expect(s.hook.result.current.subscriptions).toBeNull();
    await waitFor(() => expect(s.hook.result.current.subscriptions).toEqual([row()]));
    expect(s.hook.result.current.locale).toBe("fr");
    s.refresh();
    expect(s.invalidated).toEqual([["integrations", "list"]]);
  });

  it("creates with parsed topics, then clears and closes the form", async () => {
    const s = setup();
    act(() => { s.hook.result.current.setFormOpen(true); s.hook.result.current.setLabel("L"); s.hook.result.current.setTargetUrl("https://t.test"); s.hook.result.current.setTopics(" a, ,b "); });
    await act(() => s.hook.result.current.onCreate(submit));
    expect(submit.preventDefault).toHaveBeenCalled();
    expect(s.port.createIntegrationSubscription).toHaveBeenCalledWith({ label: "L", targetUrl: "https://t.test", topics: ["a", "b"] });
    const c = s.hook.result.current;
    expect([c.label, c.targetUrl, c.topics, c.formOpen, c.formError]).toEqual(["", "", "", false, null]);
  });

  it("a failed create keeps the draft and shows the described form error", async () => {
    const s = setup({ createIntegrationSubscription: vi.fn(async () => { throw new Error("bad url"); }) });
    act(() => { s.hook.result.current.setFormOpen(true); s.hook.result.current.setLabel("L"); });
    await act(() => s.hook.result.current.onCreate(submit));
    expect(s.hook.result.current.formError).toBe("failed to create subscription: bad url");
    expect([s.hook.result.current.label, s.hook.result.current.formOpen]).toEqual(["L", true]);
  });

  it("toggles pause by current status and surfaces a toggle error over the list", async () => {
    const s = setup({ pauseIntegrationSubscription: vi.fn().mockResolvedValueOnce({ subscription: row() }).mockRejectedValueOnce(new Error("nope")) });
    await waitFor(() => expect(s.hook.result.current.subscriptions).not.toBeNull());
    await act(() => s.hook.result.current.onTogglePause(row({ status: "paused" })));
    expect(s.port.pauseIntegrationSubscription).toHaveBeenLastCalledWith({ id: "sub-1", paused: false });
    await act(() => s.hook.result.current.onTogglePause(row()));
    expect(s.port.pauseIntegrationSubscription).toHaveBeenLastCalledWith({ id: "sub-1", paused: true });
    expect(s.hook.result.current.error).toBe("fr:failed to update subscription: nope");
  });

  it("deletes only the pending row, clears it even on failure, and resets the stale toggle error", async () => {
    const s = setup({ pauseIntegrationSubscription: vi.fn(async () => { throw new Error("t-err"); }), deleteIntegrationSubscription: vi.fn(async () => { throw new Error("d-err"); }) });
    await waitFor(() => expect(s.hook.result.current.subscriptions).not.toBeNull());
    await act(() => s.hook.result.current.onDelete());
    expect(s.port.deleteIntegrationSubscription).not.toHaveBeenCalled();
    await act(() => s.hook.result.current.onTogglePause(row()));
    act(() => s.hook.result.current.setPendingDelete(row({ id: "sub-9" })));
    await act(() => s.hook.result.current.onDelete());
    expect(s.port.deleteIntegrationSubscription).toHaveBeenCalledWith({ id: "sub-9" });
    expect(s.hook.result.current.pendingDelete).toBeNull();
    expect(s.hook.result.current.error).toBe("fr:failed to delete subscription: d-err");
  });

  it("shows a list error only while no subscriptions are loaded", async () => {
    const s = setup({ listIntegrationSubscriptions: vi.fn(async () => { throw new Error("down"); }) });
    await waitFor(() => expect(s.hook.result.current.error).toBe("fr:failed to load integrations: down"));
    expect([s.hook.result.current.saving, s.hook.result.current.deleting]).toEqual([false, false]);
  });

  it("a successful delete clears the pending row without an error", async () => {
    const s = setup();
    await waitFor(() => expect(s.hook.result.current.subscriptions).not.toBeNull());
    act(() => s.hook.result.current.setPendingDelete(row()));
    await act(() => s.hook.result.current.onDelete());
    expect(s.port.deleteIntegrationSubscription).toHaveBeenCalledWith({ id: "sub-1" });
    expect([s.hook.result.current.pendingDelete, s.hook.result.current.error]).toEqual([null, null]);
    expect(s.invalidated).toEqual([["integrations", "list"]]);
  });
});
