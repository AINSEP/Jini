import { expect, test, vi } from "vitest";

import { browserQueuedStartPorts, startQueuedDaemonRun, type QueuedStartPorts } from "../queued-daemon-start.js";
import { orFallback } from "@jini-ai/core/errors/idioms";

/**
 * @file `startQueuedDaemonRun` retries only a 409 `CHAT_RUN_BUSY` refusal, keeping the same body,
 * and `browserQueuedStartPorts` posts the run and waits 1 s with Stop honoured during the wait.
 * L13 Stryker: the busy → wait → retry branch and the abort paths had no test at all.
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function scripted(responses: Response[]) {
  const bodies: unknown[] = [];
  const waits: Array<AbortSignal | undefined> = [];
  const ports: QueuedStartPorts = {
    post: async ({ body }) => { bodies.push(body); return responses.shift()!; },
    wait: async ({ signal }) => { waits.push(signal); },
    readRefusal: ({ response }) => orFallback({ work: () => response.clone().json(), fallback: null, step: "Read queued run refusal" }),
  };
  return { ports, bodies, waits };
}

test("a busy refusal waits and retries the identical body until the run is accepted", async () => {
  const controller = new AbortController();
  const body = { messageId: "m-1", text: "hi" };
  const f = scripted([json(409, { code: "CHAT_RUN_BUSY" }), json(409, { code: "CHAT_RUN_BUSY" }), json(201, { id: "run-1" })]);
  const response = await startQueuedDaemonRun({ body, signal: controller.signal, ports: f.ports });
  expect(response.status).toBe(201);
  expect(f.bodies).toEqual([body, body, body]);
  expect(f.bodies[2]).toBe(body);
  expect(f.waits).toEqual([controller.signal, controller.signal]);
});

test("any non-409 response, or a 409 that is not CHAT_RUN_BUSY, is returned without waiting", async () => {
  for (const response of [json(200, {}), json(500, { code: "CHAT_RUN_BUSY" }), json(409, { code: "CONFLICT" }), json(409, {}),
    new Response("not json", { status: 409 }), json(409, null)]) {
    const f = scripted([response]);
    expect(await startQueuedDaemonRun({ body: {}, ports: f.ports })).toBe(response);
    expect(f.waits).toEqual([]);
  }
});

test("the returned busy-shaped response body stays readable (the payload probe reads a clone)", async () => {
  const f = scripted([json(409, { code: "CONFLICT", detail: "x" })]);
  const response = await startQueuedDaemonRun({ body: {}, ports: f.ports });
  expect(await response.json()).toEqual({ code: "CONFLICT", detail: "x" });
});

test("an aborted signal stops before posting, including between busy retries", async () => {
  const before = new AbortController();
  before.abort();
  const f = scripted([json(201, {})]);
  await expect(startQueuedDaemonRun({ body: {}, signal: before.signal, ports: f.ports })).rejects.toMatchObject({ name: "AbortError", message: "The queued turn was stopped." });
  expect(f.bodies).toEqual([]);

  const during = new AbortController();
  const g = scripted([json(409, { code: "CHAT_RUN_BUSY" }), json(201, {})]);
  g.ports = { ...g.ports, wait: async () => { during.abort(); } };
  await expect(startQueuedDaemonRun({ body: {}, signal: during.signal, ports: g.ports })).rejects.toMatchObject({ name: "AbortError" });
  expect(g.bodies).toHaveLength(1);
});

test("browser ports POST the JSON body to /api/runs with same-origin credentials", async () => {
  const request = vi.fn(async () => new Response(null, { status: 201 }));
  const ports = browserQueuedStartPorts({ orFallback }, { request: request as unknown as typeof fetch });
  await ports.post({ body: { a: 1 } }, {});
  expect(request).toHaveBeenCalledWith("/api/runs", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{\"a\":1}" });
});

test("browser wait schedules one 1 s timer and resolves when it fires, dropping its abort listener", async () => {
  const scheduled: Array<{ work: () => void; delayMs: number }> = [];
  const cancel = vi.fn();
  const ports = browserQueuedStartPorts({ orFallback }, { schedule: (entry) => { scheduled.push(entry); return cancel; } });
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const pending = ports.wait({ signal: controller.signal }, {});
  expect(scheduled.map(entry => entry.delayMs)).toEqual([1_000]);
  scheduled[0]!.work();
  await expect(pending).resolves.toBeUndefined();
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  controller.abort();
  expect(cancel).not.toHaveBeenCalled();
});

test("browser wait: Stop during the wait cancels the timer and rejects; an already-stopped signal never schedules", async () => {
  const cancel = vi.fn();
  const schedule = vi.fn(() => cancel);
  const ports = browserQueuedStartPorts({ orFallback }, { schedule });
  const controller = new AbortController();
  const pending = ports.wait({ signal: controller.signal }, {});
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "The queued turn was stopped." });
  expect(cancel).toHaveBeenCalledTimes(1);

  schedule.mockClear();
  await expect(ports.wait({ signal: controller.signal }, {})).rejects.toMatchObject({ name: "AbortError" });
  expect(schedule).not.toHaveBeenCalled();
});

test("browser wait without a signal still resolves on the timer", async () => {
  let work!: () => void;
  const ports = browserQueuedStartPorts({ orFallback }, { schedule: (entry) => { work = entry.work; return () => {}; } });
  const pending = ports.wait({}, {});
  work();
  await expect(pending).resolves.toBeUndefined();
});

test("the default schedule uses a real 1 s timeout that can be cleared", async () => {
  vi.useFakeTimers();
  try {
    const ports = browserQueuedStartPorts({ orFallback });
    const controller = new AbortController();
    const settled = vi.fn();
    const pending = ports.wait({ signal: controller.signal }, {}).then(settled, settled);
    vi.advanceTimersByTime(999);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await pending;
    expect(settled).toHaveBeenCalledWith(undefined);

    const stopped = ports.wait({ signal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 10); return c.signal; })() }, {});
    vi.advanceTimersByTime(10);
    await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
