import type { DeckSlideState } from './types.js';

/** Whether a "previous slide" action is currently meaningful. `null` state (no deck bridge seen yet, or a 1-slide/non-deck document) disables navigation. */
export function canGoPrev({ state }: { state: DeckSlideState | null }, _optional: Record<string, never> = {}): boolean {
  return state !== null && state.active > 0;
}

/** Whether a "next slide" action is currently meaningful. */
export function canGoNext({ state }: { state: DeckSlideState | null }, _optional: Record<string, never> = {}): boolean {
  return state !== null && state.active < state.count - 1;
}

/** Human-readable "N / total" counter, or `null` when there is no deck state yet. */
export function slideCounterLabel({ state }: { state: DeckSlideState | null }, _optional: Record<string, never> = {}): string | null {
  if (state === null) return null;
  return `${state.active + 1} / ${state.count}`;
}

/** Clamp a requested slide index into the valid `[0, count-1]` range (or `0` for an empty/unknown-count deck). */
export function clampSlideIndex({ index, count }: { index: number; count: number }, _optional: Record<string, never> = {}): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

/**
 * Validate an inbound deck-state message payload. Message data crosses a
 * `postMessage` boundary from sandboxed (and possibly hostile or malformed)
 * content, so this never trusts the shape — only a message with finite,
 * non-negative numeric `active`/`count` (and `active` within range) becomes
 * real state.
 */
export function parseDeckStateMessage({ data }: { data: unknown }, _optional: Record<string, never> = {}): DeckSlideState | null {
  if (typeof data !== 'object' || data === null) return null;
  const { active, count } = data as Record<string, unknown>;
  if (typeof active !== 'number' || typeof count !== 'number') return null;
  if (!Number.isFinite(active) || !Number.isFinite(count)) return null;
  if (active < 0 || count < 0 || active > count) return null;
  return { active, count };
}

/** Whether `zoom` is one of the host's configured preset levels (used to render the active checkmark). */
export function isKnownZoomLevel({ zoom, levels }: { zoom: number; levels: readonly number[] }, _optional: Record<string, never> = {}): boolean {
  return levels.includes(zoom);
}

/** Convert a whole-number zoom percentage into a CSS transform scale factor. */
export function zoomToScale({ zoom }: { zoom: number }, _optional: Record<string, never> = {}): number {
  return zoom / 100;
}
