/**
 * @file Restore-point artifact naming — pure, driver-neutral string construction.
 *
 * Why this is in `core` rather than in the SQLite driver that currently calls it: the naming
 * scheme is a wire contract, not an implementation detail. An operator reading a directory
 * listing, and any future second driver that also writes file artifacts, both need the same
 * scheme. Keeping it here means a second driver cannot drift into a different one.
 *
 * Purity is deliberate — `timestamp` is a parameter rather than a `Date.now()` call inside, so
 * the function is fully deterministic and the driver owns the one impure read.
 */

/**
 * Reduces a caller-supplied identifier to characters that cannot alter a filesystem path.
 *
 * The replaced set is everything outside `[A-Za-z0-9_-]`, which removes `/` and `\` (path
 * traversal / nesting) and `.` (so a `scopeId` of `..` cannot climb a directory). Replacement
 * rather than rejection: a `scopeId` is an internal routing key, and failing a backup because a
 * workspace slug contains a colon would be the worse outcome.
 */
export function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Builds the artifact filename for one restore point.
 *
 * The watermark is embedded in the name, not just tracked in the returned metadata, so an
 * operator sorting a directory can see how far each artifact lags without opening any of them —
 * and so a lost ledger row does not render the files on disk anonymous.
 */
export function restorePointFilename(parts: {
  scopeId: string;
  watermarkAtCapture: number;
  timestamp: number;
  extension?: string;
}): string {
  const extension = parts.extension ?? 'db';
  return `restore-point-${sanitizeForFilename(parts.scopeId)}-wm${parts.watermarkAtCapture}-${parts.timestamp}.${extension}`;
}
