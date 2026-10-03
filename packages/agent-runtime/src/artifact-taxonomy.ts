/**
 * @module artifact-taxonomy
 *
 * Port replacing the classification half of OD's
 * `runtimes/runs/run-artifacts.ts` (`isArtifactPath`, `isDesignSystemFile`,
 * `isPreviewModulePath`, `didRunCreateDesignSystemFile`,
 * `countDesignSystemPreviewModules`). That file's real behavior is entirely
 * OD-product classification (HTML-prototype/SVG/design-system-file
 * taxonomy feeding PostHog `run_finished.artifact_count` /
 * `design_system_created` analytics) plus OD-specific imports into OD's own
 * analytics-contracts and question-form-detection modules — none of it is
 * ported.
 *
 * Per r1b §1b, only the taxonomy/classification *interface* belongs to
 * this package. `ArtifactTaxonomy`'s companion `ArtifactStore` (actual
 * read/write persistence) is explicitly a later storage/sqlite task's
 * concern — not defined here.
 */
export interface ArtifactTaxonomy {
  /** Does this file path count as a user-facing artifact? (OD: html/svg/prototype/live-artifact.) */
  isArtifact(requiredArgs: { path: string }): boolean;
  /** Optional finer buckets a host tracks for analytics; the engine treats all buckets as opaque. */
  classify?(requiredArgs: { path: string }): string | null;
}

/** Classifies nothing as an artifact and provides no finer buckets — a safe default until a host supplies its own taxonomy. */
export const noopArtifactTaxonomy: ArtifactTaxonomy = {
  isArtifact: () => false,
};
