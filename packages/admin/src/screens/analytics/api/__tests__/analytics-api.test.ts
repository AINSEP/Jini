import { expect, it, vi } from "vitest";
import { createAnalyticsApi, type AnalyticsApiDeps } from "../analytics-api.js";

it("uses the workspace's recent-hit endpoint with a limit only when requested", async () => {
  const base = "/workspaces/agency-7/analytics/recent-hits";
  const result = { hits: [{
    occurredAt: "2026-05-01T18:00:00Z", kind: "event", path: "/pricing",
    referrerHost: null, deviceClass: "mobile", browserFamily: "Firefox", eventName: "download",
  }] };
  const request = vi.fn(async ({ path }: { path: string }) => {
    if (path === base) return { hits: [] };
    if (path === `${base}?limit=19`) return result;
    throw new Error(`Unexpected analytics URL: ${path}`);
  });
  const api = createAnalyticsApi({ request: request as unknown as AnalyticsApiDeps["request"], workspaceId: "agency-7" });
  await expect(api.listRecentAnalyticsHits({ limit: 19 })).resolves.toEqual(result);
  await expect(api.listRecentAnalyticsHits()).resolves.toEqual({ hits: [] });
  await expect(api.listRecentAnalyticsHits({ limit: 0 })).resolves.toEqual({ hits: [] });
  expect(request.mock.calls).toEqual([[{ path: `${base}?limit=19` }], [{ path: base }], [{ path: base }]]);
});
