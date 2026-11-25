import { expect, test } from "vitest";
import { createSiteInspectionAgentToolCatalog } from "../agent-tools.js";

test("only the live URL schema accepts an origin and only the capabilities entry uses its visibility floor", () => {
  const catalog = createSiteInspectionAgentToolCatalog({ readPermission: "read", capabilitiesVisibilityPermission: "assistant", maxPathLength: 2048, bodyBytes: { defaultMax: 1000, hardMax: 4000 }, descriptions: { profile: "profile", capabilities: "capabilities", live: "live", published: "published" } });
  expect(catalog.map(tool => tool.name)).toEqual(["site_get_profile", "site_describe_capabilities", "fetch_live_url", "fetch_published_page"]);
  for (const tool of catalog) {
    expect(tool.authorization.permission).toBe(tool.name === "site_describe_capabilities" ? "assistant" : "read");
    if (tool.name === "fetch_live_url") expect(tool.inputSchema).toHaveProperty("properties.origin.type", "string");
    else expect(tool.inputSchema).not.toHaveProperty("properties.origin");
  }
});
