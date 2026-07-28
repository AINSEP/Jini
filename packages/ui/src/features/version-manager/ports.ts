import type { VersionManagerFileRef, VersionRecord, VersionRestoreResult } from './types.js';

/**
 * The transport seam this feature needs from a host. All four OD-specific
 * coupling points the classification found (the version-list fetch, the
 * per-version content fetch, the restore call, and the deck/base-href
 * preview-option resolution) land here as one interface.
 */
export interface VersionManagerPort<TVersion extends VersionRecord = VersionRecord> {
  /** Fetches the full version list for `fileRef`, newest-or-oldest-first
   *  (this feature sorts it either way via `rules.ts`'s
   *  `sortVersionsDescending`). Returns `null` on failure — the hook turns
   *  that into a load-error message it displays, matching the source. */
  listVersions(fileRef: VersionManagerFileRef): Promise<TVersion[] | null>;

  /** Fetches one version's full content. Returns `null` if the version's
   *  content could not be loaded. */
  fetchVersionContent(fileRef: VersionManagerFileRef, versionId: string): Promise<string | null>;

  /** Restores `version` as the file's current content. Returns `null` on
   *  outright failure; a non-null result may still carry a `warning` for a
   *  restore that otherwise succeeded (see `VersionRestoreResult`). */
  restoreVersion(
    fileRef: VersionManagerFileRef,
    version: TVersion,
  ): Promise<VersionRestoreResult<TVersion> | null>;

  /**
   * Turns raw version content into whatever a host wants to mount in the
   * preview `srcDoc`. This is deliberately NOT a sandboxed-iframe-builder
   * port — the classification found the source's own `buildSrcdoc`/
   * `fileVersionPreviewOptions` (deck-sniffing, base-href resolution) is
   * shared infrastructure the eventual `@jini-ai/renderers-react` sandbox
   * core should own, which does not exist yet (see
   * `packages/ui/source-map.md`'s `html-viewer` section). A host with a
   * real sandbox core implements this by delegating to it; a host without
   * one can just return `content` unchanged for a plain, unsandboxed
   * preview. Either way this feature stays decoupled from that
   * not-yet-built core.
   */
  resolvePreviewDocument(fileRef: VersionManagerFileRef, content: string): string;

  /** Opens a version's content in a new tab/window. Optional — a host that
   *  doesn't support this can omit it; the "open in new tab" action is
   *  hidden when absent. */
  openPreviewInNewTab?(fileRef: VersionManagerFileRef, content: string, title: string): void;
}

/** The one browser API this feature needs directly (copying the
 *  generating-prompt text) — same minimal shape as
 *  `features/viewer-shell/`'s `ViewerClipboardPort`, kept as an
 *  independent type so this feature has no compile-time dependency on
 *  viewer-shell's `ports.ts` (only its React-layer `useCopyToClipboard`
 *  hook/dependency-binding, which structurally satisfies this interface). */
export interface VersionManagerClipboardPort {
  copyText(text: string): Promise<boolean>;
}

export interface VersionManagerDependencies<TVersion extends VersionRecord = VersionRecord> {
  versions: VersionManagerPort<TVersion>;
  clipboard: VersionManagerClipboardPort;
}
