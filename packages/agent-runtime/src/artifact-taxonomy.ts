/** @module artifact-taxonomy
 * Hosts define artifact classification and opaque analytics buckets; product file-kind taxonomy
 * cannot enter the runtime. Artifact persistence belongs to ArtifactStore, not this classifier.
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
