import type { ViewportPreset } from '../viewer-shell/index.js';
import type { PreviewCanvasSize, VersionRecord, VersionSource } from './types.js';

/** Formats an epoch-millis timestamp for the version list/header, using the
 *  host's locale. Falls back to the runtime default locale formatting if
 *  the given locale tag is invalid — matches the source's own try/catch
 *  fallback rather than throwing on a bad locale string. */
export function formatVersionDateTime(value: number | undefined, locale: string): string {
  const date = new Date(typeof value === 'number' && Number.isFinite(value) ? value : Date.now());
  try {
    return date.toLocaleString(locale, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toLocaleString();
  }
}

/** Plain-English label for a version's `source` — the caller wraps this in
 *  `t()` at the call site (the English string is the translation key
 *  convention this package uses; see `packages/ui/README.md`). */
export function versionSourceLabel(source: VersionSource): string {
  if (source === 'manual') return 'Manual';
  if (source === 'restore') return 'Restored';
  return 'AI generated';
}

/** CSS class suffix for a version's source badge. */
export function versionSourceClassName(source: VersionSource): string {
  if (source === 'manual') return 'manual';
  if (source === 'restore') return 'restore';
  return 'ai';
}

/** Newest-first order, matching the source's own list ordering. */
export function sortVersionsDescending<TVersion extends VersionRecord>(
  versions: readonly TVersion[],
): TVersion[] {
  return [...versions].sort((a, b) => b.version - a.version);
}

/** Builds an id → version lookup map, used for resolving `restoreFromVersionId`
 *  references and for O(1) selection lookups. */
export function buildVersionIndex<TVersion extends VersionRecord>(
  versions: readonly TVersion[],
): Map<string, TVersion> {
  const map = new Map<string, TVersion>();
  for (const version of versions) map.set(version.id, version);
  return map;
}

/** The version a given version was restored from, if any and if still
 *  present in the current list. */
export function restoredFromVersion<TVersion extends VersionRecord>(
  version: TVersion | null | undefined,
  versionById: ReadonlyMap<string, TVersion>,
): TVersion | null {
  if (!version?.restoreFromVersionId) return null;
  return versionById.get(version.restoreFromVersionId) ?? null;
}

/** Resolves the effective "selected" version: an explicit selection if one
 *  is set and still present, else the version flagged `current`, else the
 *  first (newest) version, else `null` for an empty list. Matches the
 *  source's own selection-fallback chain exactly. */
export function resolveSelectedVersion<TVersion extends VersionRecord>(
  versions: readonly TVersion[],
  versionById: ReadonlyMap<string, TVersion>,
  selectedId: string | null,
): TVersion | null {
  if (selectedId) {
    const explicit = versionById.get(selectedId);
    if (explicit) return explicit;
  }
  return versions.find((version) => version.current) ?? versions[0] ?? null;
}

/** Should the search box be shown at all — only once the list is long
 *  enough to need filtering. */
export function shouldShowVersionSearch(versionCount: number, threshold: number): boolean {
  return versionCount > threshold;
}

/**
 * Filters `versions` by a case-insensitive substring match against a
 * caller-supplied per-version description string. Kept hook-free (no
 * `useT()`/locale here) per this package's i18n convention — the caller
 * builds `describe()` using its own `t()`/locale and the other pure
 * helpers above (`versionSourceLabel`, `formatVersionDateTime`,
 * `restoredFromVersion`), then this function only does the filtering.
 */
export function filterVersionsBySearch<TVersion extends VersionRecord>(
  versions: readonly TVersion[],
  search: string,
  describe: (version: TVersion) => string,
): TVersion[] {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return [...versions];
  return versions.filter((version) => describe(version).toLowerCase().includes(normalized));
}

export interface RestoreDisabledInput<TVersion extends VersionRecord> {
  selectedVersion: TVersion | null;
  restoring: boolean;
  loadingContent: boolean;
  selectedContentMatchesVersion: boolean;
}

/** Whether the restore action should be disabled — mirrors the source's
 *  `restoreDisabled` derivation exactly (no restoring the version already
 *  current, no restoring mid-fetch, no restoring stale/mismatched content). */
export function isRestoreDisabled<TVersion extends VersionRecord>(
  input: RestoreDisabledInput<TVersion>,
): boolean {
  const { selectedVersion, restoring, loadingContent, selectedContentMatchesVersion } = input;
  if (!selectedVersion || selectedVersion.current) return true;
  return restoring || loadingContent || !selectedContentMatchesVersion;
}

/** Whether the currently-loaded preview content actually corresponds to the
 *  currently-selected version (guards against acting on stale content
 *  during a version switch's in-flight fetch). */
export function contentMatchesSelection(
  selectedId: string | null,
  selectedContentVersionId: string | null,
  selectedContent: string | null,
): boolean {
  return Boolean(selectedId && selectedContentVersionId === selectedId && selectedContent);
}

/** Finds a viewport preset by id, falling back to the first preset in the
 *  list (matches `ViewportSwitcher`/`ViewportToggleGroup`'s own fallback
 *  behavior in `features/viewer-shell/`). */
export function findViewportPreset(presets: readonly ViewportPreset[], id: string): ViewportPreset {
  return presets.find((preset) => preset.id === id) ?? presets[0]!;
}

/**
 * How much a fixed-size viewport preset (tablet/mobile — `width`/`height`
 * both non-null) must be scaled down to fit inside the measured canvas.
 * A preset with `width === null` ("no fixed frame", e.g. "desktop") is
 * never scaled by this function — it returns `previewScale` unchanged,
 * generalizing the source's `viewport === 'desktop'` special case to any
 * preset that opts out of fixed framing.
 */
export function effectivePreviewScale(
  preset: ViewportPreset,
  previewScale: number,
  canvasSize: PreviewCanvasSize | undefined,
  canvasPadding: number,
): number {
  if (!preset.width || !preset.height) return previewScale;
  if (!canvasSize || !canvasSize.width || !canvasSize.height) return previewScale;
  const availableWidth = Math.max(1, canvasSize.width - canvasPadding);
  const availableHeight = Math.max(1, canvasSize.height - canvasPadding);
  const fitScale = Math.min(1, availableWidth / preset.width, availableHeight / preset.height);
  return Math.min(previewScale, fitScale);
}

/** CSS custom properties driving the fixed-size preview frame's dimensions
 *  and scale. Returns an empty object for a "no fixed frame" preset (the
 *  frame just fills its container at 100%, no custom properties needed). */
export function previewViewportStyle(
  preset: ViewportPreset,
  effectiveScale: number,
  previewScale: number,
): Record<string, string | number> {
  if (!preset.width) return {};
  return {
    '--preview-viewport-width': `${preset.width}px`,
    '--preview-viewport-height': `${preset.height}px`,
    '--preview-scale': effectiveScale,
    '--preview-user-scale': previewScale,
  };
}

/** Inline style for the scaled shell wrapping the preview iframe. A
 *  "no fixed frame" preset scales the whole shell directly by
 *  `previewScale`; a fixed-size preset instead sizes to the CSS custom
 *  properties `previewViewportStyle` sets and scales by the *fitted*
 *  `--preview-scale` variable, matching the source's two-mode behavior. */
export function previewScaleShellStyle(
  preset: ViewportPreset,
  previewScale: number,
): Record<string, string> {
  if (!preset.width) {
    return {
      width: `${100 / previewScale}%`,
      height: `${100 / previewScale}%`,
      transform: `scale(${previewScale})`,
      transformOrigin: '0 0',
    };
  }
  return {
    width: 'var(--preview-viewport-width)',
    height: 'var(--preview-viewport-height)',
    transform: 'scale(var(--preview-scale, 1))',
    transformOrigin: '0 0',
  };
}
