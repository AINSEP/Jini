/**
 * @file A persisted light / system / dark preference, applied to a root element. Storage, its key,
 * the default, the OS media query and the root are all the host's (injected).
 */
import { useEffect, useState } from 'react';
import type { ColorSchemePreference } from '../../core/theme/types.js';
import { resolveColorScheme } from '../../theme/color-scheme.js';

/** The slice of `Storage` the preference is kept in. */
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The OS dark-mode query, with change events so `system` can follow it. */
export type ColorSchemeMediaPort = (query: string) => Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;

/** The element whose `data-theme` and `color-scheme` carry the resolved scheme. */
export interface ThemeRoot { dataset: DOMStringMap; style: { colorScheme: string } }

export interface ThemePreferencePorts {
  storage: PreferenceStorage;
  storageKey: string;
  /** Used when nothing (or something unrecognised) is stored. */
  defaultPreference: ColorSchemePreference;
  matchMedia: ColorSchemeMediaPort;
  root: ThemeRoot;
}
// Every port is an effect dependency, so the host passes stable references (module constants or a
// `useMemo`): a fresh `matchMedia` closure per render would re-subscribe on every render.

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The stored preference when it is one of the three, else the host's default. */
export function readStoredPreference({ storage, storageKey, defaultPreference }: Pick<ThemePreferencePorts, 'storage' | 'storageKey' | 'defaultPreference'>, _optional = {}): ColorSchemePreference {
  const stored = storage.getItem(storageKey);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : defaultPreference;
}

/**
 * `data-theme` on the root element is always the *resolved* value — `light` or
 * `dark`, never `system`. That keeps the stylesheet to a single dark block instead
 * of repeating the whole palette once for the explicit choice and again inside a
 * `prefers-color-scheme` query, which is the usual way these two drift apart.
 */
export function useThemePreference(ports: ThemePreferencePorts, _optional = {}): [ColorSchemePreference, (next: ColorSchemePreference) => void] {
  const { storage, storageKey, matchMedia, root } = ports;
  const [preference, setPreference] = useState<ColorSchemePreference>(() => readStoredPreference(ports));

  useEffect(() => {
    const media = matchMedia(DARK_QUERY);

    const apply = () => {
      const resolved = resolveColorScheme({ preference }, { matchMedia: () => media });
      root.dataset['theme'] = resolved;
      // Tells the engine which form controls and scrollbars to draw.
      root.style.colorScheme = resolved;
    };

    apply();
    storage.setItem(storageKey, preference);

    // Only `system` tracks the OS; an explicit choice must not move underneath you.
    if (preference !== 'system') return undefined;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference, storage, storageKey, matchMedia, root]);

  return [preference, setPreference];
}
