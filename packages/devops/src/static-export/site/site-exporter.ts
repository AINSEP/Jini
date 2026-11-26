import type { RequestListener } from "node:http";
import path from "node:path";
import { rm } from "node:fs/promises";
import { resolveConfiguredOrigin, type OriginRegistryPort } from "@jini-ai/core/contracts/server/verified-origin";
import type { SiteCookieConsentDeps } from "@jini-ai/core/contracts/headless/site-cookie-consent";
import type { ObservabilityPort } from "@jini-ai/core/contracts/observability";
import type { SecurityHeaderSet } from "@jini-ai/core/contracts/server/security-headers";
import { exportSite as runExport } from "../entry.js";
import type { ExportReport as BaseExportReport, ExportSiteArgs, RouteManifest } from "../contracts.js";
import { createNodeAppFactory, createNodeArtifactWriter, createNodeAssetSource } from "../node-adapters.js";
import { createExportPreflight, type ExportPreflightCopy } from "./export-preflight.js";
import { withSecurityMeta } from "./static-security-headers.js";
import { rewriteExportMediaResponse, type ExportMediaUrlDeps } from "./media-original-urls.js";
import { exportPublicOrigin, rewriteExportOriginResponse } from "./public-origin-policy.js";

export interface ExportSiteRouteDeps {
  readonly workspaceId: string;
  readonly clock: { nowIso(): string };
  readonly originRegistry: OriginRegistryPort;
  readonly cookieConsent?: SiteCookieConsentDeps;
  readonly createSiteApp: (optional?: { themeId?: string }) => RequestListener;
  readonly observability: ObservabilityPort;
  readonly trackFetch: (required: { fetch: typeof globalThis.fetch; observability: ObservabilityPort }) => typeof globalThis.fetch;
  readonly preflightCopy: ExportPreflightCopy;
  readonly buildPreviewExportManifest: (required: { routeDeps: ExportSiteRouteDeps & { resolveActiveThemeId?: () => Promise<string> } }, optional: Pick<ExportSiteOptions, "includeThemePreviews">) => Promise<{ manifest: RouteManifest; themeCount: number }>;
  readonly bindExportMediaUrls: (required: { deps: ExportSiteRouteDeps }) => ExportMediaUrlDeps<{ status: string; kind?: string; source: { sha256: string } }>;
  readonly themeLayout: ExportSiteArgs["themeLayout"];
  readonly assetUrlPrefixes: ExportSiteArgs["assetUrlPrefixes"];
  readonly declaredThemeAssets: (required: { routeDeps: ExportSiteRouteDeps; activeThemeId: string | undefined }) => string[];
  readonly requestHeaders: ExportSiteArgs["requestHeaders"];
  readonly exportHtml: (required: { html: string; publicOrigin?: string; stripNativeFormTools: ExportSiteRouteDeps["withoutNativeFormTools"] }) => string;
  readonly withoutNativeFormTools: (required: { html: string }, optional?: Record<string, never>) => string;
  readonly publicPageSecurityHeaders: (required: Record<string, never>) => SecurityHeaderSet;
  readonly extractListingMoreHrefs: (required: { html: string }) => readonly string[];
  readonly extractListingPageHrefs: (required: { html: string }) => readonly string[];
  readonly listingJsonNextPath: (required: { path: string; body: string }) => string | undefined;
  readonly themePreviewExportSize: (required: { report: BaseExportReport; themeCount: number }) => { themeCount: number; htmlSizeMultiplier: number; sizeMultiplier: number; additionalPages: number };
  readonly reportInfo: (message: string) => void;
}

export interface ExportSiteOptions {
  /** The same composition-root object `createApp`/`host src/server/runtime/composition/deps.ts` already build — the exporter
   *  boots the real app with this, exactly like `cli/commands/serve.ts` does. */
  routeDeps: ExportSiteRouteDeps;
  outputDir: string;
  /** By default, replace this export's files and keep unrelated files (removing files this process
   *  did not write is destructive — see `cli/commands/export.ts` for the `--clean` flag).
   *  Pass `true` to remove the directory's existing contents before writing. */
  clean?: boolean;
  /**
   * When set (e.g. `"/my-repo"` for a host that serves the site under a repository subpath), every root-relative reference this
   * exporter writes — HTML `href`/`src`/`srcset`/`poster`, `sitemap.xml`'s `<loc>`, `robots.txt`'s `Sitemap:` line, a
   * redirect stub's target — is rewritten to carry this prefix. Omitted/empty (the default) leaves
   * every byte this exporter writes IDENTICAL to a pre-`--base-path` export — proven by
   * `site-exporter.test.ts`'s own "unset is inert" regression test, not just asserted in this
   * comment.
   */
  basePath?: string;
  /** Destination URL supplied by this export request or deploy target; never saved as site identity. */
  publicUrl?: string;
  /** Request-local theme override for a selected static capture; never activates it. */
  themeId?: string;
  /** Portable static copies render one theme; deployment builds retain previews. */
  includeThemePreviews?: boolean;
}


/** Site-relative listing hrefs as discovered export routes of `kind`; protocol-relative/absolute ones are dropped. */
/** The given options with each one also accepting an explicit `undefined` (destructured values). */
type MaybeOptions<T> = { [K in keyof T]?: T[K] | undefined };

function listingRoutes({ hrefs, kind }: { hrefs: readonly string[]; kind: string }, _optional: Record<string, never> = {}) {
  return hrefs.filter((href) => href.startsWith("/") && !href.startsWith("//")).map((href) => ({ path: href, kind, label: href }));
}

/** Keep precedence visible to result consumers and the CLI through the existing warning field:
 * a public URL owns the output prefix, so an explicit base path beside it is reported as ignored. */
function ignoredBasePathNotice({ publicUrl, basePath, warning }: MaybeOptions<Pick<ExportSiteOptions, "publicUrl" | "basePath">> & { warning: string | undefined }) {
  if (publicUrl === undefined || basePath === undefined) return {};
  return { basePathRewriteWarning: ["The base path was ignored because the public URL sets the path.", warning].filter(Boolean).join(" ") };
}

/** Validate the destination through Jini's origin owner; scope every rewrite to this copy.
 * No registration or mutation of the live site's origin. A destination overrides its old public URL.
 * @complexity One bounded registry read plus O(URL bytes); invalid destinations throw before export.
 */
async function resolveExportIdentity({ routeDeps, publicUrl }: Pick<ExportSiteOptions, "routeDeps"> & MaybeOptions<Pick<ExportSiteOptions, "publicUrl">>, _options = {}) {
  // The configured-origin owner refuses non-HTTPS, loopback, userinfo, query and fragment URLs.
  const destination = publicUrl === undefined ? undefined : resolveConfiguredOrigin({ env: { destination: publicUrl }, envVarName: "destination", clock: routeDeps.clock, warn: () => {} });
  if (publicUrl !== undefined && !destination) throw new Error("The public URL must be a public HTTPS address.");
  // A publish renders against its own destination, without changing the local site's trust root.
  const publicOrigin = destination && `https://${destination.host}${destination.port === undefined ? "" : `:${destination.port}`}`;
  const publicBaseUrl = publicOrigin && publicOrigin + (destination.basePath ?? "");
  const sourceOrigin = await exportPublicOrigin({ registry: routeDeps.originRegistry, workspaceId: routeDeps.workspaceId });
  return { publicOrigin, publicBaseUrl, sourceOrigin };
}

/** Compose the real CMS manifest/theme/security policy with Jini's export engine. */
export async function exportHostSite({ routeDeps, outputDir, clean, basePath, includeThemePreviews, themeId, publicUrl }: ExportSiteOptions, _options = {}) {
  const tracedFetch = routeDeps.trackFetch({ fetch: (input, init) => fetch(input, init), observability: routeDeps.observability });
  const { manifest, themeCount } = await exportManifestForTheme({ routeDeps }, { themeId, includeThemePreviews });
  const { publicOrigin, publicBaseUrl, sourceOrigin } = await resolveExportIdentity({ routeDeps, publicUrl });
  // The resolved destination owns its prefix: custom domains and user Pages sites can be at root.
  const outputBasePath = publicBaseUrl ? new URL(publicBaseUrl).pathname : basePath;
  const writer = createNodeArtifactWriter({}, {});
  // Sitemaps require absolute loc values; RSS requires an absolute channel link. With no public
  // identity omit both, including stale copies in a reused output directory (the CLI default).
  const omitted = publicOrigin ? [] : ["/sitemap.xml", "/feed.xml"];
  const siteApp = themeId === undefined ? routeDeps.createSiteApp() : routeDeps.createSiteApp({ themeId });
  const consentWarning = await routeDeps.cookieConsent?.exportWarning?.();
  // Pre-flight warnings (A421 placeholder, A400 third-party scripts) ride the same report field as the consent warning.
  const preflight = createExportPreflight({ ownOrigins: [publicBaseUrl, sourceOrigin], copy: routeDeps.preflightCopy });
  const report = await runExport({
    outputDir: path.resolve(outputDir),
    manifest: { build: async () => ({ ...manifest, routes: manifest.routes.filter(route => !omitted.includes(route.path)) }) },
    app: createNodeAppFactory({ createApp: () => siteApp }, {}),
    writer: { ...writer, prepare: async (required, optional) => {
      await writer.prepare(required, optional);
      for (const file of omitted) await rm(path.join(required.outputDir, file.slice(1)), { force: true });
    } },
    fetch: async ({ url }, options) => rewriteExportMediaResponse({
      response: await rewriteExportOriginResponse({ response: await tracedFetch(url, options?.init), url, publicOrigin: publicBaseUrl, sourceOrigin }), deps: routeDeps.bindExportMediaUrls({ deps: routeDeps }),
    }),
    assetSource: createNodeAssetSource({}, {}),
    themeLayout: routeDeps.themeLayout,
    assetUrlPrefixes: routeDeps.assetUrlPrefixes,
    assetUrls: async () => {
      const consentAssets = await routeDeps.cookieConsent?.exportAssets?.() ?? [];
      preflight.setConsentConfigured({ configured: consentAssets.length > 0 });
      return [...routeDeps.declaredThemeAssets({ routeDeps, activeThemeId: manifest.activeTheme?.id }), ...consentAssets];
    },
    requestHeaders: routeDeps.requestHeaders,
    security: { transformHtml: ({ html }) => {
      preflight.observePage({ html });
      const exported = routeDeps.exportHtml({ html, stripNativeFormTools: routeDeps.withoutNativeFormTools, ...(publicBaseUrl === undefined ? {} : { publicOrigin: publicBaseUrl }) });
      return withSecurityMeta({ html: exported, headers: routeDeps.publicPageSecurityHeaders({}) });
    } },
    errorPage: { outputFile: "404.html", acceptStatus: ({ status }) => status >= 400 && status < 500,
      rejectionReason: ({ status }) => `expected a 4xx response for the 404 probe, got ${status}` },
    assetPathFailureReason: "asset URL resolved outside the output directory — refused",
    describeError: ({ error }) => error instanceof Error ? error.message : String(error),
    // See-more batches (`<page>/_more/<key>/<after>`): each exported page's next-batch link is
    // exported too, and that batch's own link after it, so the button works on a static host.
    // A JSON batch's next batch comes from its `nextCursor`; a page or HTML batch names it in its button.
    // Numbered listing pages (`<page>/page/<n>`, Bug C): each page's prev/next links are followed
    // the same way, so every page is written as `.../page/<n>/index.html`.
    discoverRoutes: ({ path, html }) => [
      ...listingRoutes({ hrefs: [...routeDeps.extractListingMoreHrefs({ html }), ...[routeDeps.listingJsonNextPath({ path, body: html })].filter((next) => next !== undefined)], kind: "listing-batch" }),
      ...listingRoutes({ hrefs: routeDeps.extractListingPageHrefs({ html }), kind: "listing-page" }),
    ],
  }, { ...(clean !== undefined ? { clean } : {}), ...(outputBasePath !== undefined ? { basePath: outputBasePath } : {}) });
  return finishExportReport({ report, outputDir, publicOrigin, publicUrl, basePath, themeCount, consentWarning: preflight.joinWarnings({ existing: consentWarning }), themePreviewExportSize: routeDeps.themePreviewExportSize, reportInfo: routeDeps.reportInfo });
}

/** The site's manifest for its active theme, or for one chosen theme rendered as if active (then without previews). */
function exportManifestForTheme(
  { routeDeps }: Pick<ExportSiteOptions, "routeDeps">,
  { themeId, includeThemePreviews }: MaybeOptions<Pick<ExportSiteOptions, "themeId" | "includeThemePreviews">> = {},
) {
  return routeDeps.buildPreviewExportManifest({ routeDeps: themeId === undefined ? routeDeps : { ...routeDeps, resolveActiveThemeId: async () => themeId } }, themeId !== undefined ? { includeThemePreviews: false } : includeThemePreviews === undefined ? {} : { includeThemePreviews });
}

/** Return publication diagnostics after the exporter has closed its fresh app session. */
function finishExportReport({ report, outputDir, publicOrigin, publicUrl, basePath, themeCount, consentWarning, themePreviewExportSize, reportInfo }: {
  report: BaseExportReport; outputDir: string; publicOrigin: string | undefined; publicUrl: string | undefined;
  basePath: string | undefined; themeCount: number; consentWarning: string | undefined;
  themePreviewExportSize: ExportSiteRouteDeps["themePreviewExportSize"]; reportInfo: ExportSiteRouteDeps["reportInfo"];
}) {
  // Jini's reference scan diagnoses retained broken links; it does not remove them. A dropped
  // reference must be backed by an actual removal. Download-only removals are recorded by static-copy.
  const result = { ...report, ...(consentWarning ? { consentWarning } : {}), outputDir, droppedReferences: [], ...(publicOrigin ? { publicOrigin } : {}),
    ...ignoredBasePathNotice({ publicUrl, basePath, warning: report.basePathRewriteWarning }) };
  if (themeCount === 1) return result;
  const themePreview = themePreviewExportSize({ report, themeCount });
  reportInfo(`[export] Theme previews: ${themeCount} themes, ${themePreview.additionalPages} additional pages, ${themePreview.sizeMultiplier.toFixed(2)}x export bytes (${themePreview.htmlSizeMultiplier.toFixed(2)}x HTML); shared assets are deduplicated.`);
  return { ...result, themePreview };
}


