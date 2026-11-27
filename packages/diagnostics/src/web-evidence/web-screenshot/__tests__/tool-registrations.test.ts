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
  const first = contributor.build({ workspaceId: "one", authorize: async () => ({ allowed: false, reason: "denied" }) }, undefined)[0]!;
  const ctx = { executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: {}, signal: new AbortController().signal };
  await expect(first.handler(ctx)).rejects.toThrow();
  expect(screenshot).not.toHaveBeenCalled();
  const second = contributor.build({ workspaceId: "two", authorize: async () => ({ allowed: true, reason: "granted" }) }, undefined)[0]!;
  await second.handler(ctx);
  expect(screenshot).toHaveBeenCalledTimes(1);
  expect(screenshot.mock.calls[0]?.[0]).toMatchObject({ openOwnSite: expect.any(Function), saveCaptureFiles: expect.any(Function) });
  expect(openOwnSiteFor).toHaveBeenCalledTimes(2);
  expect(saveCaptureFilesFor).toHaveBeenCalledTimes(2);
});

it("omits optional site adapters for a public capture and forwards the caller signal", async () => {
  const screenshot = vi.fn<Parameters<typeof contributeWebScreenshotTools>[0]["service"]["screenshot"]>(
    async () => ({ content: [{ type: "text", text: "public capture" }] }),
  );
  const catalog = createWebScreenshotCatalog({ limits: { maxUrlLength: 2048, maxFullPageHeightPx: 20000, maxWaitMs: 10000, defaultWaitMs: 0, viewportNames: ["desktop"] },
    permission: "host.capture", sitePathDescription: "Host page", themeIdDescription: "Host theme" });
  const input = { target: { kind: "url", url: "https://public.example.test/" }, viewport: "desktop", fullPage: true, waitMs: 125 } as const;
  const readInput = vi.fn(() => input);
  const contributor = contributeWebScreenshotTools({ service: { screenshot }, catalog, permission: "host.capture", readInput });
  const registration = contributor.build({ workspaceId: "public", authorize: async () => ({ allowed: true, reason: "granted" }) }, undefined)[0]!;
  const signal = new AbortController().signal;
  const raw = { publicUrl: "https://public.example.test/" };
  await expect(registration.handler({ executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: raw, signal }))
    .resolves.toEqual({ content: [{ type: "text", text: "public capture" }] });
  expect(readInput.mock.calls).toStrictEqual([[{ input: raw }]]);
  expect(screenshot.mock.calls).toStrictEqual([[{ input }, { signal }]]);
});
