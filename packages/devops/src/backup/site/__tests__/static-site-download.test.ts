import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { escapeHtml } from "@jini-ai/core/text";
import { describe, it } from "vitest";
import { exportUrlLocations } from "../../../static-export/html-url-locations.js";
import { extractHtmlReferences, outputFileForUrl } from "../../../static-export/transforms.js";
import { SiteShareRefusal } from "../share-refusal.js";
import type { DownloadHtmlSourceEdits, Edit } from "../static-download-html.js";
import { captureStaticSite, prepareStaticReport, type ExportReport, type StaticCopyHost } from "../static-copy.js";
import { landingPages } from "../static-download-landing.js";
import { staticDownloadLayout, type StaticDownloadHost } from "../static-download-layout.js";
import { createStaticSitePackager } from "../static-site-packager.js";

type ParsedElement = DefaultTreeAdapterMap["element"];

/** Counts calls so a test proves the injected seam, not a built-in copy, did the work. */
function countingEdits(): { edits: DownloadHtmlSourceEdits; calls: () => number } {
  let calls = 0;
  const edits: DownloadHtmlSourceEdits = {
    elements({ html }) {
      calls++;
      const pending: DefaultTreeAdapterMap["node"][] = [parse(html, { sourceCodeLocationInfo: true })];
      const found: ParsedElement[] = [];
      while (pending.length) {
        const node = pending.pop()!;
        if ("childNodes" in node) pending.push(...node.childNodes);
        if ("tagName" in node) found.push(node);
        if ("content" in node) pending.push(node.content);
      }
      return found;
    },
    attribute: ({ node, name }) => (node as ParsedElement).attrs.find(attr => attr.name === name)?.value,
    escapeHtml: ({ text }) => escapeHtml({ text }),
    editedHtml({ html, edits }) {
      const parts: string[] = [];
      let end = html.length;
      for (const edit of [...edits].sort((a: Edit, b: Edit) => b.startOffset - a.startOffset)) { parts.push(html.slice(edit.endOffset, end), edit.text); end = edit.startOffset; }
      parts.push(html.slice(0, end));
      return parts.reverse().join("");
    },
  };
  return { edits, calls: () => calls };
}

function report(files: { path: string; data: string }[] = [{ path: "index.html", data: "<html><head><title>Home | Demo</title></head><body>hi</body></html>" }]): ExportReport {
  return { outputDir: "/unused", routes: { succeeded: files.map(file => ({ path: "/", kind: "home", outputFile: file.path, data: file.data })), failed: [] },
    assets: { succeeded: [], failed: [] }, skippedManifestEntries: [], unreferencedThemeFiles: [], droppedReferences: [] } as unknown as ExportReport;
}

function layoutHost(over: Partial<StaticDownloadHost> = {}): StaticDownloadHost {
  return { sourceEdits: countingEdits().edits, validateSharePath: () => undefined, sharePathAlias: ({ path }) => path.toLowerCase(),
    allocateThemes: ({ themeIds }) => themeIds.map(themeId => ({ themeId, name: `folder-${themeId}` })) as never,
    checkShareLimits: () => undefined, extractPlainText: ({ html }) => html,
    renderLanding: input => Buffer.from(JSON.stringify(input)),
    exportUrlLocations, extractHtmlReferences, outputFileForUrl, ...over };
}

const copy = (files: { path: string; content: Buffer }[]) => ({ files, siteSlug: "demo", themeId: "t1" });
const page = (path: string, title = "T") => ({ path, content: Buffer.from(`<html><head><title>${title}</title></head><body></body></html>`) });

describe("landingPages", () => {
  it("decodes titles through the injected extractor", () => {
    const pages = landingPages({ files: [page("sites/a/index.html", "Raw")], folder: "a", skip: new Set(), extractPlainText: ({ html }) => `decoded:${html}` });
    assert.equal(pages[0]!.title, "decoded:Raw");
  });
});

describe("prepareStaticReport", () => {
  it("rewrites HTML through the injected source edits", () => {
    const { edits, calls } = countingEdits();
    prepareStaticReport({ report: report(), sourceEdits: edits });
    assert.ok(calls() > 0);
  });
});

describe("captureStaticSite", () => {
  const ports = (seen: { dir?: string }) => ({ now: () => new Date("2026-01-02T03:04:05Z"), context: async () => ({ name: "My Site!", slug: "my", theme: "Th", timeZone: "UTC" }),
    render: async ({ outputDir }: { outputDir: string }) => { seen.dir = outputDir; return report(); } });
  const host = (over: Partial<StaticCopyHost> = {}): StaticCopyHost => ({ sourceEdits: countingEdits().edits, fileStem: () => "STEM", tempPrefix: "scratch-xyz-", ...over });

  it("names the file from the injected stem rule and the scratch folder from the injected prefix, then removes it", async () => {
    const seen: { dir?: string } = {};
    const result = await captureStaticSite({ ports: ports(seen), host: host() });
    assert.ok("filename" in result && result.filename === "STEM-static-2026-01-02-0304.zip");
    assert.ok(seen.dir && seen.dir.split("/").pop()!.startsWith("scratch-xyz-"));
    await assert.rejects(access(seen.dir!));
    assert.ok(!(await readdir(seen.dir!.slice(0, seen.dir!.lastIndexOf("/")))).some(name => name === seen.dir!.split("/").pop()));
  });

  it("renders into an injected host-owned temp root and finishes reading before the scope settles", async () => {
    const seen: { dir?: string } = {};
    const events: string[] = [];
    const owned = await mkdtemp(path.join(tmpdir(), "owned-root-"));
    const tempRoot = async <T>({ work }: { work: (o: { root: string }) => Promise<T> }): Promise<T> => {
      events.push("lock");
      try { return await work({ root: owned }); } finally { events.push("release"); await rm(owned, { recursive: true, force: true }); }
    };
    const result = await captureStaticSite({ ports: ports(seen), host: host() }, { tempRoot });
    assert.ok("filename" in result && result.filename === "STEM-static-2026-01-02-0304.zip");
    assert.equal(seen.dir, owned);
    assert.deepEqual(events, ["lock", "release"]);
  });

  it("refuses in plain words when the injected temp root cannot be prepared", async () => {
    const tempRoot = async (): Promise<never> => { throw new Error("lock busy"); };
    const result = await captureStaticSite({ ports: ports({}), host: host() }, { tempRoot });
    assert.deepEqual(result, { reason: "Static render folder could not be prepared: Error: lock busy" });
  });
});

describe("staticDownloadLayout", () => {
  it("allocates theme folders through the injected allocator", () => {
    const files = staticDownloadLayout({ copy: copy([page("index.html")]), host: layoutHost() });
    assert.ok(files.some(file => file.path === "sites/folder-t1/index.html"));
  });
  it("resolves content-route links through the injected URL parsers", () => {
    const home = { path: "index.html", content: Buffer.from('<html><head><title>T</title></head><body><a href="/about/">A</a></body></html>') };
    const files = staticDownloadLayout({ copy: copy([home, page("about/index.html")]), host: layoutHost() });
    assert.match(files.find(file => file.path === "sites/folder-t1/index.html")!.content.toString(), /href="about\/index\.html"/);
  });
  it("validates every source path through the injected policy", () => {
    const seen: string[] = [];
    staticDownloadLayout({ copy: copy([page("index.html"), page("about/index.html")]), host: layoutHost({ validateSharePath: ({ path }) => { seen.push(path); } }) });
    assert.deepEqual(seen, ["index.html", "about/index.html"]);
  });
  it("lets an injected policy refuse a path", () => {
    const refuse = () => { throw new SiteShareRefusal({ code: "UNSAFE", message: "no" }); };
    assert.throws(() => staticDownloadLayout({ copy: copy([page("index.html")]), host: layoutHost({ validateSharePath: refuse }) }), SiteShareRefusal);
  });
  it("de-duplicates destinations by the injected alias", () => {
    const files = staticDownloadLayout({ copy: copy([{ path: "a.css", content: Buffer.from("x") }, { path: "A.css", content: Buffer.from("y") }, page("index.html")]), host: layoutHost() });
    const names = files.map(file => file.path);
    assert.ok(names.includes("sites/folder-t1/a.css") && names.includes("sites/folder-t1/A-2.css"), names.join(","));
  });
  it("meters output through the injected limit check", () => {
    const sizes: number[] = [];
    staticDownloadLayout({ copy: copy([page("index.html")]), host: layoutHost({ checkShareLimits: ({ totalBytes }) => { sizes.push(totalBytes ?? 0); } }) });
    assert.ok(sizes.length >= 2 && sizes[sizes.length - 1]! > sizes[0]!);
  });
  it("lists landing titles through the injected extractor", () => {
    const files = staticDownloadLayout({ copy: copy([page("index.html", "Hello")]), host: layoutHost({ extractPlainText: () => "EXTRACTED" }) });
    assert.match(files.find(file => file.path === "index.html")!.content.toString(), /EXTRACTED/);
  });
  it("renders the root landing page only through the injected renderer", () => {
    const seen: unknown[] = [];
    const files = staticDownloadLayout({ copy: copy([page("index.html", "Hello")]),
      host: layoutHost({ renderLanding: input => { seen.push(input); return Buffer.from("HOST LANDING"); } }) });
    assert.equal(files.find(file => file.path === "index.html")!.content.toString(), "HOST LANDING");
    assert.deepEqual(seen, [{ siteName: "demo", exportedWords: undefined,
      themes: [{ title: "folder-t1", folder: "folder-t1", active: true, pages: [{ href: "sites/folder-t1/index.html", label: "/", title: "Hello" }] }] }]);
  });
});

describe("createStaticSitePackager", () => {
  const site = { name: "Demo", slug: "demo", theme: "Th", themeId: "t1" } as const;
  it("claims destinations through the injected claim, without a manifest", () => {
    const seen: unknown[] = [];
    const packager = createStaticSitePackager({ host: layoutHost(), claimArchivePaths: (_entries, options) => { seen.push(options); } });
    const result = packager.packageSite({ report: report(), site });
    assert.ok(result.ok);
    assert.deepEqual(seen, [{ manifest: false }]);
    assert.equal(packager.entryFile, "index.html");
  });
  it("turns a collision refusal into a result and rethrows anything else", () => {
    const fail = (error: Error) => createStaticSitePackager({ host: layoutHost(), claimArchivePaths: () => { throw error; } }).packageSite({ report: report(), site });
    const result = fail(new SiteShareRefusal({ code: "X", message: "path collision" }));
    assert.ok(!result.ok && result.kind === "destination-collision");
    assert.throws(() => fail(new SiteShareRefusal({ code: "X", message: "too big" })), SiteShareRefusal);
  });
});
