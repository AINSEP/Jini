import { expect, it, vi } from "vitest";
import { buildPagesRegistrations, type PagesToolDeps } from "../tool-registrations.js";
import { createPagesAgentToolCatalog } from "../agent-tools.js";
import { PageConcurrentEditError } from "../html-document-store.js";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { PageHtmlRegionPorts } from "@jini-ai/core/contracts/site/html-region-ports";
import type { PagesHtmlDocumentStorePort } from "@jini-ai/core/contracts/site/page-html-store";
import type { PostRepoPort } from "../../posts/post.js";

const html = '<section data-agent-element="hero">old</section>';
const region = { handle: "hero", tag: "section", start: 0, end: html.length, innerStart: html.indexOf('>') + 1, innerEnd: html.lastIndexOf('<') };
const regions: PageHtmlRegionPorts = { scanHtmlRegions: () => ({ regions: [region], topLevel: [], parseErrorReasons: [] }), handlesMadeAmbiguous: () => [],
  locateRegion: () => ({ region }), moveRegion: () => ({ html }), regionHandlesIn: () => ["hero"],
  replaceRegionInner: ({ fragment }) => html.slice(0, region.innerStart) + fragment + html.slice(region.innerEnd), untaggedTopLevelSections: () => [] };
const ctx = (input: unknown): ToolExecutionContext => ({ executionId: "e", principal: { id: "owner" }, run: { id: "r" }, input, signal: new AbortController().signal });
function setup() {
  let captured = 1;
  let version = 1;
  let stored = html;
  const store: PagesHtmlDocumentStorePort = { ensureHtmlFormat: async () => {}, capturedVersion: () => captured,
    read: vi.fn(async () => { captured = version; return stored; }), write: vi.fn(async ({ html: value }) => { if (captured !== version) throw new PageConcurrentEditError("stale"); if (stored !== value) { stored = value; captured = ++version; } }) };
  const openStore = vi.fn(() => store);
  const deps: PagesToolDeps = { workspaceId: "w", authorize: vi.fn(async () => ({ allowed: true, reason: "matched" })), pagesHtmlStore: openStore, postRepo: {} as PostRepoPort };
  const host: Parameters<typeof buildPagesRegistrations>[0]["host"] = { catalog: createPagesAgentToolCatalog({ editHtmlPermission: "custom.html", authoringContract: "contract", editGuidance: "guidance" }), editHtmlPermission: "custom.html", regions,
    readTheme: async () => null, recordWrite: () => async ({ write }) => { const outcome = await write(); return { value: outcome.value, version: outcome.version, ...(outcome.changed ? { changeSetId: "undo" } : {}) }; } };
  return { deps, host, store, openStore, advance: () => { version++; } };
}
it("full and region writes use the same injected HTML permission before opening the store", async () => {
  for (const name of ["pages_write_html", "pages_write_region"]) {
    const s = setup();
    s.deps.authorize = vi.fn(async ({ permission }) => { expect(permission).toBe("custom.html"); expect(s.openStore).not.toHaveBeenCalled(); return { allowed: false, reason: "no" }; });
    const tool = buildPagesRegistrations({ deps: s.deps, host: s.host }).find(t => t.descriptor.id === name);
    if (!tool) throw new Error("missing tool");
    await expect(tool.handler(ctx({ id: "p", regionId: "hero", html, expectedVersion: 1 }))).rejects.toThrow();
    expect(s.openStore).not.toHaveBeenCalled();
    expect(s.deps.authorize).toHaveBeenCalledTimes(1);
  }
});
it("a stale edit cannot recapture the latest store basis", async () => {
  const s = setup();
  s.host.recordWrite = () => async ({ write }) => { s.advance(); const value = await write(); return { value: value.value, version: value.version, changeSetId: "undo" }; };
  const tool = buildPagesRegistrations({ deps: s.deps, host: s.host }).find(t => t.descriptor.id === "pages_write_region");
  if (!tool) throw new Error("missing tool");
  await expect(tool.handler(ctx({ id: "p", regionId: "hero", html: "new", expectedVersion: 1 }))).rejects.toThrow("VERSION_CONFLICT");
  expect(s.store.read).toHaveBeenCalledTimes(1);
});
it("a no-op returns no Undo ID", async () => {
  const s = setup();
  const tool = buildPagesRegistrations({ deps: s.deps, host: s.host }).find(t => t.descriptor.id === "pages_write_html");
  if (!tool) throw new Error("missing tool");
  const result = await tool.handler(ctx({ id: "p", html, expectedVersion: 1 }));
  expect(result).toMatchObject({ written: true, version: 1 });
  expect(result).not.toHaveProperty("changeSetId");
});
