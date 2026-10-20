import { expect, test } from "vitest";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import { FetchTimeoutError } from "../../../fetch-with-timeout.js";
import { createHttpClient } from "../client.js";
import type { EgressPolicy, GuardedClock, HttpTransportAdapter } from "../ports.js";

const policy: EgressPolicy = {
  allowedSchemes: ["https"], denyPrivateAddresses: true, devHostAllowlist: [], maxRedirects: 3,
  connectTimeoutMs: 1000, maxResponseBytes: 100, maxDecompressedBytes: 100,
};
const ok: HttpResponse = { status: 200, headers: {}, bodyText: "ok" };

function fixture({ clock, transport }: { clock?: GuardedClock; transport?: HttpTransportAdapter }, _options: Record<string, never> = {}) {
  const sent: HttpRequest[] = [];
  const deadlines: number[] = [];
  const deadline = new AbortController();
  const resolved: string[] = [];
  const client = createHttpClient({
    policy, userAgent: "RequestPins/1.0",
    clock: clock ?? { nowMs: () => 0, timeoutSignal: ({ timeoutMs }) => { deadlines.push(timeoutMs); return deadline.signal; } },
    dns: { resolve: async ({ hostname }) => { resolved.push(hostname); return ["93.184.216.34"]; } },
    transport: transport ?? { requestPinned: async ({ request }) => { sent.push(request); return ok; } },
  });
  return { client, sent, deadlines, deadline, resolved };
}

function request(overrides: Partial<HttpRequest>, _options: Record<string, never> = {}): HttpRequest {
  return { method: "GET", url: "https://example.com/", headers: {}, timeoutMs: 500, ...overrides };
}

const invalidLimits = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
for (const field of ["timeoutMs", "idleTimeoutMs", "totalDeadlineMs", "maxResponseBytes"] as const) {
  test.each(invalidLimits)(`${field} rejects invalid limit %s before clock, DNS or transport`, async (value) => {
    const state = fixture({});
    await expect(state.client.send({ request: request({ [field]: value }) }))
      .rejects.toThrow(new TypeError(`${field} must be a positive safe integer`));
    expect(state.deadlines).toEqual([]);
    expect(state.resolved).toEqual([]);
    expect(state.sent).toEqual([]);
  });
}

test("a missing idle budget retains the legacy timeoutMs diagnostic", async () => {
  const state = fixture({});
  const input = request({});
  Reflect.deleteProperty(input, "timeoutMs");
  await expect(state.client.send({ request: input })).rejects.toThrow(new TypeError("timeoutMs must be a positive safe integer"));
  expect(state.resolved).toEqual([]);
});

test("a valid idle budget overrides an invalid legacy alias and is bounded on transport", async () => {
  const state = fixture({});
  await state.client.send({ request: request({ idleTimeoutMs: 2000, timeoutMs: 0 }) });
  expect(state.sent[0]).toMatchObject({ idleTimeoutMs: 1000, timeoutMs: 1000 });
});

test("limit errors are ordered idle budget, total deadline, then response bytes", async () => {
  const state = fixture({});
  await expect(state.client.send({ request: request({ idleTimeoutMs: 0, totalDeadlineMs: 0, maxResponseBytes: 0 }) }))
    .rejects.toThrow("idleTimeoutMs must be a positive safe integer");
  await expect(state.client.send({ request: request({ totalDeadlineMs: 0, maxResponseBytes: 0 }) }))
    .rejects.toThrow("totalDeadlineMs must be a positive safe integer");
  expect(state.deadlines).toEqual([]);
  expect(state.resolved).toEqual([]);
});

test("omitted optional limits leave the deadline off and preserve absence of signal", async () => {
  const state = fixture({});
  const result = await state.client.send({ request: request({}) });
  expect(state.deadlines).toEqual([]);
  expect(state.sent[0]).not.toHaveProperty("signal");
  expect(state.sent[0]).toMatchObject({ maxResponseBytes: 100, headers: { "User-Agent": "RequestPins/1.0" } });
  expect(result).toMatchObject({ status: 200, bodyText: "ok" });
});

test("a caller signal alone retains its identity", async () => {
  const state = fixture({});
  const caller = new AbortController();
  await state.client.send({ request: request({ signal: caller.signal }) });
  expect(state.sent[0]!.signal).toBe(caller.signal);
  expect(state.deadlines).toEqual([]);
});

test("a deadline alone retains its identity and uses the explicit whole-operation budget", async () => {
  const state = fixture({});
  await state.client.send({ request: request({ totalDeadlineMs: 2000, maxResponseBytes: 1 }) });
  expect(state.deadlines).toEqual([2000]);
  expect(state.sent[0]!.signal).toBe(state.deadline.signal);
  expect(state.sent[0]!.maxResponseBytes).toBe(1);
});

test.each(["caller", "deadline"] as const)("composed signal follows the %s", async (source) => {
  const state = fixture({});
  const caller = new AbortController();
  await state.client.send({ request: request({ signal: caller.signal, totalDeadlineMs: 2000 }) });
  const composed = state.sent[0]!.signal!;
  expect(composed).not.toBe(caller.signal);
  expect(composed).not.toBe(state.deadline.signal);
  expect(composed.aborted).toBe(false);
  const reason = new Error(source);
  const controllers = { caller, deadline: state.deadline };
  controllers[source].abort(reason);
  expect(composed.aborted).toBe(true);
  expect(composed.reason).toBe(reason);
});

test("deadline creation errors propagate before I/O", async () => {
  const reason = new Error("clock unavailable");
  const state = fixture({ clock: { nowMs: () => 0, timeoutSignal: () => { throw reason; } } });
  await expect(state.client.send({ request: request({ totalDeadlineMs: 2000 }) })).rejects.toBe(reason);
  expect(state.resolved).toEqual([]);
});

test.each([false, true])("operational failures retain identity with a live deadline: %s", async (withDeadline) => {
  const reason = new Error("connection failed");
  const state = fixture({ transport: { requestPinned: async () => { throw reason; } } });
  const input = request({});
  if (withDeadline) input.totalDeadlineMs = 2000;
  await expect(state.client.send({ request: input })).rejects.toBe(reason);
});

test("an expired deadline is translated to FetchTimeoutError", async () => {
  const state = fixture({ clock: { nowMs: () => 0, timeoutSignal: () => AbortSignal.abort(new Error("expired")) } });
  await expect(state.client.send({ request: request({ totalDeadlineMs: 2000 }) }))
    .rejects.toEqual(new FetchTimeoutError("https://example.com/", 2000));
  expect(state.resolved).toEqual([]);
});

test("caller cancellation wins when both caller and deadline are already aborted", async () => {
  const reason = new Error("caller cancelled");
  const state = fixture({ clock: { nowMs: () => 0, timeoutSignal: () => AbortSignal.abort(new Error("expired")) } });
  await expect(state.client.send({ request: request({ signal: AbortSignal.abort(reason), totalDeadlineMs: 2000 }) }))
    .rejects.toBe(reason);
  expect(state.resolved).toEqual([]);
});
