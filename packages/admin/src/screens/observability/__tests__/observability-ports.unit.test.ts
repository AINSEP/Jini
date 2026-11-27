import { expect, it, vi } from "vitest";
import type { AdminObservabilityStatus } from "../api/observability-api.types.js";
import { createFakeObservabilityStatusPort, createObservabilityStatusPort } from "../hooks/observability-status-dependencies.hooks.js";
import { createFakeRecentServerErrorsPort, createRecentServerErrorsPort } from "../hooks/recent-server-errors-dependencies.hooks.js";

const status = { enabled: true, serviceName: "telemetry-worker" };
const delivery = { providers: [{ providerId: "disk", signals: ["span" as const] }] };
const filters = { level: "error" as const, limit: 17 };
const logs = { entries: [], matched: 9, buffered: 27, truncated: true, capturing: true };

it("reads the current status client and requests a diagnostic without submitting a message", async () => {
  const api = {
    getObservabilityStatus: vi.fn(async (): Promise<AdminObservabilityStatus> => ({ enabled: false, serviceName: null })),
    sendObservabilityTestError: vi.fn(async () => delivery),
  };
  const previous = api.getObservabilityStatus;
  const port = createObservabilityStatusPort({ api });
  api.getObservabilityStatus = vi.fn(async (): Promise<AdminObservabilityStatus> => status);
  await expect(port.getObservabilityStatus()).resolves.toEqual(status);
  expect(previous).not.toHaveBeenCalled();
  expect(api.getObservabilityStatus).toHaveBeenCalledExactlyOnceWith();
  await expect(port.sendTestError?.()).resolves.toEqual(delivery);
  expect(api.sendObservabilityTestError).toHaveBeenCalledExactlyOnceWith();
});

it("provides disabled-by-default fake status, seeded status and injected failures", async () => {
  const failed = new Error("collector unavailable");
  await expect(createFakeObservabilityStatusPort().getObservabilityStatus()).resolves.toEqual({ enabled: false, serviceName: null });
  await expect(createFakeObservabilityStatusPort({ status }).getObservabilityStatus()).resolves.toEqual(status);
  await expect(createFakeObservabilityStatusPort({ status, failWith: failed }).getObservabilityStatus()).rejects.toBe(failed);
});

it("forwards log filters and preserves the clipboard refusal", async () => {
  const api = { getServerLogs: vi.fn(async () => logs) };
  const clipboard = { copyText: vi.fn(async () => false) };
  const port = createRecentServerErrorsPort({ api, clipboard });
  await expect(port.getServerLogs(filters, {})).resolves.toEqual(logs);
  expect(api.getServerLogs).toHaveBeenCalledExactlyOnceWith(filters);
  await expect(port.copyText("Server refused request 8")).resolves.toBe(false);
  expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith("Server refused request 8");
});

it("keeps separate fake histories and records a query even when it fails", async () => {
  const failure = new Error("logs unavailable");
  const normal = createFakeRecentServerErrorsPort();
  const failing = createFakeRecentServerErrorsPort({ logs, failWith: failure, copyResult: false });
  await expect(normal.getServerLogs(filters)).resolves.toEqual({ entries: [], matched: 0, buffered: 0, truncated: false, capturing: true });
  await expect(failing.getServerLogs({ level: "error", limit: 5 })).rejects.toBe(failure);
  await expect(failing.copyText("failed record")).resolves.toBe(false);
  await expect(normal.copyText("normal record")).resolves.toBe(true);
  expect(failing.queries).toEqual([{ level: "error", limit: 5 }]);
  expect(normal.queries).toEqual([filters]);
  expect(failing.copied).toEqual(["failed record"]);
  expect(normal.copied).toEqual(["normal record"]);
});
