import { expect, it, vi } from "vitest";

import type { AdminExportRunSnapshot } from "../../../core/index.js";
import { createImportExportApi, type ImportExportApiDeps } from "../api/import-export-api.js";

type RequestArgs = Parameters<ImportExportApiDeps["request"]>;
function apiWithTransport(transport: (...args: RequestArgs) => Promise<unknown>) {
  const request: ImportExportApiDeps["request"] = async <T>(...args: RequestArgs) => (await transport(...args)) as T;
  return createImportExportApi({ request, workspaceId: "editorial" });
}

const path = "/workspaces/editorial/system/export";
const running: AdminExportRunSnapshot = {
  status: "running", startedAtIso: "2026-11-22T09:00:00Z", finishedAtIso: null, outputDir: null,
};
const complete: AdminExportRunSnapshot = {
  ...running, status: "completed", finishedAtIso: "2026-11-22T09:01:00Z",
  outputDir: "/exports/editorial", basePath: "/review", ok: true,
  counts: { routesSucceeded: 4, routesFailed: 0, assetsSucceeded: 9, assetsFailed: 0 },
};

it("starts a scoped export with explicit options and polls its status using the read request", async () => {
  const request = vi.fn<(...args: RequestArgs) => Promise<unknown>>().mockResolvedValueOnce(running).mockResolvedValueOnce(complete);
  const api = apiWithTransport(request);
  expect(await api.triggerSiteExport({ clean: false, basePath: "/review" })).toEqual(running);
  expect(await api.getSiteExportStatus()).toEqual(complete);
  expect(request.mock.calls).toEqual([
    [{ path }, { init: { method: "POST", body: '{"clean":false,"basePath":"/review"}' } }],
    [{ path }],
  ]);
});

it("sends an empty JSON object for a default trigger and propagates the host's in-flight refusal", async () => {
  const alreadyRunning = Object.assign(new Error("An export is already running"), { status: 409 });
  const request = vi.fn<(...args: RequestArgs) => Promise<unknown>>().mockImplementation(async (...args) => {
    expect(args).toEqual([{ path }, { init: { method: "POST", body: "{}" } }]);
    throw alreadyRunning;
  });
  const api = apiWithTransport(request);
  await expect(api.triggerSiteExport()).rejects.toBe(alreadyRunning);
  expect(request).toHaveBeenCalledTimes(1);
});
