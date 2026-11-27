// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { deferred } from "../../../widgets/__tests__/fixtures/controller-harness.js";
import type { AdminMailStatus } from "../api/mail-status-api.types.js";
import { emailSummary, useEmail, type EmailSummary } from "../hooks/use-email.hooks.js";

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const cases: { scenario: string; status: AdminMailStatus; verdict: EmailSummary }[] = [
  { scenario: "unconfigured with a fallback lane", status: { mailDeliveryAvailable: false, state: "unconfigured", lanes: [{ lane: "transactional", providerId: "console", state: "local_only" }] }, verdict: "not_set_up" },
  { scenario: "bulk is local despite working transactional delivery", status: { mailDeliveryAvailable: true, state: "ready", lanes: [{ lane: "transactional", providerId: "hosted", state: "ready" }, { lane: "bulk", providerId: "console", state: "local_only" }] }, verdict: "no_external_delivery" },
  { scenario: "legacy delivery is available", status: { mailDeliveryAvailable: true }, verdict: "configured" },
  { scenario: "legacy delivery is unavailable", status: { mailDeliveryAvailable: false }, verdict: "no_external_delivery" },
  { scenario: "degraded without warnings", status: { mailDeliveryAvailable: true, state: "degraded", warnings: [] }, verdict: "needs_attention" },
  { scenario: "ready but sender is unverified", status: { mailDeliveryAvailable: true, state: "ready", warnings: ["sender_unverified"] }, verdict: "needs_attention" },
  { scenario: "ready with a hosted lane and an empty warning list", status: { mailDeliveryAvailable: true, state: "ready", lanes: [{ lane: "transactional", providerId: "hosted", state: "ready" }], warnings: [] }, verdict: "configured" },
  { scenario: "ready and warnings omitted", status: { mailDeliveryAvailable: true, state: "ready" }, verdict: "configured" },
];

afterEach(cleanup);

it.each(cases)("classifies mail status when $scenario", ({ status, verdict }) => {
  expect(emailSummary({ status })).toBe(verdict);
});

it.each([
  { failure: new ApiError("Permission denied", 403), kind: "forbidden" },
  { failure: new ApiError("Temporarily unavailable", 503), kind: "error" },
  { failure: Object.assign(new Error("Untrusted 403"), { status: 403 }), kind: "error" },
])("reports $failure as $kind and can retry the read", async ({ failure, kind }) => {
  const first = deferred<AdminMailStatus>();
  const retry = deferred<AdminMailStatus>();
  const port = { getMailStatus: vi.fn(() => retry.promise).mockImplementationOnce(() => first.promise) };
  const { result } = renderHook(() => useEmail({ port, ApiError, locale: "es-MX" }));
  expect(result.current.locale).toBe("es-MX");
  expect(result.current.view).toEqual({ kind: "loading" });
  await act(async () => { first.reject(failure); });
  expect(result.current.view).toEqual({ kind });

  act(() => result.current.retry());
  expect(result.current.view).toEqual({ kind: "loading" });
  const status: AdminMailStatus = { mailDeliveryAvailable: true, state: "ready" };
  await act(async () => { retry.resolve(status); });
  expect(port.getMailStatus.mock.calls).toEqual([[], []]);
  expect(result.current.view).toEqual({ kind: "loaded", status });
});

it.each(["resolve", "reject"] as const)("ignores an old status read that completes with %s after switching ports", async (settle) => {
  const stale = deferred<AdminMailStatus>();
  const fresh = deferred<AdminMailStatus>();
  const oldPort = { getMailStatus: vi.fn(() => stale.promise) };
  const newPort = { getMailStatus: vi.fn(() => fresh.promise) };
  const { result, rerender } = renderHook(({ port }) => useEmail({ port, ApiError, locale: "en" }), { initialProps: { port: oldPort } });
  rerender({ port: newPort });
  const status: AdminMailStatus = { mailDeliveryAvailable: true, state: "ready" };
  await act(async () => { fresh.resolve(status); });
  expect(result.current.view).toEqual({ kind: "loaded", status });
  await act(async () => {
    if (settle === "resolve") stale.resolve({ mailDeliveryAvailable: false, state: "unconfigured" });
    else stale.reject(new ApiError("Old permission denial", 403));
  });
  expect(result.current.view).toEqual({ kind: "loaded", status });
});
