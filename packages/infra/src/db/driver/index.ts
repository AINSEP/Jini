/** Deprecated compatibility adapter: import @jini-ai/db/core directly. Removed after one release. */
import { restorePointFilename as filename, sanitizeForFilename as sanitize } from "@jini-ai/db/core";
import type { RestorePointNamingPort } from "../core/index.js";

// Bind the existing owner without wrapping it, preserving function identity and the wire format.
const naming: RestorePointNamingPort = { restorePointFilename: filename, sanitizeForFilename: sanitize };
export const { restorePointFilename, sanitizeForFilename } = naming;
export type { DbOpsPort, RestoreCapability, RestoreCostClass, RestoreKind, RestorePoint, WatermarkReader } from "@jini-ai/db/core";
