/**
 * @file The public status and snapshot of a static-site export run. Types only.
 *
 * One neutral owner for the shape the export runner publishes and the admin Import & Export and
 * Deployment screens read, so the two sides cannot drift. Runner-only state (the in-flight slot, the
 * engine and clock ports) stays in `@jini-ai/devops/deploy/site/export-run`.
 */

export type ExportRunStatus = "idle" | "running" | "completed" | "errored";

export interface ExportRunCounts {
  routesSucceeded: number;
  routesFailed: number;
  assetsSucceeded: number;
  assetsFailed: number;
}

/**
 * The full-fidelity, JSON-transportable status of the current/most recent export run. Narrower
 * than the engine's full report on purpose: peak-memory bytes are never echoed back; only counts
 * plus full failure detail, so no route or asset bytes ever cross this boundary.
 */
export interface ExportRunSnapshot {
  status: ExportRunStatus;
  startedAtIso: string | null;
  finishedAtIso: string | null;
  outputDir: string | null;
  /** Present only once `status` is `"completed"`. */
  basePath?: string;
  /** Present only once `status` is `"completed"`. Failed routes or assets make the copy incomplete. */
  ok?: boolean;
  counts?: ExportRunCounts;
  failedRoutes?: { path: string; kind: string; reason: string }[];
  failedAssets?: { url: string; reason: string }[];
  skippedManifestEntries?: { reason: string; detail: string }[];
  unreferencedThemeFiles?: string[];
  droppedReferences?: { page: string; url: string; attribute: string; reason: "not-exported" | "needs-server" }[];
  basePathRewriteWarning?: string;
  /** Present only when `status` is `"errored"` — always a message, never the raw error object. */
  error?: string;
}
