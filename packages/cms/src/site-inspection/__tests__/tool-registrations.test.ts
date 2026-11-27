import { expect, it, vi } from "vitest";
import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
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
  expect(() => tools.find(item => item.descriptor.id === "fetch_published_page")!.normalizeInput!({ input: { path: "/", context: "override" } })).toThrow("context is not supported");
  await expect(tools.find(item => item.descriptor.id === "fetch_live_url")!.handler({ ...ctx, input: { path: "/" } })).rejects.toThrow("not authorized");
  expect(fetchPublishedPage).not.toHaveBeenCalled();
  expect(fetchLiveUrl).not.toHaveBeenCalled();
});

type InspectionDeps = Parameters<typeof buildSiteInspectionRegistrations>[0];
function fixture() {
  const listPosts = vi.fn(async () => [
    { id: "about", title: "About", slug: "about", bodyFormat: "html", kind: "page", status: "published", updatedAt: "2026-11-10" },
    { id: "home", title: "Home", slug: "/", bodyFormat: "html", kind: "page", status: "published", updatedAt: "2026-11-10" },
  ]);
  const authorize = vi.fn<InspectionDeps["authorize"]>(async ({ permission }) => ({ allowed: permission !== "settings.read", reason: "fixture grant" }));
  const fetchPublishedPage = vi.fn<InspectionDeps["fetchPublishedPage"]>(async () => ({ status: 200, body: "local render" }));
  const fetchLiveUrl = vi.fn<InspectionDeps["fetchLiveUrl"]>(async () => ({ status: 202, body: "live response" }));
  const createSiteApp = vi.fn<ReturnType<InspectionDeps["publishedPageDeps"]>["createSiteApp"]>();
  const trackFetch: InspectionDeps["trackFetch"] = ({ fetch }) => fetch;
  const pathError = new Error("Path is reserved by this host.");
  const deps: InspectionDeps = {
    catalog: createSiteInspectionAgentToolCatalog({ readPermission: "read", capabilitiesVisibilityPermission: "visible", maxPathLength: 100,
      bodyBytes: { defaultMax: 100, hardMax: 1000 }, descriptions: { profile: "Profile", capabilities: "Capabilities", live: "Live", published: "Published" } }),
    workspaceId: "w", readPermission: "read", authorize, fetchPublishedPage, fetchLiveUrl, trackFetch, reservedSegments: new Set(["admin"]),
    readPageBodyOptions: ({ input }) => input.find === "notice" ? { find: "notice", maxBytes: 75, textOnly: true } : {},
    isEgressRefusal: (error): error is { callerSafeMessage: string } => error instanceof Error && "callerSafeMessage" in error,
    isPublishedPagePathError: (error) => error === pathError,
    publishedPageDeps: () => ({ createSiteApp }),
    toSiteProfileDeps: () => ({
      workspaceId: "w", authorize, clock: { nowIso: () => "2026-11-10" }, listPosts,
      listThemes: async () => [], readActiveThemeId: async () => null, listPlugins: async () => [],
      listPluginActivations: async () => [], listContentTypes: async () => [],
      readSetting: async () => { throw new Error("Denied settings must not be read"); },
      noThemeId: "off", themeIdCandidates: ({ id }) => [id], reportSectionFailure: () => {},
    }),
    toSiteCapabilitiesDeps: () => ({
      workspaceId: "w", authorize, clock: { nowIso: () => "2026-11-10" }, reportSectionFailure: () => {},
      listAdminScreens: () => [{ id: "posts", label: "Posts", path: "/posts" }], listContentTypes: async () => [],
    }),
  };
  const run = (id: string, input: unknown, live?: Parameters<typeof buildSiteInspectionRegistrations>[1]) => {
    const registration = buildSiteInspectionRegistrations(deps, live).find(item => item.descriptor.id === id);
    if (!registration) throw new Error(`Missing inspection tool ${id}`);
    return registration.handler({ executionId: "e", principal: { id: "owner" }, run: { id: "r" }, input, signal: new AbortController().signal });
  };
  return { run, deps, pathError, createSiteApp, trackFetch, authorize, listPosts, fetchPublishedPage, fetchLiveUrl };
}

it("profile and capabilities tools ask only for their selected sections and carry the caller and page limit", async () => {
  const f = fixture();
  const profile = await f.run("site_get_profile", { sections: ["settings", "pages"], pageLimit: 1 });
  expect(profile).toMatchObject({ completeness: "partial", sections: {
    pages: { status: "ok", truncated: true, data: { total: 2, items: [{ id: "about" }] } },
    settings: { status: "forbidden", reason: "fixture grant" },
  } });
  expect(Object.keys((profile as { sections: object }).sections)).toEqual(["pages", "settings"]);
  const capabilities = await f.run("site_describe_capabilities", { sections: ["adminScreens"] });
  expect(Object.keys((capabilities as { sections: object }).sections)).toEqual(["adminScreens"]);
  expect(capabilities).toMatchObject({ sections: { adminScreens: { status: "ok" } } });
  expect(f.authorize.mock.calls.map(([request]) => request)).toEqual([
    { principalId: "owner", workspaceId: "w", permission: "content.read", entityType: "site-profile-section", entityId: "pages" },
    { principalId: "owner", workspaceId: "w", permission: "settings.read", entityType: "site-profile-section", entityId: "settings" },
    { principalId: "owner", workspaceId: "w", permission: "admin.assistant.use", entityType: "site-capabilities-section", entityId: "adminScreens" },
  ]);
});

it("section input errors include the calling tool's vocabulary and its schema", async () => {
  const { run, authorize } = fixture();
  for (const [id, sections, hint] of [
    ["site_get_profile", "pages", "sections must be an array of section names — valid names are: pages, theme, plugins, settings, contentTypes"],
    ["site_get_profile", ["pages", 5], "unknown section '5'"],
    ["site_describe_capabilities", ["pages"], "unknown section 'pages' — valid names are: tools, adminScreens, contentTypes"],
  ] as const) {
    const error = await run(id, { sections }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as Error).message).toContain(hint);
    expect((error as Error).message).toContain(`Schema for '${id}'`);
  }
  expect(authorize.mock.calls).toEqual([]);
});

it("null sections use the profile default instead of suppressing collection", async () => {
  const { run } = fixture();
  const found = await run("site_get_profile", { sections: null });
  expect(Object.keys((found as { sections: object }).sections)).toEqual(["pages", "theme", "plugins", "settings", "contentTypes"]);
});

it("a guarded live fetch carries the authorized path, options, and injected policy", async () => {
  const f = fixture();
  const live = { listKnownOrigins: async () => ["https://upstream.example.test"], httpClient: { send: vi.fn() } };
  expect(await f.run("fetch_live_url", { path: "/feed", origin: "https://upstream.example.test", find: "notice" }, live))
    .toEqual({ status: 202, body: "live response" });
  expect(f.fetchLiveUrl.mock.calls).toEqual([[
    { ...live, reservedSegments: f.deps.reservedSegments, isEgressRefusal: f.deps.isEgressRefusal },
    { path: "/feed", origin: "https://upstream.example.test", find: "notice", maxBytes: 75, textOnly: true },
  ]]);
  expect(f.authorize.mock.calls).toEqual([[{ principalId: "owner", workspaceId: "w", permission: "read", entityType: "published-page" }]]);
});

it("invalid origins and an unwired live client never reach the fetch port", async () => {
  const f = fixture();
  await expect(f.run("fetch_live_url", { path: "/feed", origin: 5 })).rejects.toThrow(
    new ToolInputError({ message: "fetch_live_url: origin must be a known HTTPS origin string." }));
  await expect(f.run("fetch_live_url", { path: "/feed" })).rejects.toThrow(
    new ToolInputError({ message: "fetch_live_url: the guarded live HTTP client is not wired on this host." }));
  expect(f.fetchLiveUrl.mock.calls).toEqual([]);
});

it("published fetch binds the host render and ports, and only decorates recognized path refusals", async () => {
  const f = fixture();
  expect(await f.run("fetch_published_page", { path: "/feed", find: "notice" })).toEqual({ status: 200, body: "local render" });
  const [required, options] = f.fetchPublishedPage.mock.calls[0]!;
  expect(required.input).toEqual({ path: "/feed" });
  expect(options).toEqual({ find: "notice", maxBytes: 75, textOnly: true });
  expect(required.deps.createSiteApp).toBe(f.createSiteApp);
  expect(required.deps.trackFetch).toBe(f.trackFetch);
  expect([...required.deps.reservedSegments]).toEqual(["admin"]);
  f.fetchPublishedPage.mockRejectedValueOnce(f.pathError);
  const error = await f.run("fetch_published_page", { path: "/admin" }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(ToolInputError);
  expect((error as Error).message).toContain("Schema for 'fetch_published_page'");
  expect((error as Error).message).toContain("Path is reserved by this host.");
  const outage = new Error("local render is down");
  f.fetchPublishedPage.mockRejectedValueOnce(outage);
  await expect(f.run("fetch_published_page", { path: "/feed" })).rejects.toBe(outage);
});
