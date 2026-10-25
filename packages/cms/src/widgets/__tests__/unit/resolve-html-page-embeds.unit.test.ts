import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { InMemoryEntryRepo } from "../../../entries/index.js";
import { findMediaByIdOrSlug, getLatestTransformDefinition } from "../../../media/index.js";
import { InMemoryTaxonomyRepo, InMemoryTermRepo } from "../../../taxonomy/index.js";
import type { WidgetHostPorts } from "../../host-ports.js";
import { resolveHtmlPageEmbeds, substituteHtmlEmbeds, type PluginExportRender, type ResolveHtmlPageEmbedsDeps } from "../../html/index.js";

/**
 * @file `resolveHtmlPageEmbeds` — the per-type dispatch over an html-format Page's embed markers,
 * reached through the `widgets/html` public barrel. Pins the three outcomes a type can have at this
 * stage: dispatched to its registered resolver (here `taxonomy`, backed by the real in-memory
 * taxonomy adapters), deferred to the later theme pass without a warning (`menu`), or owned nowhere
 * (one loud warning per type, never per occurrence).
 */

const WS = "ws-1";
const T0 = "2026-01-01T00:00:00.000Z";
const unexpected = async (): Promise<never> => { throw new Error("unexpected call"); };

function host(): ResolveHtmlPageEmbedsDeps["host"] {
  const posts: WidgetHostPorts["posts"] = {
    isTrashed: () => false,
    isVersionConflict: (_error): _error is Error & { currentVersion: number } => false,
    isNotFound: () => false,
    updatePost: unexpected,
    restorePostForward: unexpected,
    findPublishedPostById: unexpected,
    findPublishedPostBySlug: unexpected,
  };
  return { media: { findMediaByIdOrSlug, getLatestTransformDefinition, publicTransformName: "public" }, posts };
}

async function taxonomyDeps(): Promise<ResolveHtmlPageEmbedsDeps> {
  const taxonomyRepo = new InMemoryTaxonomyRepo();
  const termRepo = new InMemoryTermRepo();
  await taxonomyRepo.insert({ id: "tax-1", name: "Topics", hierarchical: false, status: "active", updatedAt: T0, version: 1 });
  await termRepo.insert({ id: "t-1", taxonomyId: "tax-1", parentId: null, name: "News", status: "active", updatedAt: T0, version: 1 });
  return { entryRepo: new InMemoryEntryRepo(), host: host(), taxonomyRepo, termRepo };
}

describe("resolveHtmlPageEmbeds", () => {
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => undefined); });
  afterEach(() => { warn.mockRestore(); });

  it("dispatches a registered type to its resolver and keys the result by type, then id", async () => {
    const html = `<div data-embed-config='{"type":"taxonomy","id":"tax-1"}'></div><div data-embed-config='{"type":"taxonomy","id":"missing"}'></div>`;
    const result = await resolveHtmlPageEmbeds({ deps: await taxonomyDeps(), input: { workspaceId: WS, html } });

    expect([...result.keys()]).toEqual(["taxonomy"]);
    expect(result.get("taxonomy")?.get("tax-1")).toEqual({
      componentId: "taxonomy-list",
      props: { id: "tax-1", name: "Topics", hierarchical: false, terms: [{ id: "t-1", name: "News", parentId: null }] },
    });
    // A dead id stays absent (the caller renders the placeholder), never an arbitrary match.
    expect(result.get("taxonomy")?.has("missing")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves a theme-owned type (menu) absent from the result without logging it as unknown", async () => {
    const html = `<nav data-embed-config='{"type":"menu","id":"main"}'>fallback</nav>`;
    const result = await resolveHtmlPageEmbeds({ deps: await taxonomyDeps(), input: { workspaceId: WS, html } });

    expect(result.size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once per unknown type with its occurrence count, and leaves it absent", async () => {
    const marker = `<div data-embed-config='{"type":"carousel","id":"x"}'></div>`;
    const result = await resolveHtmlPageEmbeds({ deps: await taxonomyDeps(), input: { workspaceId: WS, html: marker + marker } });

    expect(result.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[widgets] resolveHtmlPageEmbeds: unknown embed type, every occurrence degrades to the placeholder",
      { type: "carousel", workspaceId: WS, occurrences: 2 },
    );
  });

  it("dispatches plugin markers through the optional site-scoped port", async () => {
    const deps = await taxonomyDeps();
    const html = `<div data-embed-config='{"type":"plugin","plugin":"example/login","component":"button","props":{}}'>fallback</div>`;
    const absent = await resolveHtmlPageEmbeds({ deps, input: { workspaceId: WS, html } });
    expect([...absent.get("plugin")!]).toEqual([]);
    // A host without plugin support still serves the author's fallback, without an error.
    expect(substituteHtmlEmbeds({ html, resolve: ref => absent.get(ref.type)?.get(ref.id!)?.props as unknown as PluginExportRender | undefined })).toBe('<div>fallback</div>');
    const result = await resolveHtmlPageEmbeds({ deps: { ...deps, pluginExports: { resolve: async ({ workspaceId }) => ({
      plugin: "example/login", component: "button", version: 1, consent: "necessary",
      template: "<span>{{host.site}}</span>", props: {}, host: { site: workspaceId },
    }) } }, input: { workspaceId: WS, html } });
    expect(result.get("plugin")?.get("plugin:1")).toEqual({ componentId: "plugin-export", props: {
      plugin: "example/login", component: "button", version: 1, consent: "necessary", html: "<span>ws-1</span>",
    } });
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns an empty map for a page with no embed markers", async () => {
    const result = await resolveHtmlPageEmbeds({ deps: await taxonomyDeps(), input: { workspaceId: WS, html: "<p>plain</p>" } });
    expect(result.size).toBe(0);
  });
});
