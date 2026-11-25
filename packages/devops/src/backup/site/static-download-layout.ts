import path from "node:path";
import { downloadDocumentBase, type DownloadHtmlSourceEdits } from "./static-download-html.js";
import type { StaticExportTheme } from "./static-export-selection.js";
import { readmeText, type StaticSiteMetadata } from "./static-copy.js";
import { LANDING_FILE, landingPages, type ExtractPlainText, type LandingRenderer, type LandingTheme } from "./static-download-landing.js";

/** One URL range found in a rendered body (start/end index the original spelling). */
export interface StaticUrlLocation { start: number; end: number; kind: string; identity?: boolean | undefined }

/** The static-export URL parsers the layout drives, injected so the backup domain never imports the
 *  static-export implementation (pass the `@jini-ai/devops/static-export` functions of the same names). */
export interface StaticUrlParsing {
  /** Every URL range in a body of the given content type. */
  exportUrlLocations: (required: { body: string; contentType: string }) => readonly StaticUrlLocation[];
  /** Every URL candidate in an HTML fragment (srcset descriptors and data URLs included). */
  extractHtmlReferences: (required: { html: string }) => Iterable<{ url: string }>;
  /** The output file a root-relative URL maps to; throws on a URL that resolves outside the output directory. */
  outputFileForUrl: (required: { url: string }, optional?: { contentRoute?: boolean }) => string;
}

/** Host values the portable layout cannot own: the parse5 source edits, the share path policy, the share size limits,
 *  the theme-folder allocator, the HTML-to-text decoder used for landing titles, the landing-page renderer (the
 *  host's exported HTML) and the static-export URL parsers. */
export interface StaticDownloadHost extends StaticUrlParsing {
  sourceEdits: DownloadHtmlSourceEdits;
  validateSharePath: (required: { path: string }) => void;
  sharePathAlias: (required: { path: string }) => string;
  allocateThemes: (required: { themeIds: readonly string[]; siteSlug: string }) => StaticExportTheme[];
  checkShareLimits: (required: { files: readonly { path: string; bytes: number }[]; totalBytes?: number | undefined }) => void;
  extractPlainText: ExtractPlainText;
  renderLanding: LandingRenderer;
}

/** Portable packaging consumes rendered files and real site/theme context, without backup metadata. */
export interface StaticDownloadCopy {
  files: readonly { path: string; content: Buffer }[];
  siteSlug?: string | undefined;
  themeId?: string | undefined;
  publicOrigin?: string | undefined;
  /** Serving prefix the export was rendered under; stripped before ZIP file lookup. */
  basePath?: string | undefined;
  metadata?: (Omit<StaticSiteMetadata, "exportedAt"> & { exportedAt?: string | undefined }) | undefined;
  readme?: { name: string; words?: string | undefined };
}
type Copy = StaticDownloadCopy;
type File = Copy["files"][number];
type RewriteUrl = (required: { value: string }, optional?: Record<string, never>) => string;
const LOCAL_ORIGIN = "https://static-copy.invalid";

/** Resolve local references against their original file; foreign URLs and fragments stay intact. */
function localUrl({ value, file, publicOrigin, basePath }: { value: string; file: string; publicOrigin?: string | undefined; basePath?: string | undefined }, _options = {}): URL | undefined {
  if (!value || value.startsWith("#") || value.startsWith("//")) return undefined;
  try {
    const origin = publicOrigin ?? LOCAL_ORIGIN;
    const url = new URL(value, `${origin}/${file}`);
    return url.origin === origin ? withoutExportPrefix({ url, basePath }) : undefined;
  } catch { return undefined; }
}

/** This freshly parsed URL names an exported file. Strip its serving prefix before file lookup;
 * the ZIP's page map is rooted at the artifact, while canonical/feed URLs retain their public base.
 */
function withoutExportPrefix({ url, basePath }: { url: URL; basePath?: string | undefined }, _options = {}): URL {
  const prefix = basePath?.replace(/\/$/, "");
  if (prefix && (url.pathname === prefix || url.pathname.startsWith(prefix + "/"))) url.pathname = url.pathname.slice(prefix.length) || "/";
  return url;
}

/** Reuse the exporter's candidate parser, including data URLs and descriptors. O(srcset bytes). */
function rewriteSrcset({ value, rewrite, parsing }: { value: string; rewrite: RewriteUrl; parsing: StaticUrlParsing }, _options = {}): string {
  // Ranges contain the original HTML spelling; protect the wrapper quote without double-escaping &amp;.
  const refs = parsing.extractHtmlReferences({ html: `<img srcset="${value.replaceAll('"', "&quot;")}">` });
  let cursor = 0;
  const parts: string[] = [];
  for (const { url } of refs) {
    const start = value.indexOf(url, cursor);
    if (start < 0) continue;
    parts.push(value.slice(cursor, start), rewrite({ value: url }));
    cursor = start + url.length;
  }
  return parts.join("") + value.slice(cursor);
}

/** Jini supplies linear CSS token ranges; only the URL inside each token changes. */
function rewriteCss({ body, rewrite, parsing }: { body: string; rewrite: RewriteUrl; parsing: StaticUrlParsing }, _options = {}): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const { start, end } of parsing.exportUrlLocations({ body, contentType: "text/css" })) {
    const inner = body.slice(start + 4, end - 1).trim();
    const quote = /^["']/.test(inner) ? inner[0] : "";
    const value = quote ? inner.slice(1, -1) : inner;
    parts.push(body.slice(cursor, start), `url(${quote}${rewrite({ value })}${quote})`);
    cursor = end;
  }
  return parts.join("") + body.slice(cursor);
}

/** HTML edits use parser-backed source ranges, preserving theme scripts and surrounding bytes. */
function rewriteHtml({ body, rewrite, host }: { body: string; rewrite: RewriteUrl; host: StaticDownloadHost }, _options = {}): string {
  body = downloadDocumentBase({ html: body, rewrite: value => rewrite({ value }), sourceEdits: host.sourceEdits });
  const parts: string[] = [];
  let cursor = 0;
  for (const { start, end, kind, identity } of host.exportUrlLocations({ body, contentType: "text/html" })) {
    if (kind === "action" || identity) continue;
    const value = body.slice(start, end);
    const replacement = rewriteHtmlValue({ value, kind, rewrite, parsing: host });
    parts.push(body.slice(cursor, start), replacement);
    cursor = end;
  }
  return parts.join("") + body.slice(cursor);
}

/** Keep CSS and candidate-list grammar with their existing owners. */
function rewriteHtmlValue({ value, kind, rewrite, parsing }: { value: string; kind: string; rewrite: RewriteUrl; parsing: StaticUrlParsing }, _options = {}): string {
  if (kind === "css") return rewriteCss({ body: value, rewrite, parsing });
  if (kind === "srcset") return rewriteSrcset({ value, rewrite, parsing });
  return rewrite({ value });
}

/** Rewrite manifest link fields structurally; malformed manifests retain their original bytes. */
function rewriteManifest({ body, rewrite }: { body: string; rewrite: RewriteUrl }, _options = {}): string {
  try {
    return JSON.stringify(JSON.parse(body), (key, value: unknown) =>
      typeof value === "string" && ["src", "href", "url", "start_url", "scope"].includes(key) ? rewrite({ value }) : value);
  } catch { return body; }
}

/** The same transform visits references during discovery and rewrites them after paths are assigned. */
function rewriteFile({ file, rewrite, host }: { file: File; rewrite: RewriteUrl; host: StaticDownloadHost }, _options = {}): Buffer {
  if (/\.html$/i.test(file.path)) return Buffer.from(rewriteHtml({ body: file.content.toString(), rewrite, host }));
  if (/\.css$/i.test(file.path)) return Buffer.from(rewriteCss({ body: file.content.toString(), rewrite, parsing: host }));
  if (/\.(?:webmanifest|json)$/i.test(file.path)) return Buffer.from(rewriteManifest({ body: file.content.toString(), rewrite }));
  if (file.path === "llms.txt") return Buffer.from(rewriteMarkdown({ body: file.content.toString(), rewrite, parsing: host }));
  return file.content;
}

/** Reuse Jini's generated Markdown ranges and the same relocation map as HTML assets.
 * @complexity O(body bytes + references), no effects.
 */
function rewriteMarkdown({ body, rewrite, parsing }: { body: string; rewrite: RewriteUrl; parsing: StaticUrlParsing }, _options = {}): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const { start, end } of parsing.exportUrlLocations({ body, contentType: "text/markdown" })) {
    parts.push(body.slice(cursor, start), rewrite({ value: body.slice(start, end) }));
    cursor = end;
  }
  return parts.join("") + body.slice(cursor);
}

/** Static downloads alone supply permissive rules when the captured robots document is empty.
 * The exporter already enforces public-origin/Sitemap policy; retain configured bytes verbatim.
 */
function downloadRobots({ file, content }: { file: string; content: Buffer }, _options = {}): Buffer {
  return file === "robots.txt" && !content.toString().trim() ? Buffer.from("User-agent: *\nAllow: /\n") : content;
}

/** Follow page references through stylesheets/manifests, retaining only reached public media.
 * @complexity O(text bytes + references), each file visited at most once; no I/O.
 */
function referencedFiles({ copy, host }: { copy: Copy; host: StaticDownloadHost }, _options = {}): Set<string> {
  const files = new Map(copy.files.map(file => [file.path, file]));
  const reached = new Set(copy.files.filter(file => /\.html$/i.test(file.path)).map(file => file.path));
  // Set iteration visits newly added entries: CSS imports and manifest icons share one bounded crawl.
  for (const name of reached) {
    const file = files.get(name);
    if (!file) continue;
    rewriteFile({ file, rewrite: ({ value }, _optional = {}) => {
      const url = localUrl({ value, file: name, publicOrigin: copy.publicOrigin, basePath: copy.basePath });
      if (url && files.has(url.pathname.slice(1))) reached.add(url.pathname.slice(1));
      return value;
    }, host });
  }
  return reached;
}

/** Allocate distinct portable filenames before rewriting; different source URLs retain their bytes. */
function allocateDownloadPath({ target, claimed, host }: { target: string; claimed: Set<string>; host: StaticDownloadHost }, _options = {}): string {
  const extension = path.posix.extname(target);
  const stem = extension ? target.slice(0, -extension.length) : target;
  let suffix = 1, candidate = target;
  while (claimed.has(host.sharePathAlias({ path: candidate }))) {
    suffix += 1;
    candidate = `${stem}-${suffix}${extension}`;
  }
  claimed.add(host.sharePathAlias({ path: candidate }));
  return candidate;
}

/** Flatten public media independently of theme images, using the same portable filename allocator. */
function mediaPath({ file, claimed, host }: { file: string; claimed: Set<string>; host: StaticDownloadHost }, _options = {}): string {
  const name = file.split("/")[1];
  if (name === undefined) throw new Error(`Static download media path has no filename: ${file}`);
  return allocateDownloadPath({ target: `media/${name}${path.posix.extname(file)}`, claimed, host });
}

/** Repeated public URLs across themes use the first allocated media destination. */
function sharedMediaPath({ file, media, claimed, host }: { file: string; media: Map<string, string>; claimed: Set<string>; host: StaticDownloadHost }, _options = {}): string {
  const existing = media.get(file);
  if (existing) return existing;
  const target = mediaPath({ file, claimed, host });
  media.set(file, target);
  return target;
}

/** Theme assets keep meaningful subtrees while media-library assets live beside sites/. */
function themeAssetPath({ file }: { file: string }, _options = {}): string {
  const relative = file.replace(/^theme-assets\/[^/]+\//, "");
  if (/\.webmanifest$/i.test(relative)) return path.posix.basename(relative);
  if (/\.css$/i.test(relative)) return "css/" + relative.replace(/^(?:css|styles)\//, "");
  if (/\.(?:m?js|cjs)$/i.test(relative)) return "js/" + relative.replace(/^(?:js|scripts)\//, "");
  if (/\.(?:woff2?|ttf|otf|eot)$/i.test(relative)) return "fonts/" + path.posix.basename(relative);
  if (relative.startsWith("icons/")) return relative;
  if (/\.ico$/i.test(relative)) return "icons/" + path.posix.basename(relative);
  if (/\.(?:avif|webp|png|jpe?g|gif|svg|ico)$/i.test(relative)) return "images/" + relative.replace(/^(?:assets|images)\//, "");
  return relative;
}

/** Theme-owned files retain their own subtree; the single README stays at archive root. */
function themeDownloadPath({ file, theme }: { file: string; theme: string }, _options = {}): string {
  if (file === "README.txt") return file;
  const relative = file.startsWith("theme-assets/") ? themeAssetPath({ file }) : file;
  return `sites/${theme}/${relative}`;
}

/** Assign paths before rewriting, so references and files share one immutable mapping. */
function downloadPaths({ copy, theme, reached, media, claimed, host }: { copy: Copy; theme: string; reached: ReadonlySet<string>; media: Map<string, string>; claimed: Set<string>; host: StaticDownloadHost }, _options = {}): Map<string, string> {
  const paths = new Map<string, string>();
  for (const file of copy.files) {
    host.validateSharePath({ path: file.path });
    if (file.path.startsWith("m/")) {
      const target = reached.has(file.path) ? sharedMediaPath({ file: file.path, media, claimed, host }) : undefined;
      if (target) paths.set(file.path, target);
      continue;
    }
    // Removing theme/font directory prefixes can merge distinct URLs. Allocate before URL rewrites.
    paths.set(file.path, allocateDownloadPath({ target: themeDownloadPath({ file: file.path, theme }), claimed, host }));
  }
  return paths;
}

/** Map a local page or asset from its old location to a file-relative download URL.
 * Missing /m/ responses include private Library documents; never retain their URLs.
 */
function relocatedUrl({ value, file, target, paths, copy, theme, parsing }: { value: string; file: string; target: string; paths: ReadonlyMap<string, string>; copy: Copy; theme: string; parsing: StaticUrlParsing }, _options = {}): string {
  const url = localUrl({ value, file, publicOrigin: copy.publicOrigin, basePath: copy.basePath });
  if (!url) return value;
  const source = url.pathname.slice(1);
  const page = source.replace(/\/$/, "");
  const destination = paths.get(source) ?? paths.get(parsing.outputFileForUrl({ url: url.pathname }, { contentRoute: true }));
  if (!destination && source.startsWith("m/")) return "";
  const themeRoot = `sites/${theme}`;
  const fallback = `${themeRoot}/${page || "index.html"}`;
  // Keep page paths explicit through the theme root, including links back to the current page.
  if (destination?.endsWith(".html")) return [path.posix.relative(path.posix.dirname(target), themeRoot),
    path.posix.relative(themeRoot, destination)].filter(Boolean).join("/") + url.search + url.hash;
  return path.posix.relative(path.posix.dirname(target), destination ?? fallback) + url.search + url.hash;
}

/**
 * Package an already-captured site for opening from disk. Pure: returns new paths/bytes,
 * leaving the capture and the publish/CLI exporter layout untouched.
 * @param required The captured site, including its original URL and theme context.
 * @returns Download entries without the dated outer folder (the ZIP builder owns that folder).
 * @throws SiteShareRefusal when an original path is unsafe; archive-wide collisions are checked by the ZIP owner.
 * @complexity O(text bytes + references + files² + collision retries), O(export bytes) memory; no I/O.
 * @example staticDownloadLayout({ copy });
 */
export function staticDownloadLayout({ copy, copies = [copy], activeThemeId, themes, host }: { copy: Copy; copies?: readonly Copy[] | undefined; activeThemeId?: string | undefined; themes?: readonly StaticExportTheme[] | undefined; host: StaticDownloadHost }, _options = {}): readonly File[] {
  const plans = downloadPlans({ copies, themes, siteSlug: copy.siteSlug ?? "", host });
  const entries: File[] = [], deliveredMedia = new Set<string>();
  const sizes: { path: string; bytes: number }[] = [];
  let totalBytes = 0;
  // Track combined output incrementally after URL deduplication, before ZIP encoding.
  const add = (file: File) => {
    totalBytes += file.content.length;
    sizes.push({ path: file.path, bytes: file.content.length });
    host.checkShareLimits({ files: sizes, totalBytes });
    entries.push(file);
  };
  const readmes: string[] = [], landing: LandingTheme[] = [];
  for (const plan of plans) {
    const files = relocatedFiles({ ...plan, deliveredMedia, host });
    for (const file of files) add(file);
    readmes.push(...downloadReadme({ plan }));
    landing.push(landingTheme({ plan, files, activeThemeId: activeThemeId ?? copy.themeId, host }));
  }
  // A partial render may lose a home page; the landing page still lists every delivered page.
  add(landingFile({ copy, landing, host }));
  if (readmes.length) add(readmeFile({ readmes }, { sharedMedia: copies.length > 1 ? deliveredMedia.size : undefined }));
  return entries;
}

/** The download's landing page, named after the site and listing every theme card. */
function landingFile({ copy, landing, host }: { copy: Copy; landing: readonly LandingTheme[]; host: StaticDownloadHost }, _options = {}): File {
  return { path: LANDING_FILE, content: host.renderLanding({ siteName: copy.readme?.name ?? copy.siteSlug ?? "Website", exportedWords: copy.readme?.words, themes: landing }) };
}

/** The combined per-theme README; a multi-theme download also counts its shared media. */
function readmeFile({ readmes }: { readmes: readonly string[] }, { sharedMedia }: { sharedMedia?: number | undefined } = {}): File {
  return { path: "README.txt", content: Buffer.from(readmes.join("\n") + (sharedMedia !== undefined ? `\nShared media: ${sharedMedia} files in media/.\n` : "")) };
}

/** One landing card: the theme's display title, its folder and its delivered pages (redirect stubs omitted). */
function landingTheme({ plan, files, activeThemeId, host }: { plan: ReturnType<typeof downloadPlans>[number]; files: readonly File[]; activeThemeId?: string | undefined; host: StaticDownloadHost }, _options = {}): LandingTheme {
  const skip = new Set((plan.copy.metadata?.redirectFiles ?? []).flatMap(file => plan.paths.get(file) ?? []));
  return { title: plan.copy.metadata?.theme ?? plan.theme, folder: plan.theme, active: plan.copy.themeId !== undefined && plan.copy.themeId === activeThemeId,
    pages: landingPages({ files, folder: plan.theme, skip, extractPlainText: host.extractPlainText }) };
}

/** Dated downloads and deterministic commits share the same per-theme disclosures. */
function downloadReadme({ plan }: { plan: ReturnType<typeof downloadPlans>[number] }, _options = {}): string[] {
  if (!plan.copy.readme || !plan.copy.metadata) return [];
  return [readmeText({ ...plan.copy.readme, metadata: plan.copy.metadata,
    rendered: { files: [...plan.paths.values()].filter(name => name !== "README.txt").map(path => ({ path })), publicOrigin: plan.copy.publicOrigin } }, { downloadTheme: plan.theme }).toString()];
}

/** Assign every theme/media path before any rewrite; page maps remain capture-local. */
function downloadPlans({ copies, themes, siteSlug, host }: { copies: readonly Copy[]; themes?: readonly StaticExportTheme[] | undefined; siteSlug: string; host: StaticDownloadHost }, _options = {}) {
  const folders = new Map((themes ?? host.allocateThemes({ themeIds: copies.map(item => item.themeId ?? item.metadata?.theme ?? "site"), siteSlug })).map(theme => [theme.themeId, theme.name]));
  const media = new Map<string, string>(), claimed = new Set<string>();
  return copies.map(item => {
    const theme = folders.get(item.themeId ?? item.metadata?.theme ?? "site");
    if (theme === undefined) throw new Error("Static download has no allocated theme folder");
    return { copy: item, theme, paths: downloadPaths({ copy: item, theme, reached: referencedFiles({ copy: item, host }), media, claimed, host }) };
  });
}

/** Relocate one theme's URLs against its own page map, sharing only public media URL identities.
 * @complexity O(capture bytes + references), no I/O; shared media membership is archive-wide.
 */
function relocatedFiles({ copy, theme, paths, deliveredMedia, host }: { copy: Copy; theme: string; paths: ReadonlyMap<string, string>; deliveredMedia: Set<string>; host: StaticDownloadHost }, _options = {}): File[] {
  const entries: File[] = [];
  for (const file of copy.files) {
    const target = paths.get(file.path);
    if (!target || file.path === "README.txt" || deliveredMedia.has(target)) continue;
    if (target.startsWith("media/")) {
      deliveredMedia.add(target);
    }
    const content = downloadRobots({ file: file.path, content: rewriteFile({ file, rewrite: ({ value }, _optional = {}) => relocatedUrl({ value, file: file.path, target, paths, copy, theme, parsing: host }), host }) });
    entries.push({ path: target, content });
  }
  return entries;
}
