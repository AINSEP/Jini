/** One ordering owner for the "live views" menu preference consumed by settings and live-view admission. */
import { useEffect, useState } from 'react';

/** The host's allowed range for the live-view limit, and the shipped default. */
export interface LiveViewBounds {
  readonly min: number;
  readonly max: number;
  readonly fallback: number;
}

/** The preload bridge slice this hook drives; either method may be missing on an older preload. */
export interface LiveViewPreferenceBridge {
  getMaximumLiveSiteViews?(): Promise<unknown>;
  onMaximumLiveSiteViewsChanged?(required: { listener: (saved: unknown) => void }): () => void;
}

/** A positive saved whole number clamped to `bounds`, otherwise the shipped default. */
export function liveViewLimit({ value, bounds }: { value: unknown; bounds: LiveViewBounds }, _options = {}): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(bounds.max, Math.max(bounds.min, value)) : bounds.fallback;
}

/**
 * A change event or local save supersedes the initial IPC snapshot. O(1) per update.
 * @param required.getBridge the host's bridge lookup; pass a stable function.
 * @param required.bounds the host's range and default; pass a module-level constant.
 */
export function useSiteViewPreference({ getBridge, bounds }: {
  getBridge: () => LiveViewPreferenceBridge | undefined;
  bounds: LiveViewBounds;
}, _options = {}) {
  const [value, setValue] = useState<number>(bounds.fallback);
  const [ordering] = useState(() => ({ changed: false }));
  useEffect(() => {
    const bridge = getBridge();
    let active = true;
    ordering.changed = false;
    void bridge?.getMaximumLiveSiteViews?.().then(
      saved => { if (active && !ordering.changed) setValue(liveViewLimit({ value: saved, bounds })); },
      () => undefined,
    );
    const off = bridge?.onMaximumLiveSiteViewsChanged?.({ listener: saved => {
      if (!active) return;
      ordering.changed = true;
      setValue(liveViewLimit({ value: saved, bounds }));
    } });
    return () => { active = false; off?.(); };
  }, [getBridge, bounds, ordering]);
  return { value, setValue: ({ next }: { next: number }) => { ordering.changed = true; setValue(next); } };
}
