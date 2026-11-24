/**
 * @file Names of the static-site export routes' run status and slim snapshot (trigger + poll) that
 * both the Import & Export and Deployment screens read. The shapes are owned by the neutral Core
 * contract the export runner publishes, so neither screen nor the runner redeclares them.
 */
import type { ExportRunSnapshot, ExportRunStatus } from "@jini-ai/core/contracts/site/export-run";

/** The server export route's `ExportRunStatus`. */
export type AdminExportRunStatus = ExportRunStatus;

/** The server export route's `ExportRunSnapshot` — a slim, JSON-safe summary rather than the full
 *  `ExportReport` (no route/asset bytes ever cross this boundary). */
export type AdminExportRunSnapshot = ExportRunSnapshot;
