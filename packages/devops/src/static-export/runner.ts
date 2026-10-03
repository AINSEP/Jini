import type { ExportedAsset, ExportedRoute, ExportReport, ExportSiteArgs, ExportSiteOptions, FailedAsset, FailedRoute, ManifestRoute, RouteManifest } from './contracts.js';
import { extractAssetUrls, extractCssUrls, normalizeBasePath, outputFileForUrl, redirectOutcomeFor, renderRedirectStub, rewriteRouteBodyForBasePath, safeRelativeOutputFile } from './transforms.js';

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
async function writeRoute(ctx: RunContext, route: ManifestRoute): Promise<WrittenRoute | { reason: string }> {
  // Validate the request path even when the error-page policy supplies a different artifact path.
  const regularOutput = outputFileForUrl({ url: route.path }, { contentRoute: route.kind !== 'well-known' });
  const outputFile = route.kind === 'not-found' ? safeRelativeOutputFile({ value: ctx.args.errorPage.outputFile }) : regularOutput;
  const response = await request(ctx, route.path);
  let body: string;
  let rawBody: string | undefined;
  let contentType = response.headers.get('content-type');
  if (route.kind === 'redirect') {
    const decision = redirectOutcomeFor({ status: response.status, locationHeader: response.headers.get('location') }, { ...(route.redirectTarget !== undefined ? { manifestTarget: route.redirectTarget } : {}) });
    if (decision.kind === 'failed') return { reason: decision.reason };
    body = ctx.args.security.transformHtml({ html: renderRedirectStub({ location: decision.location }, { basePath: ctx.basePath }) });
    contentType = 'text/html; charset=utf-8';
    await response.body?.cancel();
  } else {
    if (route.kind === 'not-found' ? !ctx.args.errorPage.acceptStatus({ status: response.status }) : response.status !== 200) {
      await response.body?.cancel();
      return { reason: route.kind === 'not-found' ? `expected an accepted response for the error-page probe, got ${response.status}` : `expected 200, got ${response.status}` };
    }
    rawBody = await response.text();
    body = rewriteRouteBodyForBasePath({ path: route.path, body: rawBody, basePath: ctx.basePath });
    if (route.kind === 'not-found' || /^text\/html\b/i.test(contentType ?? '')) body = ctx.args.security.transformHtml({ html: body });
  }
  await ctx.args.writer.write({ outputDir: ctx.args.outputDir, outputFile, data: body });
  return { route: { path: route.path, kind: route.kind, outputFile, data: body, contentType }, ...(rawBody !== undefined && route.kind !== 'not-found' ? { crawlHtml: rawBody } : {}) };
}
async function writeRoutes(ctx: RunContext, routes: readonly ManifestRoute[]): Promise<{ succeeded: ExportedRoute[]; failed: FailedRoute[]; assets: Set<string> }> {
  const succeeded: ExportedRoute[] = [], failed: FailedRoute[] = [];
  const assets = new Set<string>();
  for (const route of routes) {
    try {
      const outcome = await writeRoute(ctx, route);
      if ('reason' in outcome) { failed.push({ path: route.path, kind: route.kind, reason: outcome.reason }); continue; }
      succeeded.push(outcome.route);
      if (outcome.crawlHtml !== undefined) for (const url of extractAssetUrls({ html: outcome.crawlHtml, prefixes: ctx.args.assetUrlPrefixes })) assets.add(url);
    } catch (error) { failed.push({ path: route.path, kind: route.kind, reason: failureReason(ctx, route.path, error) }); }
  }
  return { succeeded, failed, assets };
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
      const outputFile = outputFileForUrl({ url });
      const response = await request(ctx, url);
      if (!response.ok) { await response.body?.cancel(); failed.push({ url, reason: `GET ${url} -> ${response.status}` }); continue; }
      const data = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type');
      await ctx.args.writer.write({ outputDir: ctx.args.outputDir, outputFile, data });
      succeeded.push({ url, outputFile, data, contentType });
      if (crawlCss && url.split('?')[0]!.endsWith('.css')) {
        for (const child of extractCssUrls({ css: data.toString('utf8'), cssUrl: url, prefixes: ctx.args.assetUrlPrefixes })) queue.push({ url: child, crawlCss: false });
      }
    } catch (error) { failed.push({ url, reason: failureReason(ctx, url, error) }); }
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
/** Drive the caller's actual app, retaining exact written bytes and reporting each failed item.
 * Startup/output/inventory errors throw; an opened app always closes. No singleton state is used.
 */
export async function exportSite(required: ExportSiteArgs, optional: ExportSiteOptions = {}): Promise<ExportReport> {
  const basePath = normalizeBasePath({ raw: optional.basePath ?? '' });
  const timeoutMs = optional.fetchTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError('fetchTimeoutMs must be a positive integer');
  await required.writer.prepare({ outputDir: required.outputDir }, { clean: optional.clean ?? false });
  const manifest = await required.manifest.build({});
  const session = await required.app.open({});
  try {
    const origin = new URL(session.baseUrl);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('App session baseUrl must be an HTTP origin without credentials.');
    const ctx: RunContext = { args: required, baseUrl: origin.origin, basePath, timeoutMs };
    const routes = await writeRoutes(ctx, manifest.routes);
    const assets = await writeAssets(ctx, [...routes.assets]);
    return { outputDir: required.outputDir, routes: { succeeded: routes.succeeded, failed: routes.failed }, assets, skippedManifestEntries: manifest.skipped,
      unreferencedThemeFiles: await unreferenced(ctx, manifest, assets.succeeded), ...(basePath ? { basePath, basePathRewriteWarning: BASE_PATH_REWRITE_WARNING } : {}) };
  } finally { await session.close({}); }
}
