import { expect, it, vi } from "vitest";
import { buildPagesRegistrations, contributePagesTools, type PagesToolDeps } from "../tool-registrations.js";
import { createPagesAgentToolCatalog } from "../agent-tools.js";
import { PageConcurrentEditError, PageKindMismatchError, PageNotFoundError } from "../html-document-store.js";
import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import type { PageHtmlRegionPorts } from "@jini-ai/core/contracts/site/html-region-ports";
import type { PagesHtmlDocumentStorePort } from "@jini-ai/core/contracts/site/page-html-store";
import type { PostRecord, PostRepoPort } from "../../posts/post.js";

const html = '<section data-agent-element="hero">old</section>';
const region = { handle: "hero", tag: "section", start: 0, end: html.length, innerStart: html.indexOf('>') + 1, innerEnd: html.lastIndexOf('<') };
const regions: PageHtmlRegionPorts = { scanHtmlRegions: () => ({ regions: [region], topLevel: [], parseErrorReasons: [] }), handlesMadeAmbiguous: () => [],
  locateRegion: () => ({ region }), moveRegion: () => ({ html }), regionHandlesIn: () => ["hero"],
  replaceRegionInner: ({ fragment }) => html.slice(0, region.innerStart) + fragment + html.slice(region.innerEnd), untaggedTopLevelSections: () => [] };
const ctx = (input: unknown): ToolExecutionContext => ({ executionId: "e", principal: { id: "owner" }, run: { id: "r" }, input, signal: new AbortController().signal });
function setup(initialVersion = 1, initialHtml = html) {
  let captured = initialVersion;
  let version = initialVersion;
  let stored = initialHtml;
  const store: PagesHtmlDocumentStorePort = { ensureHtmlFormat: async () => {}, capturedVersion: () => captured,
    read: vi.fn(async () => { captured = version; return stored; }), write: vi.fn(async ({ html: value }) => { if (captured !== version) throw new PageConcurrentEditError("stale"); if (stored !== value) { stored = value; captured = ++version; } }) };
  const openStore = vi.fn(() => store);
  const deps: PagesToolDeps = { workspaceId: "w", authorize: vi.fn(async () => ({ allowed: true, reason: "matched" })), pagesHtmlStore: openStore, postRepo: {} as PostRepoPort };
  const host: Parameters<typeof buildPagesRegistrations>[0]["host"] = { catalog: createPagesAgentToolCatalog({ editHtmlPermission: "custom.html", authoringContract: "contract", editGuidance: "guidance" }), editHtmlPermission: "custom.html", regions,
    readTheme: async () => null, recordWrite: () => async ({ write }) => { const outcome = await write(); return { value: outcome.value, version: outcome.version, ...(outcome.changed ? { changeSetId: "undo" } : {}) }; } };
  return { deps, host, store, openStore, stored: () => stored, advance: () => { version++; } };
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

const docPage: PostRecord = {
  id: "p", workspaceId: "w", kind: "page", title: "About", slug: "about", status: "draft", version: 4,
  bodyFormat: "doc", bodyHtml: null, bodyJson: { type: "doc", content: [{ type: "paragraph" }] },
  updatedAt: "2026-11-20T00:00:00.000Z",
};

function registration(s: ReturnType<typeof setup>, id: string) {
  const tool = buildPagesRegistrations({ deps: s.deps, host: s.host }).find(entry => entry.descriptor.id === id);
  if (!tool) throw new Error(`Missing registration for ${id}`);
  return tool;
}

function docFallback(s: ReturnType<typeof setup>, row: PostRecord | null = docPage) {
  s.store.read = vi.fn().mockRejectedValue(new PageNotFoundError("No bespoke HTML"));
  const findById = vi.fn<PostRepoPort["findById"]>(async ({ workspaceId, id }) =>
    workspaceId === "w" && id === "p" ? row : null);
  s.deps.postRepo.findById = findById;
  return findById;
}

it("contributes a scoped HTML reader that returns the captured version and only the selected region when asked", async () => {
  const s = setup();
  const outer = `<main>${html}<footer>Keep private from a region read</footer></main>`;
  const offset = "<main>".length;
  const shifted = { ...region, start: offset, end: region.end + offset, innerStart: region.innerStart + offset, innerEnd: region.innerEnd + offset };
  s.store.read = vi.fn(async () => outer);
  s.store.capturedVersion = () => 7;
  const scan = { regions: [shifted], topLevel: [], parseErrorReasons: [] };
  s.host.regions = { ...regions, scanHtmlRegions: vi.fn(({ html: input }) => {
    if (input !== outer) throw new Error("wrong scan");
    return scan;
  }), locateRegion: vi.fn(({ scan: input, handle }) => {
    if (input !== scan || handle !== "hero") throw new Error("wrong lookup");
    return { region: shifted };
  }) };
  const readTheme = vi.fn<typeof s.host.readTheme>(async () => ({ id: "theme", tokens: { color: "blue" }, tokensLight: { color: "sky" } }));
  s.host.readTheme = readTheme;
  const contributor = contributePagesTools({ host: s.host });
  expect(contributor.domain).toBe("pages");
  expect(Object.fromEntries(contributor.risk ?? [])).toEqual({
    pages_read_html: "none", pages_write_html: "mutates-durable-state",
    pages_write_region: "mutates-durable-state", pages_move_region: "mutates-durable-state",
  });
  const tool = contributor.build(s.deps, {}).find(entry => entry.descriptor.id === "pages_read_html");
  if (!tool) throw new Error("Missing contributed HTML reader");
  const whole = { id: "p", html: outer, regions: ["hero"], version: 7, theme: { id: "theme", tokens: { color: "blue" }, tokensLight: { color: "sky" } } };
  expect(await tool.handler(ctx({ id: "p" }))).toEqual(whole);
  expect(await tool.handler(ctx({ id: "p", regionId: "hero" }))).toEqual({ ...whole, html });
  expect(s.deps.authorize).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: "w", principalId: "owner", permission: "content.read", entityType: "post" }));
  expect(s.openStore.mock.calls).toEqual([
    [{ workspaceId: "w", postId: "p", actorId: "owner" }],
    [{ workspaceId: "w", postId: "p", actorId: "owner" }],
  ]);
  expect(readTheme.mock.calls).toEqual([[{ deps: s.deps }], [{ deps: s.deps }]]);
});

it.each([
  { name: "empty content", body: { content: [] }, render: false, html: "", hasDocContent: false, note: undefined },
  { name: "legacy body without content", body: {}, render: false, html: "", hasDocContent: false, note: undefined },
  { name: "rich text with renderer", body: docPage.bodyJson, render: true, html: "<p>Rendered body</p>", hasDocContent: true, note: "This rich-text (doc) page is shown here as HTML. Keep rich text for routine edits and reserve conversion for an explicit format change." },
  { name: "rich text without renderer", body: docPage.bodyJson, render: false, html: "", hasDocContent: true, note: "This page is a rich-text (doc) page with content. Keep rich text for routine edits and reserve conversion for an explicit format change." },
])("reads $name with the doc row's own write basis", async ({ body, render, html: expectedHtml, hasDocContent, note }) => {
  const s = setup();
  const findById = docFallback(s, { ...docPage, bodyJson: body });
  const renderDoc = vi.fn(() => "<p>Rendered body</p>");
  if (render) s.deps.docBodyAsPageHtml = renderDoc;
  s.host.regions = { ...regions, scanHtmlRegions: () => ({ regions: [], topLevel: [], parseErrorReasons: [] }), regionHandlesIn: () => [] };
  expect(await registration(s, "pages_read_html").handler(ctx({ id: "p" }))).toEqual({
    id: "p", html: expectedHtml, regions: [], bodyFormat: "doc", version: 4, hasDocContent, theme: null, ...(note ? { note } : {}),
  });
  expect(findById).toHaveBeenCalledExactlyOnceWith({ workspaceId: "w", id: "p" });
  expect(renderDoc.mock.calls).toEqual(render ? [[{ bodyJson: body }]] : []);
});

it.each([
  { name: "missing", row: null },
  { name: "wrong-kind", row: { ...docPage, kind: "post" as const } },
  { name: "trashed", row: { ...docPage, deletedAt: "2026-11-21T00:00:00.000Z" } },
])("does not render the body of a $name page", async ({ row }) => {
  const s = setup();
  docFallback(s, row);
  const renderer = vi.fn(() => "must not disclose content");
  s.deps.docBodyAsPageHtml = renderer;
  await expect(registration(s, "pages_read_html").handler(ctx({ id: "p" }))).rejects.toMatchObject({
    name: "ToolInputError", message: "PAGES_NOT_FOUND: No bespoke HTML. List pages with content_post_list, then pass its id.",
  });
  expect(renderer).not.toHaveBeenCalled();
});

it("fails closed when a store read did not capture any version", async () => {
  const s = setup();
  s.store.capturedVersion = () => null;
  await expect(registration(s, "pages_read_html").handler(ctx({ id: "p" }))).rejects.toThrow("the store captured no version after a successful read");
});

it.each([
  ["absent", { kind: "absent", available: ["faq", "faq", "pricing"] }, 'it has: faq, pricing. Call pages_read_html'],
  ["no handles", { kind: "absent", available: [] }, 'it has none at all. Call pages_read_html'],
  ["ambiguous", { kind: "ambiguous", count: 2 }, '2 elements in page \'p\' carry data-agent-element="hero"'],
  ["unclosed", { kind: "not-replaceable", tag: "section" }, 'has no closing tag in the stored markup'],
] as const)("refuses a %s region without replacing the whole document", async (_label, problem, message) => {
  const s = setup();
  s.host.regions = { ...regions, locateRegion: () => ({ problem }) };
  for (const id of ["pages_read_html", "pages_write_region"]) {
    await expect(registration(s, id).handler(ctx({ id: "p", regionId: "hero", html: "new", expectedVersion: 1 })))
      .rejects.toMatchObject({ name: "ToolInputError", message: expect.stringContaining(message) });
  }
  expect(s.stored()).toBe(html);
  expect(s.store.write).not.toHaveBeenCalled();
});

it.each(["pages_write_region", "pages_move_region"])("does not convert an unauthored doc through %s", async id => {
  const s = setup();
  docFallback(s);
  s.store.ensureHtmlFormat = vi.fn();
  await expect(registration(s, id).handler(ctx({ id: "p", regionId: "hero", html: "new", after: "faq", expectedVersion: 1 })))
    .resolves.toEqual({ written: false, reason: expect.stringMatching(/'p' has no bespoke HTML body.*pages_write_html first/) });
  expect(s.store.ensureHtmlFormat).not.toHaveBeenCalled();
  expect(s.store.write).not.toHaveBeenCalled();
});

it.each(["pages_read_html", "pages_write_html", "pages_write_region", "pages_move_region"])("%s does not disguise an infrastructure read failure", async id => {
  const s = setup();
  const failure = new Error("connection dropped");
  s.store.read = vi.fn().mockRejectedValue(failure);
  await expect(registration(s, id).handler(ctx({ id: "p", regionId: "hero", html, after: "faq", expectedVersion: 1 }))).rejects.toBe(failure);
  expect(s.store.write).not.toHaveBeenCalled();
});

it.each(["pages_write_html", "pages_write_region"])("%s refuses newly ambiguous handles before changing the stored body", async id => {
  const s = setup();
  s.host.regions = { ...regions, handlesMadeAmbiguous: () => ["hero", "faq"] };
  await expect(registration(s, id).handler(ctx({ id: "p", regionId: "hero", html: "new", expectedVersion: 1 })))
    .resolves.toEqual({ written: false, reason: expect.stringContaining('data-agent-element="hero", "faq"') });
  expect(s.stored()).toBe(html);
  expect(s.store.write).not.toHaveBeenCalled();
});

it("reports the handles and warnings of the saved region and attributes the Undo record", async () => {
  const s = setup();
  const updated = '<section data-agent-element="hero"><h2>New</h2></section>';
  const before = { regions: [region, { ...region, handle: "nested" }], topLevel: [], parseErrorReasons: [] };
  const after = { regions: [{ ...region, problem: "hero is unsafe" }], documentProblem: "orphaned handle", topLevel: [], parseErrorReasons: [] };
  const scan = vi.fn<PageHtmlRegionPorts["scanHtmlRegions"]>(({ html: value }) => {
    if (value === html) return before;
    if (value === updated) return after;
    throw new Error(`Unexpected scan: ${value}`);
  });
  s.host.regions = { ...regions, scanHtmlRegions: scan, regionHandlesIn: ({ scan: current }) => current.regions.map(item => item.handle) };
  s.store.embedWarnings = () => [{ code: "embed", message: "An embed was not indexed." }];
  const input = ctx({ id: "p", regionId: "hero", html: "<h2>New</h2>", expectedVersion: 1 });
  const originalRecorder = s.host.recordWrite({ deps: s.deps });
  s.host.recordWrite = () => async request => {
    expect({ ...request, write: undefined }).toEqual({
      target: { workspaceId: "w", pageId: "p", actorId: "owner", executionId: "e" }, operation: "pages_write_region",
      expectedVersion: 1, signal: input.signal, write: undefined,
    });
    return originalRecorder(request);
  };
  expect(await registration(s, "pages_write_region").handler(input)).toEqual({
    written: true, id: "p", handle: "hero", regions: ["hero"], version: 2, changeSetId: "undo",
    warning: "Written, but pages_write_region and pages_move_region will refuse these until the markup is repaired: hero is unsafe; orphaned handle An embed was not indexed.",
  });
  expect(s.stored()).toBe(updated);
});

it.each([
  { name: "no placement", placement: {} },
  { name: "two placements", placement: { before: "faq", after: "faq" } },
])("rejects a region move with $name before opening the store", async ({ placement }) => {
  const s = setup();
  await expect(registration(s, "pages_move_region").handler(ctx({ id: "p", regionId: "hero", expectedVersion: 1, ...placement })))
    .rejects.toMatchObject({ name: "ToolInputError", message: expect.stringContaining("Send exactly one of 'before' or 'after'") });
  expect(s.openStore).not.toHaveBeenCalled();
});

it.each([
  ["self", "hero", "cannot be placed before itself"],
  ["into-itself", "nested", "'nested' is inside 'hero'"],
  ["unchanged", "faq", "'hero' already sits immediately before 'faq'. Current order: hero, faq."],
] as const)("does not write when a move is %s", async (problem, target, message) => {
  const s = setup();
  s.host.regions = { ...regions,
    locateRegion: ({ handle }) => ({ region: { ...region, handle } }),
    regionHandlesIn: () => ["hero", "faq"],
    moveRegion: () => problem === "unchanged" ? { html } : { problem },
  };
  expect(await registration(s, "pages_move_region").handler(ctx({ id: "p", regionId: "hero", before: target, expectedVersion: 1 })))
    .toEqual({ written: false, reason: expect.stringContaining(message) });
  expect(s.store.write).not.toHaveBeenCalled();
});

it("saves a moved region's whole markup and reports the new order", async () => {
  const faq = '<section data-agent-element="faq">Questions</section>';
  const s = setup(1, html + faq);
  const reordered = faq + html;
  const faqRegion = { handle: "faq", tag: "section", start: html.length, end: html.length + faq.length,
    innerStart: html.length + faq.indexOf(">") + 1, innerEnd: html.length + faq.lastIndexOf("<") };
  const moveRegion = vi.fn<PageHtmlRegionPorts["moveRegion"]>(() => ({ html: reordered }));
  s.host.regions = { ...regions, moveRegion,
    locateRegion: ({ handle }) => ({ region: handle === "hero" ? region : faqRegion }),
    scanHtmlRegions: ({ html: value }) => ({ regions: value === reordered ? [faqRegion, region] : [region, faqRegion], topLevel: [], parseErrorReasons: [] }),
    regionHandlesIn: ({ scan }) => scan.regions.map(item => item.handle),
  };
  const tool = registration(s, "pages_move_region");
  expect(await tool.handler(ctx({ id: "p", regionId: "hero", after: "faq", expectedVersion: 1 })))
    .toEqual({ written: true, id: "p", handle: "hero", regions: ["faq", "hero"], version: 2, changeSetId: "undo" });
  expect(moveRegion).toHaveBeenCalledExactlyOnceWith({ html: html + faq, moving: region, target: faqRegion, placement: "after" });
  expect(s.stored()).toBe(reordered);
});

it("turns a move's late CAS failure into a reread instruction without saving", async () => {
  const s = setup();
  s.host.regions = { ...regions, moveRegion: () => ({ html: "<p>moved</p>" }) };
  const record = s.host.recordWrite({ deps: s.deps });
  s.host.recordWrite = () => async request => { s.advance(); return record(request); };
  await expect(registration(s, "pages_move_region").handler(ctx({ id: "p", regionId: "hero", after: "faq", expectedVersion: 1 })))
    .rejects.toMatchObject({ name: "ToolInputError", message: "VERSION_CONFLICT: stale. Nothing was written. Re-read the page with pages_read_html, reapply your change to the body you get back, and resend." });
  expect(s.stored()).toBe(html);
});

it("refuses a stale conversion and passes the matched doc version to the converter on retry", async () => {
  const s = setup(4);
  const read = vi.mocked(s.store.read);
  read.mockRejectedValue(new PageNotFoundError("Doc page"));
  s.deps.postRepo.findById = async () => docPage;
  const convert = vi.fn<PagesHtmlDocumentStorePort["ensureHtmlFormat"]>(async ({ seedHtml }) => { await s.store.write({ html: seedHtml }); });
  s.store.ensureHtmlFormat = convert;
  const tool = registration(s, "pages_write_html");
  const proposed = '<section data-agent-element="hero">replacement</section>';
  await expect(tool.handler(ctx({ id: "p", html: proposed, expectedVersion: 3 })))
    .rejects.toMatchObject({ name: "ToolInputError", message: expect.stringContaining("page 'p' is at version 4, not the version 3") });
  expect(convert).not.toHaveBeenCalled();
  expect(s.stored()).toBe(html);
  expect(await tool.handler(ctx({ id: "p", html: proposed, expectedVersion: 4 })))
    .toEqual({ written: true, id: "p", regions: ["hero"], version: 5, changeSetId: "undo" });
  expect(convert).toHaveBeenCalledExactlyOnceWith({ seedHtml: proposed, expectedVersion: 4 });
  expect(s.stored()).toBe(proposed);
});

it("reports the kind mismatch on full writes with the rich-text alternative", async () => {
  const s = setup();
  docFallback(s, { ...docPage, kind: "post" });
  s.store.ensureHtmlFormat = vi.fn().mockRejectedValue(new PageKindMismatchError("post"));
  expect(await registration(s, "pages_write_html").handler(ctx({ id: "p", html, expectedVersion: 4 })))
    .toEqual({ written: false, reason: expect.stringContaining("'p' is a post, not a page. Posts are edited as rich-text documents through content_post_update") });
  expect(s.store.write).not.toHaveBeenCalled();
});

it("describes untagged sections before opening a store, suggesting only content-derived handles", async () => {
  const s = setup();
  const markup = "<section><h2>New Pricing</h2></section><article>details</article>";
  s.host.regions = { ...regions, untaggedTopLevelSections: ({ html: source }, { slugify }) => {
    if (source !== markup) throw new Error("wrong markup");
    return [{ tag: "section", suggestedHandle: slugify("New Pricing") }, { tag: "article", suggestedHandle: undefined }];
  } };
  await expect(registration(s, "pages_write_html").handler(ctx({ id: "p", html: markup, expectedVersion: 1 })))
    .rejects.toMatchObject({ name: "ToolInputError", message: expect.stringContaining('2 top-level element(s) carry no data-agent-element handle: <section> (suggested handle: "new-pricing"); <article> (pick a short, content-derived handle for it)') });
  expect(s.openStore).not.toHaveBeenCalled();
});

it("normalizes legacy selectors without changing their handles or unrelated tool input", async () => {
  const s = setup();
  const read = registration(s, "pages_read_html");
  const write = registration(s, "pages_write_region");
  const fullWrite = registration(s, "pages_write_html");
  if (!read.normalizeInput || !write.normalizeInput || !fullWrite.normalizeInput) throw new Error("Missing page tool normalizer");
  const legacy = { id: "p", handle: "Case:SENSITIVE/Legacy" };
  const normalized = await read.normalizeInput({ input: legacy });
  expect(normalized).toEqual({ input: { id: "p", regionId: "Case:SENSITIVE/Legacy" }, notes: ["handle→regionId"] });
  expect(legacy).toEqual({ id: "p", handle: "Case:SENSITIVE/Legacy" });
  expect(await write.normalizeInput({ input: { region: "legacy", html: "body" } }))
    .toEqual({ input: { html: "body", regionId: "legacy" }, notes: ["region→regionId"] });
  expect(await fullWrite.normalizeInput({ input: legacy })).toEqual({ input: legacy, notes: [] });
  expect(await read.normalizeInput({ input: { id: "p" } })).toEqual({ input: { id: "p" }, notes: [] });
  expect(await write.normalizeInput({ input: { regionId: "hero" } })).toEqual({ input: { regionId: "hero" }, notes: [] });
  expect(() => read.normalizeInput!({ input: { regionId: "same", handle: "same" } })).toThrow("regionId, handle and region name the same target. Send only regionId.");
  expect(() => write.normalizeInput!({ input: { id: "p" } })).toThrow(ToolInputError);
  expect(() => write.normalizeInput!({ input: { id: "p" } })).toThrow("'regionId' (non-empty string) is required; received: id");
});

it("returns no Undo handle when a region edit is byte-identical", async () => {
  const s = setup();
  const scan = vi.fn(regions.scanHtmlRegions);
  s.host.regions = { ...regions, scanHtmlRegions: scan };
  expect(await registration(s, "pages_write_region").handler(ctx({ id: "p", regionId: "hero", html: "old", expectedVersion: 1 })))
    .toEqual({ written: true, id: "p", handle: "hero", regions: ["hero"], version: 1 });
  expect(s.stored()).toBe(html);
  expect(scan).toHaveBeenCalledExactlyOnceWith({ html });
});

it("classifies conversion of a missing page as not-found instead of claiming an HTML write", async () => {
  const s = setup();
  const findById = docFallback(s, null);
  const convert = vi.fn().mockRejectedValue(new PageNotFoundError("page 'p' was not found"));
  s.store.ensureHtmlFormat = convert;
  await expect(registration(s, "pages_write_html").handler(ctx({ id: "p", html, expectedVersion: 1 })))
    .rejects.toMatchObject({ name: "ToolInputError", message: "PAGES_NOT_FOUND: page 'p' was not found. List pages with content_post_list, then pass its id." });
  expect(findById).toHaveBeenCalledExactlyOnceWith({ workspaceId: "w", id: "p" });
  expect(convert).toHaveBeenCalledExactlyOnceWith({ seedHtml: html, expectedVersion: 1 });
  expect(s.store.write).not.toHaveBeenCalled();
});
