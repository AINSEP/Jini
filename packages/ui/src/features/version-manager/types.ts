/**
 * Generic types for the "version list + cached-preview + restore + search"
 * modal shell.
 *
 * Source: a vendored OD file-viewer god-component's version-history modal
 * (`FileVersionManagerModal`). See `packages/ui/archived provenance ledger`'s
 * `html-viewer` classification section for full provenance, the prior
 * (incorrect) "OD-specific, saturated with analytics/deploy" filing this
 * corrects, and what was deliberately left as a host-injected port.
 */

/** How a version came to exist. Kept as a 3-value union matching the
 *  source's actual vocabulary — a host with a different taxonomy widens
 *  this via its own `TVersion` type parameter. */
export type VersionSource = 'ai' | 'manual' | 'restore';

/** The minimal version-record shape every consumer of this feature needs.
 *  A host's real version type (with e.g. author, diff stats, artifact
 *  status) is expected to widen this, not replace it — same "host widens
 *  the minimal shape" story as `ViewerFileRef` in `features/viewer-shell/`. */
export interface VersionRecord {
  id: string;
  version: number;
  /** Epoch millis. */
  createdAt: number;
  current: boolean;
  label?: string | undefined;
  /** The AI-generation prompt that produced this version, if any. */
  prompt?: string | null | undefined;
  source: VersionSource;
  /** Id of the version this one was restored from, if `source === 'restore'`. */
  restoreFromVersionId?: string | null | undefined;
}

/**
 * Identifies which host-side entity's version history this instance shows.
 * Deliberately NOT `ViewerFileRef` (`features/viewer-shell/`'s file-ref
 * shape) — that type carries `size`/`mtime` for cache-busting a *current*
 * file body, neither of which this feature needs; this feature instead
 * needs an opaque host-scoped id (e.g. an OD project id) alongside the
 * file name, a different shape entirely. Reusing `ViewerFileRef` here
 * would force every host to fabricate a fake `size`/`mtime` pair.
 */
export interface VersionManagerFileRef {
  /** Opaque identifier passed through verbatim to the port — e.g. a
   *  project/workspace id. Not interpreted by this feature. */
  scopeId: string;
  name: string;
}

export interface VersionRestoreWarning {
  message: string;
}

export interface VersionRestoreResult<TVersion extends VersionRecord = VersionRecord> {
  /** The version record produced by the restore (a new "restore" version,
   *  in the source's model) — falls back to the version that was restored
   *  from if the port doesn't return one. */
  version?: TVersion;
  /** A non-fatal warning to surface after a restore that otherwise
   *  succeeded (e.g. "a snapshot capture failed") — mirrors the source's
   *  `versionWarning` field. Presence of a warning keeps the modal open
   *  instead of closing it. */
  warning?: VersionRestoreWarning;
}

/** Measured size of the preview canvas the scaled iframe fits inside. */
export interface PreviewCanvasSize {
  width: number;
  height: number;
}
