import { expect, it, vi } from "vitest";
import { siteAssistantConfirmRoute, type SiteAssistantConfirmDeps } from "../site-assistant-confirm.js";

it("keeps malformed, foreign-origin and non-accepted decisions non-oracular and non-cacheable", async () => {
  const order: string[] = [];
  const confirm = vi.fn(async () => false);
  const deps: SiteAssistantConfirmDeps = { rateAllowed: async () => true, enabled: async () => true, isJson: () => { order.push("json"); return true; }, sameOrigin: async () => { order.push("origin"); return false; }, confirm, reportError: vi.fn(), refusalText: "refused" };
  const body = { challengeId: "a".repeat(22), allow: true };
  for (const value of [null, { ...body, owner: "forged" }, body]) {
    order.length = 0;
    const response = await siteAssistantConfirmRoute.handle({ raw: { body: value }, deps });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "refused" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(order[0]).toBe("origin");
  }
  expect(confirm).not.toHaveBeenCalled();
  const response = await siteAssistantConfirmRoute.handle({ raw: { body }, deps: { ...deps, sameOrigin: async () => true } });
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "refused" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(confirm.mock.calls).toEqual([[body]]);
});

it("does not touch visitor storage before rate and feature admission and binds the exact owner", async () => {
  const confirm = vi.fn(async () => true);
  const resolveOwner = vi.fn(async () => ({ workspaceId: "workspace", principalId: "person", tabId: "tab" }));
  const deps: SiteAssistantConfirmDeps = { rateAllowed: async () => true, enabled: async () => true, isJson: () => true, sameOrigin: async () => true, resolveOwner, confirm, reportError: vi.fn(), refusalText: "refused" };
  const body = { challengeId: "a".repeat(22), allow: false };
  expect((await siteAssistantConfirmRoute.handle({ raw: { body }, deps: { ...deps, rateAllowed: async () => false } })).status).toBe(429);
  expect((await siteAssistantConfirmRoute.handle({ raw: { body }, deps: { ...deps, enabled: async () => false } })).status).toBe(404);
  expect(confirm).not.toHaveBeenCalled(); expect(resolveOwner).not.toHaveBeenCalled();
  const response = await siteAssistantConfirmRoute.handle({ raw: { body }, deps });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ accepted: true });
  expect(confirm.mock.calls).toEqual([[{ ...body, owner: { workspaceId: "workspace", principalId: "person", tabId: "tab" } }]]);
  const failure = new Error("private");
  confirm.mockRejectedValueOnce(failure);
  const refused = await siteAssistantConfirmRoute.handle({ raw: { body }, deps });
  expect(refused.status).toBe(400); expect(await refused.json()).toEqual({ error: "refused" });
  expect(deps.reportError).toHaveBeenCalledWith({ error: failure });
  expect(refused.headers.get("cache-control")).toBe("no-store");
});
