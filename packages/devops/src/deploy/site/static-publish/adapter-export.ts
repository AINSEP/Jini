import path from 'node:path';
import type { DeployFile, DeployTarget } from '../../index.js';
import type { StaticPublishDeps, StaticPublishInput } from './adapter.js';
import type { StaticPublishOutcome } from './types.js';
import type { ExportReport as BaseExportReport } from '../../../static-export/contracts.js';
type ExportReport = BaseExportReport & { consentWarning?: string };

/** Best-effort cleanup of one run's isolated export directory (see {@link publishOutputDir}'s own
 *  doc). Safe to call once `exportSiteBound` has returned or thrown: every byte `publishStaticSite`
 *  still needs travels through `report.routes.succeeded`/`report.assets.succeeded`'s own `data`
 *  fields (captured in memory at write time — `site-exporter.ts`'s own "reachable as DATA" header),
 *  never by re-reading this directory, so removing it here cannot affect anything downstream. Never
 *  throws: a cleanup failure (a stray permission error, a file another process still holds open)
 *  must not turn an otherwise-successful publish into a reported failure — the same best-effort,
 *  disclosed-rather-than-silent posture `publish-run.ts`'s `recordHistoryIfPublished` already
 *  documents for an analogous non-essential side effect.
 * @complexity O(n) in the (typically small) exported file count — a recursive directory removal. */
function cleanupPublishRunDir({ deps, outputDir }: { deps: StaticPublishDeps; outputDir: string }, _options = {}): void {
  try {
    deps.rmSync(outputDir, { recursive: true, force: true });
  } catch {
    // Swallowed deliberately — see this function's own doc.
  }
}

/** Normalizes an `ExportedRoute`/`ExportedAsset`'s `outputFile` (already deploy-relative, per that
 *  interface's own doc) to forward slashes — `path.relative` uses the platform separator, and every
 *  deploy target in `@jini-ai/devops` treats `DeployFile.file` as a literal repo/deployment path,
 *  where a stray backslash on a Windows host would be be a wrong path, not a normalized one.
 *
 *  `contentType` also accepts `null` here (as well as the caller simply omitting it): `ExportedRoute`/
 *  `ExportedAsset` carry it as `string | null` because a fetched response can genuinely have no
 *  `Content-Type` header — see that interface's own doc. `DeployFile.contentType` has no concept of
 *  `null`, so both "absent" states collapse to "omit the field" the same way here, at the one place
 *  that actually needs the narrower `string | undefined` shape. */
export function toDeployFile(entry: { outputFile: string; data: string | Buffer; contentType?: string | null }): DeployFile {
  return {
    file: entry.outputFile.split(path.sep).join("/"),
    data: entry.data,
    ...(entry.contentType !== undefined && entry.contentType !== null ? { contentType: entry.contentType } : {}),
  };
}

/**
 * Runs `input.exportSiteBound` for this one publish run into `outputDir`, translating both a thrown
 * export failure and a report carrying a failed route/asset into {@link publishStaticSite}'s own
 * `{ok:false, code:"EXPORT_FAILED"}` channel. Cleans up the run's output directory in every case
 * (thrown, failed-report, or success) — see {@link cleanupPublishRunDir}'s own doc for why the
 * directory is safe to remove immediately once this call has produced its in-memory `report`.
 *
 * Checks BOTH `routes.failed` and `assets.failed` (HIGH audit finding, 2026-08-19 Codex sol bug/
 * architecture audit) — this used to check only `routes.failed`, so a page could export fine while
 * its own stylesheet or hero image 404s and publishing would still report success. See
 * `firstExportFailure`'s own doc (`#src/features/site-export/export-failure-summary`) for the shared check both this
 * function and `commit-site.ts`'s `commitSiteToSourceControl` now use.
 */
export async function runExportForPublish(
  { deps, input, outputDir, basePath, target }: {
    deps: StaticPublishDeps;
    input: StaticPublishInput;
    outputDir: string;
    basePath: string | undefined;
    target: DeployTarget;
  },
  _options = {},
): Promise<{ ok: true; report: ExportReport } | { ok: false; outcome: StaticPublishOutcome }> {
  let report: ExportReport;
  try {
    const publicUrl = await target.resolvePublicUrl?.({ projectName: input.projectName }, {});
    // Render for the destination, never the local site's saved domain. A target that cannot name its
    // URL gets the domainless copy (no canonical, sitemap or feed), the same as a download without one.
    report = await input.exportSiteBound({ outputDir, clean: true, ...(basePath !== undefined ? { basePath } : {}), ...(publicUrl ? { publicUrl } : {}) });
  } catch (err) {
    cleanupPublishRunDir({ deps, outputDir });
    return {
      ok: false,
      outcome: {
        ok: false,
        code: "EXPORT_FAILED",
        message: `export failed before publishing could start: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
  cleanupPublishRunDir({ deps, outputDir });

  const failure = deps.firstExportFailure(report);
  if (failure) {
    return {
      ok: false,
      outcome: {
        ok: false,
        code: "EXPORT_FAILED",
        message: `refused to publish: ${failure.count} ${failure.kind}(s) failed to export (first: '${failure.identifier}' — ${failure.reason}). Call deployment_diagnose_static_export for the full list.`,
      },
    };
  }
  return { ok: true, report };
}

/** Maps a successful export `report` to the `DeployFile[]` a target's `publish()` takes. A host's
 *  own extra files (a header config, a marker file) are its module's job, never this one's.
 *  @complexity O(n) in the exported route + asset count. */
export function buildDeployFilesForPublish(report: ExportReport): DeployFile[] {
  return [...report.routes.succeeded.map(toDeployFile), ...report.assets.succeeded.map(toDeployFile)];
}

