import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { escapeHtml } from "@jini-ai/core/text";
import { describe, it } from "vitest";
import { exportUrlLocations } from "../../../static-export/html-url-locations.js";
import { extractHtmlReferences, outputFileForUrl } from "../../../static-export/transforms.js";
import { SiteShareRefusal } from "../share-refusal.js";
import type { DownloadHtmlSourceEdits, Edit } from "../static-download-html.js";
import { captureStaticSite, prepareStaticReport, readmeText, type ExportReport, type StaticCopyHost } from "../static-copy.js";
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

  it("passes the selected theme and public URL to the renderer and dates the download in the site's zone", async () => {
    const seen: { outputDir: string; clean: boolean; themeId?: string; publicUrl?: string }[] = [];
    const result = await captureStaticSite({
      ports: {
        context: async () => ({ name: "Museum", slug: "museum", theme: "Gallery", themeId: "gallery", timeZone: "America/Los_Angeles" }),
        now: () => new Date("2026-01-02T03:04:05Z"),
        render: async ({ themeId, publicUrl, ...args }) => {
          seen.push({ ...args, ...(themeId === undefined ? {} : { themeId }), ...(publicUrl === undefined ? {} : { publicUrl }) });
          return { ...report(), publicOrigin: "https://museum.example", basePath: "/gallery" };
        },
      }, host: host(),
    }, { themeId: "gallery", publicUrl: "https://museum.example/gallery" });

    if ("reason" in result) throw new Error(result.reason);
    assert.deepEqual(seen.map(({ outputDir: _dir, ...call }) => call), [
      { clean: true, themeId: "gallery", publicUrl: "https://museum.example/gallery" },
    ]);
    assert.equal(result.filename, "STEM-static-2026-01-01-1904.zip");
    assert.equal(result.metadata.exportedAt, "2026-01-01T19:04:05-08:00");
    assert.equal(result.publicOrigin, "https://museum.example");
    assert.equal(result.basePath, "/gallery");
    assert.equal(result.files.find(file => file.path === "README.txt")?.content.toString().includes("No public domain is set"), false);
    await assert.rejects(access(seen[0]!.outputDir), { code: "ENOENT" });
  });

  it("does not present an error-document-only render as a downloadable site", async () => {
    const seen: { dir?: string } = {};
    const result = await captureStaticSite({
      ports: { ...ports(seen), render: async ({ outputDir }) => {
        seen.dir = outputDir;
        return report([{ path: "404.html", data: "<title>Not found</title>" }]);
      } }, host: host(),
    });
    assert.deepEqual(result, { reason: "The exporter produced no HTML pages." });
    if (seen.dir === undefined) throw new Error("Renderer never received a scratch directory");
    await assert.rejects(access(seen.dir), { code: "ENOENT" });
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

it("keeps usable partial pages after rendering throws, skips symlinks, and removes its scratch folder", async () => {
  const outside = await mkdtemp(path.join(tmpdir(), "partial-asset-"));
  try {
    const file = path.join(outside, "not-for-export.html");
    await writeFile(file, "outside fixture bytes");
    let output: string | undefined;
    const result = await captureStaticSite({
      ports: { now: () => new Date("2026-01-02T03:04:05Z"), context: async () => ({ name: "Demo", slug: "demo", theme: "Gallery", timeZone: "UTC" }),
        render: async ({ outputDir }) => {
          output = outputDir;
          await writeFile(path.join(outputDir, "index.html"), "<title>Partial</title><a href='/signin'>Sign in</a>");
          await symlink(file, path.join(outputDir, "linked.html"));
          throw new Error("renderer disconnected");
        },
      },
      host: { sourceEdits: countingEdits().edits, tempPrefix: "partial-copy-", fileStem: () => "demo" },
    });
    if ("reason" in result) throw new Error(result.reason);
    assert.deepEqual(result.files.map(item => item.path).sort(), ["README.txt", "index.html"]);
    assert.equal(result.files.find(item => item.path === "index.html")!.content.toString(), "<title>Partial</title><a href='/signin'>Sign in</a>");
    assert.deepEqual(result.metadata.failed.routes, [{ path: "(export)", kind: "export", reason: "Error: renderer disconnected" }]);
    assert.deepEqual(result.metadata.skipped.references, [{ page: "/", url: "/signin", attribute: "href", reason: "needs-server" }]);
    assert.match(result.files.find(item => item.path === "README.txt")!.content.toString(), /Needs a server \(does not work in this copy\): Sign in on \//);
    if (!output) throw new Error("Renderer did not receive a scratch folder");
    await assert.rejects(access(output), { code: "ENOENT" });
  } finally { await rm(outside, { recursive: true, force: true }); }
});

it("describes missing pages and assets without disclosing a private media URL or counting redirects", () => {
  const data = report();
  const assetFailure = { reason: "access refused" };
  const readme = readmeText({
    name: "Museum", metadata: { theme: "Gallery", routes: ["/"], redirectFiles: ["redirect/index.html"],
      failed: { routes: [{ path: "/news", kind: "page", reason: "renderer failed" }],
        assets: [{ ...assetFailure, url: "/m/private-document-id" }, { ...assetFailure, url: "/assets/theme.css" }] },
      skipped: { routes: data.skippedManifestEntries, assets: [], references: [
        { page: "/", url: "/forms/contact/submit", attribute: "action", reason: "needs-server" },
        { page: "/", url: "/forms/survey/submit", attribute: "action", reason: "needs-server" },
      ] },
    }, rendered: { publicOrigin: "https://museum.example", files: ["index.html", "404.html", "redirect/index.html", "image.png", "video.webm"].map(path => ({ path })) },
  }).toString().split("\n");
  assert.ok(readme.includes("Contains: 1 pages and posts, 1 image, 1 video."));
  assert.ok(readme.includes("Not included: Page /news could not be rendered."));
  assert.ok(readme.includes("Not included: A media file could not be copied."));
  assert.ok(readme.includes("Not included: File /assets/theme.css could not be copied."));
  assert.ok(readme.includes("Needs a server (does not work in this copy): Contact form on /."));
  assert.ok(readme.includes("Needs a server (does not work in this copy): Form on /."));
  assert.equal(readme.some(line => line.includes("private-document-id") || line.includes("No public domain")), false);
});

it("rewrites CSS, srcset, manifest and discovery links against deduplicated media and portable theme paths", () => {
  const entry = (path: string, text: string) => ({ path, content: Buffer.from(text) });
  const first = copy([
    entry("index.html", '<link rel="stylesheet" href="/theme-assets/t1/styles/site.css"><link rel="manifest" href="/theme-assets/t1/app.webmanifest"><img srcset="/m/photo/public.webp 1x, https://cdn.example/photo.webp 2x">'),
    entry("theme-assets/t1/styles/site.css", 'body { background: url("/m/photo/public.webp"); }'),
    entry("theme-assets/t1/app.webmanifest", '{"start_url":"/","icons":[{"src":"/theme-assets/t1/favicon.ico"}]}'),
    entry("theme-assets/t1/favicon.ico", "icon"),
    entry("theme-assets/t1/fonts/logo.woff2", "font"),
    entry("theme-assets/t1/scripts/main.js", "script"),
    entry("theme-assets/t1/assets/hero.png", "theme image"),
    entry("llms.txt", "- [Home](/)\n"),
    entry("m/photo/public.webp", "first media"),
    entry("m/unreferenced/public.webp", "never reached"),
    entry("robots.txt", ""),
  ]);
  const second = { ...copy([entry("index.html", '<img src="/m/photo/public.webp">'), entry("m/photo/public.webp", "later media")]), themeId: "t2" };
  const files = new Map(staticDownloadLayout({ copy: first, copies: [first, second], host: layoutHost() }).map(file => [file.path, file.content.toString()]));

  assert.deepEqual([...files.keys()].filter(name => name.startsWith("media/")), ["media/photo.webp"]);
  assert.equal(files.get("media/photo.webp"), "first media");
  assert.match(files.get("sites/folder-t1/index.html")!, /srcset="\.\.\/\.\.\/media\/photo\.webp 1x, https:\/\/cdn\.example\/photo\.webp 2x"/);
  assert.equal(files.get("sites/folder-t2/index.html"), '<img src="../../media/photo.webp">');
  assert.equal(files.get("sites/folder-t1/css/site.css"), 'body { background: url("../../../media/photo.webp"); }');
  assert.deepEqual(JSON.parse(files.get("sites/folder-t1/app.webmanifest")!), { start_url: "index.html", icons: [{ src: "icons/favicon.ico" }] });
  assert.equal(files.get("sites/folder-t1/icons/favicon.ico"), "icon");
  assert.equal(files.get("sites/folder-t1/fonts/logo.woff2"), "font");
  assert.equal(files.get("sites/folder-t1/js/main.js"), "script");
  assert.equal(files.get("sites/folder-t1/images/hero.png"), "theme image");
  assert.equal(files.get("sites/folder-t1/llms.txt"), "- [Home](index.html)\n");
  assert.equal(files.get("sites/folder-t1/robots.txt"), "User-agent: *\nAllow: /\n");
  assert.equal(first.files.find(file => file.path === "m/photo/public.webp")?.content.toString(), "first media");
  assert.equal(second.files.find(file => file.path === "m/photo/public.webp")?.content.toString(), "later media");
});

it("removes the entire srcset candidate when its local media was not exported", () => {
  const files = staticDownloadLayout({
    copy: copy([
      { path: "index.html", content: Buffer.from('<img srcset="/m/photo/public.webp 1x, /m/unavailable/public.webp 2x">') },
      { path: "m/photo/public.webp", content: Buffer.from("public image") },
    ]),
    host: layoutHost(),
  });
  const html = files.find(file => file.path === "sites/folder-t1/index.html")!.content.toString();
  const { edits } = countingEdits();
  const image = edits.elements({ html }).find(node => node.tagName === "img");
  if (image === undefined) throw new Error("Packaged page lost its image");
  assert.equal(edits.attribute({ node: image, name: "srcset" }), "../../media/photo.webp 1x");
  assert.deepEqual([...extractHtmlReferences({ html })], [{ url: "../../media/photo.webp", attribute: "srcset" }]);
});
