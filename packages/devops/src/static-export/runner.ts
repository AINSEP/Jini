import { ExportPathError } from "./contracts.js";
import type { DroppedReference, ExportedAsset, ExportedRoute, ExportReport, ExportSiteArgs, ExportSiteOptions, FailedAsset, FailedRoute, ManifestRoute, ManifestSkip, RouteManifest } from './contracts.js';
import { extractAssetUrls, extractHtmlReferences, extractCssUrls, normalizeBasePath, outputFileForUrl, redirectOutcomeFor, renderRedirectStub, rewriteRouteBodyForBasePath, rewriteAssetBodyForBasePath, safeRelativeOutputFile } from './transforms.js';

const BASE_PATH_REWRITE_WARNING = "base-path rewriting is a best-effort TEXT rewrite over already-rendered responses — it cannot rewrite a path a theme's own JavaScript constructs at runtime from a string (same category of gap as the unreferenced-theme-file warning, just invisible to this rewrite instead of to the asset crawl).";
interface RunContext { args: ExportSiteArgs; baseUrl: string; basePath: string; timeoutMs: number }
async function request(ctx: RunContext, url: string): Promise<Response> {
  // Redirects are observed, never followed off the caller's app, for routes and assets alike.
  return ctx.args.fetch({ url: ctx.baseUrl + url }, { init: { redirect: 'manual', headers: new Headers(ctx.args.requestHeaders), signal: AbortSignal.timeout(ctx.timeoutMs) } });
}
function failureReason(ctx: RunContext, url: string, error: unknown): string {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return `GET ${ctx.baseUrl}${url} timed out after ${ctx.timeoutMs}ms`;
  return `GET ${ctx.baseUrl}${url} failed: ${ctx.args.describeError({ error })}`;
}
interface WrittenRoute { route: ExportedRoute; crawlHtml?: string }
/** A route's body as it will be written (and, for crawled routes, the raw HTML to scan), or why it failed. */
type RouteBody = { body: string; contentType: string | null; crawlHtml?: string } | { reason: string };
async function redirectBody(required: { ctx: RunContext; route: ManifestRoute; response: Response }): Promise<RouteBody> {
  const { ctx, route, response } = required;
  const decision = redirectOutcomeFor({ status: response.status, locationHeader: response.headers.get('location') }, route.redirectTarget !== undefined ? { manifestTarget: route.redirectTarget } : {});
  if (decision.kind === 'failed') return { reason: decision.reason };
  const body = ctx.args.security.transformHtml({ html: renderRedirectStub({ location: decision.location }, { basePath: ctx.basePath }) });
  await response.body?.cancel();
  return { body, contentType: 'text/html; charset=utf-8' };
}
/** The error-page probe accepts what the host's policy accepts; every other content route needs a 200. */
function statusAccepted(required: { ctx: RunContext; route: ManifestRoute; status: number }): boolean {
  const { ctx, route, status } = required;
  return route.kind === 'not-found' ? ctx.args.errorPage.acceptStatus({ status }) : status === 200;
}
function statusRejection(required: { ctx: RunContext; route: ManifestRoute; status: number }): string {
  const { ctx, route, status } = required;
  if (route.kind !== 'not-found') return `expected 200, got ${status}`;
  return ctx.args.errorPage.rejectionReason?.({ status }) ?? `expected an accepted response for the error-page probe, got ${status}`;
}
async function contentBody(required: { ctx: RunContext; route: ManifestRoute; response: Response }): Promise<RouteBody> {
  const { ctx, route, response } = required;
  const contentType = response.headers.get('content-type');
  if (!statusAccepted({ ctx, route, status: response.status })) {
    await response.body?.cancel();
    return { reason: statusRejection({ ctx, route, status: response.status }) };
  }
  const rawBody = await response.text();
  let body = rewriteRouteBodyForBasePath({ path: route.path, body: rawBody, basePath: ctx.basePath });
  if (route.kind === 'not-found' || /^text\/html\b/i.test(contentType ?? '')) body = ctx.args.security.transformHtml({ html: body });
  // The error page is written but never crawled for assets or further routes.
  return { body, contentType, ...(route.kind !== 'not-found' ? { crawlHtml: rawBody } : {}) };
}
async function writeRoute(ctx: RunContext, route: ManifestRoute): Promise<WrittenRoute | { reason: string }> {
  // Validate the request path even when the error-page policy supplies a different artifact path.
  const regularOutput = outputFileForUrl({ url: route.path }, { contentRoute: route.kind !== 'well-known' });
  const outputFile = route.kind === 'not-found' ? safeRelativeOutputFile({ value: ctx.args.errorPage.outputFile }) : regularOutput;
  const response = await request(ctx, route.path);
  const outcome = route.kind === 'redirect' ? await redirectBody({ ctx, route, response }) : await contentBody({ ctx, route, response });
  if ('reason' in outcome) return outcome;
  await ctx.args.writer.write({ outputDir: ctx.args.outputDir, outputFile, data: outcome.body });
  return { route: { path: route.path, kind: route.kind, outputFile, data: outcome.body, contentType: outcome.contentType }, ...(outcome.crawlHtml !== undefined ? { crawlHtml: outcome.crawlHtml } : {}) };
}
/** Most routes `discoverRoutes` may add to one export; the rest are reported as skipped. */
const MAX_DISCOVERED_ROUTES = 2000;
/** Route queue state for one export: the queue, every path ever queued, the discovered count and cap skips. */
interface RouteQueue { queue: ManifestRoute[]; queued: Set<string>; discovered: number; skipped: ManifestSkip[] }
/** Append newly discovered routes once each, up to the cap; the rest are reported as skipped. */
function enqueueDiscovered(required: { state: RouteQueue; routes: readonly ManifestRoute[] }): void {
  const { state } = required;
  for (const next of required.routes) {
    if (state.queued.has(next.path)) continue;
    state.queued.add(next.path);
    if (state.discovered >= MAX_DISCOVERED_ROUTES) { state.skipped.push({ reason: 'discovered-route-cap', detail: `${next.path} (over ${MAX_DISCOVERED_ROUTES} discovered routes)` }); continue; }
    state.discovered += 1;
    state.queue.push(next);
  }
}
/** Discovery uses the response route's format, so prose cannot masquerade as a manifest. */
function routeAssetFormat({ path }: { path: string }, _optional = {}): 'html' | 'json' | 'xml' {
  if (/\.json(?:[?#]|$)/i.test(path)) return 'json';
  return /\.xml(?:[?#]|$)/i.test(path) ? 'xml' : 'html';
}
async function writeRoutes(ctx: RunContext, routes: readonly ManifestRoute[]): Promise<{ succeeded: ExportedRoute[]; failed: FailedRoute[]; assets: Set<string>; skipped: ManifestSkip[] }> {
  const succeeded: ExportedRoute[] = [], failed: FailedRoute[] = [];
  const assets = new Set<string>();
  // A queue, not a loop over the manifest: discovered routes are appended and scanned in turn.
  const state: RouteQueue = { queue: [...routes], queued: new Set(routes.map(route => route.path)), discovered: 0, skipped: [] };
  for (let index = 0; index < state.queue.length; index++) {
    const route = state.queue[index]!;
    try {
      const outcome = await writeRoute(ctx, route);
      if ('reason' in outcome) { failed.push({ path: route.path, kind: route.kind, reason: outcome.reason }); continue; }
      succeeded.push(outcome.route);
      const html = outcome.crawlHtml;
      if (html === undefined) continue;
      for (const url of extractAssetUrls({ html, prefixes: ctx.args.assetUrlPrefixes }, { format: routeAssetFormat({ path: route.path }) })) assets.add(url);
      enqueueDiscovered({ state, routes: ctx.args.discoverRoutes?.({ path: route.path, html }) ?? [] });
    } catch (error) { failed.push({ path: route.path, kind: route.kind, reason: failureReason(ctx, route.path, error) }); }
  }
  return { succeeded, failed, assets, skipped: state.skipped };
}
async function fetchAsset(required: { ctx: RunContext; url: string; crawlCss: boolean }): Promise<{ asset: ExportedAsset; children: string[] } | { reason: string }> {
  const { ctx, url } = required;
  const outputFile = outputFileForUrl({ url });
  const response = await request(ctx, url);
  if (!response.ok) { await response.body?.cancel(); return { reason: `GET ${url} -> ${response.status}` }; }
  let data = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type');
  const children = stylesheetChildren({ ctx, asset: { url, outputFile, data, contentType }, crawlCss: required.crawlCss });
  if (/^(?:text\/css|application\/(?:[\w.+-]*\+)?json)\b/.test(contentType ?? '')) {
    data = Buffer.from(rewriteAssetBodyForBasePath({ body: data.toString('utf8'), contentType: contentType!, basePath: ctx.basePath }));
  }
  await ctx.args.writer.write({ outputDir: ctx.args.outputDir, outputFile, data });
  return { asset: { url, outputFile, data, contentType }, children };
}
/** Stylesheets and JSON manifests reached from a route are scanned once; never recursive. */
function stylesheetChildren(required: { ctx: RunContext; asset: ExportedAsset; crawlCss: boolean }): string[] {
  const { ctx, asset } = required;
  if (!required.crawlCss) return [];
  if (asset.url.split('?')[0]!.endsWith('.css')) return extractCssUrls({ css: asset.data.toString('utf8'), cssUrl: asset.url, prefixes: ctx.args.assetUrlPrefixes });
  if (/\bjson\b/.test(asset.contentType ?? '')) return extractAssetUrls({ html: asset.data.toString('utf8'), prefixes: ctx.args.assetUrlPrefixes }, { format: 'json' });
  return [];
}
function assetFailureReason(required: { ctx: RunContext; url: string; error: unknown }): string {
  const { ctx, url, error } = required;
  return error instanceof ExportPathError && ctx.args.assetPathFailureReason !== undefined ? ctx.args.assetPathFailureReason : failureReason(ctx, url, error);
}
async function writeAssets(ctx: RunContext, initial: readonly string[]): Promise<{ succeeded: ExportedAsset[]; failed: FailedAsset[] }> {
  const succeeded: ExportedAsset[] = [], failed: FailedAsset[] = [];
  const seen = new Set<string>();
  const queue = initial.map(url => ({ url, crawlCss: true }));
  for (let index = 0; index < queue.length; index++) {
    const { url, crawlCss } = queue[index]!;
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const outcome = await fetchAsset({ ctx, url, crawlCss });
      if ('reason' in outcome) { failed.push({ url, reason: outcome.reason }); continue; }
      succeeded.push(outcome.asset);
      for (const child of outcome.children) queue.push({ url: child, crawlCss: false });
    } catch (error) { failed.push({ url, reason: assetFailureReason({ ctx, url, error }) }); }
  }
  return { succeeded, failed };
}
async function unreferenced(ctx: RunContext, manifest: RouteManifest, assets: readonly ExportedAsset[]): Promise<string[]> {
  if (!manifest.activeTheme) return [];
  const theme = manifest.activeTheme;
  const layout = ctx.args.themeLayout.resolve({ theme });
  const accounted = new Set([`${layout.pagesDir}/index.html`, `${layout.pagesDir}/404.html`]);
  for (const route of manifest.routes) if (route.kind === 'theme-page') accounted.add(`${layout.pagesDir}/${route.label}.html`);
  for (const asset of assets) {
    const pathname = decodeURIComponent(asset.url.split(/[?#]/)[0]!);
    if (pathname.startsWith(layout.assetUrlPrefix)) accounted.add(pathname.slice(layout.assetUrlPrefix.length));
  }
  return [...await ctx.args.assetSource.listThemeFiles({ theme })].filter(file => !accounted.has(file)).sort();
}
/** Most dropped references retained per export. */
const MAX_DROPPED_REFERENCES = 200;
/** Site path normalization shared by written outputs and references: no trailing slashes, root as '/'. */
function pathNormalizer(required: { origin: string }): (url: string) => string {
  return url => new URL(url, required.origin).pathname.replace(/\/+$/, '') || '/';
}
/** Every path this run wrote: artifact paths (and index.html directory aliases), route paths except the error-page probe, and asset URLs. */
function writtenPaths(required: { routes: readonly ExportedRoute[]; assets: readonly ExportedAsset[]; normalize: (url: string) => string }): Set<string> {
  const { routes, assets, normalize } = required;
  const written = new Set<string>();
  for (const item of [...routes, ...assets]) {
    const file = '/' + item.outputFile;
    written.add(normalize(file));
    if (file.endsWith('/index.html')) written.add(normalize(file.slice(0, -10)));
  }
  for (const route of routes) if (route.kind !== 'not-found') written.add(normalize(route.path));
  for (const asset of assets) written.add(normalize(asset.url));
  return written;
}
function isHtmlRoute(route: ExportedRoute): boolean {
  return /^text\/html\b/i.test(route.contentType ?? '') || route.outputFile.endsWith('.html');
}
/** Fragments are always skipped; empty and query-only values are skipped unless they are form actions (which post to the page itself). */
function isSkippedReference(required: { value: string; attribute: string }): boolean {
  const { value, attribute } = required;
  return ((!value || value.startsWith('?')) && attribute !== 'action') || value.startsWith('#');
}
interface DropScan { origin: string; basePath: string; normalize: (url: string) => string; written: ReadonlySet<string> }
/** The same-origin site path a reference names, base path stripped; undefined when unparseable or off-site. */
function referencedPath(required: { scan: DropScan; value: string; page: string }): string | undefined {
  const { scan, value, page } = required;
  let url: URL;
  try { url = new URL(value, scan.origin + scan.basePath + page); } catch { return undefined; }
  if (url.origin !== scan.origin) return undefined;
  let pathname = url.pathname;
  if (scan.basePath && (pathname === scan.basePath || pathname.startsWith(scan.basePath + '/'))) pathname = pathname.slice(scan.basePath.length) || '/';
  return scan.normalize(pathname);
}
/** A reference this export cannot serve: a form action (needs a server) or a link to a path nothing wrote. */
function droppedReference(required: { scan: DropScan; page: string; reference: { url: string; attribute: string } }): DroppedReference | undefined {
  const { scan, page, reference } = required;
  const value = reference.url.trim();
  if (isSkippedReference({ value, attribute: reference.attribute })) return undefined;
  const url = referencedPath({ scan, value, page });
  if (url === undefined) return undefined;
  const reason = reference.attribute === 'action' ? 'needs-server' : 'not-exported';
  if (reason === 'not-exported' && scan.written.has(url)) return undefined;
  return { page, url, attribute: reference.attribute, reason };
}
/** Dedupe per page + URL; a form replaces an earlier link to the same URL, and new keys stop at the cap. */
function recordDrop(required: { dropped: Map<string, DroppedReference>; drop: DroppedReference }): void {
  const { dropped, drop } = required;
  const key = drop.page + '\n' + drop.url;
  if (dropped.has(key)) {
    if (drop.reason === 'needs-server') dropped.set(key, drop);
  } else if (dropped.size < MAX_DROPPED_REFERENCES) dropped.set(key, drop);
}
/** Compare written HTML with this run's outputs only; no requests or filesystem reads.
 * At most 200 drops are retained. O(output count + scanned HTML bytes) time; output paths plus
 * at most 200 dedupe keys are retained. Forms take precedence over links to the same URL.
 */
function droppedReferences(required: { routes: readonly ExportedRoute[]; assets: readonly ExportedAsset[]; basePath: string; baseUrl: string }): DroppedReference[] {
  const origin = required.baseUrl;
  const normalize = pathNormalizer({ origin });
  const scan: DropScan = { origin, basePath: required.basePath, normalize, written: writtenPaths({ routes: required.routes, assets: required.assets, normalize }) };
  const dropped = new Map<string, DroppedReference>();
  for (const route of required.routes.filter(isHtmlRoute)) {
    for (const reference of extractHtmlReferences({ html: route.data })) {
      const drop = droppedReference({ scan, page: route.path, reference });
      if (drop) recordDrop({ dropped, drop });
    }
  }
  return [...dropped.values()];
}
/** The app session's origin. Anything but a bare http(s) origin without credentials is refused. */
function sessionOrigin(required: { baseUrl: string }): string {
  const origin = new URL(required.baseUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('App session baseUrl must be an HTTP origin without credentials.');
  return origin.origin;
}
function fetchTimeout(required: { fetchTimeoutMs: number | undefined }): number {
  const timeoutMs = required.fetchTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError('fetchTimeoutMs must be a positive integer');
  return timeoutMs;
}
/** Drive the caller's actual app, retaining exact written bytes and reporting each failed item.
 * Startup/output/inventory errors throw; an opened app always closes. No singleton state is used.
 */
export async function exportSite(required: ExportSiteArgs, optional: ExportSiteOptions = {}): Promise<ExportReport> {
  const basePath = normalizeBasePath({ raw: optional.basePath ?? '' });
  const timeoutMs = fetchTimeout({ fetchTimeoutMs: optional.fetchTimeoutMs });
  await required.writer.prepare({ outputDir: required.outputDir }, { clean: optional.clean ?? false });
  const manifest = await required.manifest.build({});
  const session = await required.app.open({});
  try {
    const ctx: RunContext = { args: required, baseUrl: sessionOrigin({ baseUrl: session.baseUrl }), basePath, timeoutMs };
    const routes = await writeRoutes(ctx, manifest.routes);
    const assets = await writeAssets(ctx, [...routes.assets]);
    return { outputDir: required.outputDir, routes: { succeeded: routes.succeeded, failed: routes.failed }, assets, skippedManifestEntries: [...manifest.skipped, ...routes.skipped],
      droppedReferences: droppedReferences({ routes: routes.succeeded, assets: assets.succeeded, basePath, baseUrl: ctx.baseUrl }),
      unreferencedThemeFiles: await unreferenced(ctx, manifest, assets.succeeded), ...(basePath ? { basePath, basePathRewriteWarning: BASE_PATH_REWRITE_WARNING } : {}) };
  } finally { await session.close({}); }
}
