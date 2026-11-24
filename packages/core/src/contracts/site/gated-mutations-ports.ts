/**
 * @file The dialect-neutral restore-point contract a host's gated-mutation flow captures before a
 * destructive change. Types only: the host keeps the per-dialect adapters and the watermark mirror.
 */

/**
 * A site's restore-point mechanism, evaluated per dialect (SQLite: always cheap file-snapshot;
 * Postgres: dump/blue-green tooling, or an externally-managed PITR system, or nothing at all).
 */
export interface RestoreCapability {
  costClass: "cheap" | "expensive" | "unavailable";
  kind: "file-snapshot" | "logical-dump" | "external";
}

/** Dialect-neutral restore-point capability surface (SPEC-016 C-007). */
export interface DbOpsPort {
  /** Pure, side-effect-free static check of what this site's restore mechanism can do. */
  getCapabilities(): Promise<{ restorePoint: RestoreCapability }>;
  /**
   * Captures a real restore-point artifact, stamped with the watermark value at capture time.
   * `directory` writes the artifact there instead of the adapter's default (beside the live
   * database): a site export passes a private temp folder so it never writes into source-site storage.
   */
  captureRestorePoint(required: { scopeId: string }, optional?: { directory?: string }): Promise<{ artifactRef: string; watermarkAtCapture: number }>;
  /**
   * Physically restores the live database from a previously-captured artifact (ADR-045 §3
   * restore ceremony, closing the "ledger-only" disclosed gap). A real (SQLite) adapter performs
   * an atomic file swap and reports `restartRequired: true` — the running process keeps its own
   * open file handle to the now-unlinked old data until it restarts and reopens the path fresh.
   * A test/dev double with no real file to restore into reports `restartRequired: false`.
   */
  restoreFromArtifact(required: { artifactRef: string }): Promise<{ restartRequired: boolean }>;
}
