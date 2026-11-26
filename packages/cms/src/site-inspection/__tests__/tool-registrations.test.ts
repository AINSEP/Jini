import { expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { createSiteInspectionAgentToolCatalog } from "../agent-tools.js";
import { buildSiteInspectionRegistrations } from "../tool-registrations.js";

it("refuses caller context and denied live URLs before rendering or fetch", async () => {
  const fetchPublishedPage = vi.fn();
  const fetchLiveUrl = vi.fn();
  const catalog = createSiteInspectionAgentToolCatalog({ readPermission: "read", capabilitiesVisibilityPermission: "visible", maxPathLength: 100,
    bodyBytes: { defaultMax: 100, hardMax: 1000 }, descriptions: { profile: "Profile", capabilities: "Capabilities", live: "Live", published: "Published" } });
  const deps = { catalog, readPermission: "read", workspaceId: "w", authorize: async () => ({ allowed: false, reason: "denied" }), fetchPublishedPage, fetchLiveUrl,
    readPageBodyOptions: () => ({}), reservedSegments: new Set(), isPublishedPagePathError: () => false } as unknown as Parameters<typeof buildSiteInspectionRegistrations>[0];
  const tools = buildSiteInspectionRegistrations(deps);
  const ctx: ToolExecutionContext = { executionId: "e", principal: { id: "owner" }, run: { id: "r" }, input: { path: "/", context: "override" }, signal: new AbortController().signal };
  await expect(tools.find(item => item.descriptor.id === "fetch_published_page")!.handler(ctx)).rejects.toThrow("context is not supported");
  await expect(tools.find(item => item.descriptor.id === "fetch_live_url")!.handler({ ...ctx, input: { path: "/" } })).rejects.toThrow("not authorized");
  expect(fetchPublishedPage).not.toHaveBeenCalled();
  expect(fetchLiveUrl).not.toHaveBeenCalled();
});
