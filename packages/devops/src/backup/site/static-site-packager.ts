import { SiteShareRefusal } from "./share-refusal.js";
import { prepareStaticReport, type ExportReport } from "./static-copy.js";
import { LANDING_FILE } from "./static-download-landing.js";
import { staticDownloadLayout, type StaticDownloadHost } from "./static-download-layout.js";

/** `source-control`'s `StaticSiteIdentity` and `StaticSitePackage`, written out so `site-backup` does not import the
 *  port it implements. Composition checks the fit where it assigns this packager (`deps.ts:2712`, `publish-export.ts:239`). */
type SiteIdentity = { readonly name: string; readonly slug: string; readonly theme: string; readonly themeId: string };
type SitePackage =
  | { readonly ok: true; readonly files: { readonly path: string; readonly data: string | Buffer }[] }
  | { readonly ok: false; readonly kind: "destination-collision"; readonly message: string };

/**
 * @file Implements `source-control`'s `StaticSitePackagerPort`: the same portable static copy the
 * backup/share download builds, flattened into commit files. Lives beside the code it calls so
 * `source-control` never imports `site-backup`.
 */

/** Active-theme portable packaging: the static-download layout, destination paths claimed (a collision or alias refuses). `site` is the
 *  identity pinned BEFORE rendering, so an owner changing the live selection mid-export cannot split it. */
function packageSite({ report, site, deps }: { report: ExportReport; site: SiteIdentity; deps: StaticSitePackagerDeps }, _options: Record<string, never> = {}): SitePackage {
  try {
    const rendered = prepareStaticReport({ report, sourceEdits: deps.host.sourceEdits });
    const files = staticDownloadLayout({ host: deps.host, copy: { files: rendered.files, publicOrigin: rendered.publicOrigin, siteSlug: site.slug, themeId: site.themeId,
      metadata: { theme: site.theme, routes: rendered.routes, redirectFiles: rendered.redirectFiles, failed: rendered.failed, skipped: rendered.skipped },
      readme: { name: site.name } } }).map(file => ({ path: file.path, data: file.content }));
    deps.claimArchivePaths({ entries: files }, { manifest: false });
    return { ok: true, files };
  } catch (error) {
    if (error instanceof SiteShareRefusal && /collision|aliases/i.test(error.message)) {
      return { ok: false, kind: "destination-collision", message: error.message };
    }
    throw error;
  }
}

/** Host values the packager cannot own: the download layout's host policy and the archive-wide path claim (a collision or alias refuses). */
export interface StaticSitePackagerDeps {
  host: StaticDownloadHost;
  claimArchivePaths: (required: { entries: readonly { path: string }[] }, optional: { manifest: boolean }) => void;
}

/** Stateless: one instance serves every commit and preview. */
export function createStaticSitePackager(deps: StaticSitePackagerDeps, _optional: Record<string, never> = {}): {
  readonly entryFile: string;
  readonly packageSite: (required: { report: ExportReport; site: SiteIdentity }, optional?: Record<string, never>) => SitePackage;
} {
  return { entryFile: LANDING_FILE, packageSite: ({ report, site }, options = {}) => packageSite({ report, site, deps }, options) };
}
