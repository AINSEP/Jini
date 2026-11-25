import { expect, it, vi } from "vitest";
import { createWebScreenshotCatalog } from "../agent-tools.js";
import { contributeWebScreenshotTools } from "../tool-registrations.js";

it("denied callers do not reach the service and both site factories share one service", async () => {
  const screenshot = vi.fn<Parameters<typeof contributeWebScreenshotTools>[0]["service"]["screenshot"]>(async () => ({ content: [{ type: "text" as const, text: "captured" }] }));
  const openOwnSiteFor = vi.fn(() => async () => ({ origin: "http://site", close: async () => {} }));
  const saveCaptureFilesFor = vi.fn(({ workspaceId }: { workspaceId: string }) => async () => [workspaceId]);
  const catalog = createWebScreenshotCatalog({ limits: { maxUrlLength: 2048, maxFullPageHeightPx: 20000, maxWaitMs: 10000, defaultWaitMs: 0, viewportNames: ["desktop"] },
    permission: "host.capture", sitePathDescription: "Host page", themeIdDescription: "Host theme" });
  const contributor = contributeWebScreenshotTools({ service: { screenshot }, catalog, permission: "host.capture",
    readInput: () => ({ target: { kind: "url", url: "https://example.test" }, viewport: "desktop", fullPage: false, waitMs: 0 }) },
    { openOwnSiteFor, saveCaptureFilesFor });
  const first = contributor.build({ workspaceId: "one", authorize: async () => false }, undefined)[0]!;
  const ctx = { executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: {}, signal: new AbortController().signal };
  await expect(first.handler(ctx)).rejects.toThrow();
  expect(screenshot).not.toHaveBeenCalled();
  const second = contributor.build({ workspaceId: "two", authorize: async () => true }, undefined)[0]!;
  await second.handler(ctx);
  expect(screenshot).toHaveBeenCalledTimes(1);
  expect(screenshot.mock.calls[0]?.[0]).toMatchObject({ openOwnSite: expect.any(Function), saveCaptureFiles: expect.any(Function) });
  expect(openOwnSiteFor).toHaveBeenCalledTimes(2);
  expect(saveCaptureFilesFor).toHaveBeenCalledTimes(2);
});
