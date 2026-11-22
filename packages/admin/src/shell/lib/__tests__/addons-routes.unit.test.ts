import { expect, it } from "vitest";
import { resolveAddonsRoute } from "../addons-routes.js";

/** Owner decision 2026-10-13: exact destinations, raw queries, and bounded legacy URL shapes. */
it.each([
  ["/plugins", "/addons/plugins"],
  ["/agent-plugins", "/addons/agent-plugins"],
  ["/skills", "/addons/skills"],
  ["/providers", "/addons/integrations"],
  ["/providers/?tab=webhooks&cursor=a%2Bb&cursor=x+y", "/addons/integrations?tab=webhooks&cursor=a%2Bb&cursor=x+y"],
  ["/integrations", "/addons/integrations?tab=webhooks"],
  ["/integrations?cursor=a%2Bb", "/addons/integrations?cursor=a%2Bb&tab=webhooks"],
  ["/integrations?tab=mcp-server", "/addons/integrations?tab=mcp-server"],
  ["/integrations/sub%2F1?cursor=a%2Bb", "/addons/integrations/sub%2F1?cursor=a%2Bb"],
])("resolves legacy %s to %s", (routePath, redirectPath) => {
  expect(resolveAddonsRoute({ routePath })).toStrictEqual({ matchPath: routePath, redirectPath });
});

it.each([
  ["/addons/plugins", "/plugins"],
  ["/addons/agent-plugins?tab=add", "/agent-plugins?tab=add"],
  ["/addons/skills/?tab=skills", "/skills?tab=skills"],
  ["/addons/integrations?tab=webhooks&cursor=a%2Bb", "/providers?tab=webhooks&cursor=a%2Bb"],
  ["/addons/integrations/sub%2F1?cursor=a%2Bb", "/integrations/sub%2F1?cursor=a%2Bb"],
])("adapts current %s to stable panel path %s without redirecting", (routePath, matchPath) => {
  expect(resolveAddonsRoute({ routePath })).toStrictEqual({ matchPath });
});

it.each([
  "/", "/settings?tab=privacy", "/posts/p1", "/plugins/unregistered", "/integrations/sub1/extra",
  "/addons", "/addons/unknown", "/addons/plugins/extra", "/addons/integrations/sub1/extra",
  "/constructor", "/toString", "/__proto__", "/addons/constructor",
])("leaves unrelated or invalid %s to the existing matcher", (routePath) => {
  expect(resolveAddonsRoute({ routePath })).toStrictEqual({ matchPath: routePath });
});

it("appends the default Webhooks tab after a bare trailing '?' on a legacy Integrations link", () => {
  expect(resolveAddonsRoute({ routePath: "/integrations?" })).toStrictEqual({
    matchPath: "/integrations?",
    redirectPath: "/addons/integrations?&tab=webhooks",
  });
});

it("keeps every '?' after the first inside the query bytes", () => {
  expect(resolveAddonsRoute({ routePath: "/addons/skills?q=a?b" })).toStrictEqual({ matchPath: "/skills?q=a?b" });
});
