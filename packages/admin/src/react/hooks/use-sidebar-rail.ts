import { useCallback, useEffect, useState } from 'react';

/**
 * @file Desktop sidebar rail-collapse preference (persisted).
 *
 * Deliberately its own hook rather than a `useState` inline in `Sidebar.tsx` — the persistence and
 * the cross-tab sync below are both real behavior worth naming and testing on their own.
 *
 * This is the DESKTOP collapse: a user preference, both states fully usable, persisted so it
 * survives navigation and reload. It is a different mechanism from the mobile off-canvas drawer
 * (`Sidebar`'s `open`/`onClose` props, which the host owns): that one is session-only overlay state
 * that *should* reset on every navigation, where resetting this preference on navigation would be
 * the bug the original design called out — a collapse that resets on every page change is worse
 * than no collapse. Driving both off one boolean would make each navigation either fight the user's
 * rail choice or leave the phone drawer stuck open; they are two pieces of state on purpose.
 */

/** Storage key used when the host does not supply one. Namespaced to this package so two products
 *  embedding the admin under one origin do not silently share a preference.
 *
 *  A host migrating from its own pre-existing key should pass that key to `useSidebarRail` rather
 *  than accept this default — switching keys reads as "every operator's collapsed rail sprang back
 *  open", which is indistinguishable from a regression. */
export const DEFAULT_SIDEBAR_RAIL_STORAGE_KEY = 'jini-admin-sidebar-rail-collapsed';

/**
 * Reads the persisted value once, defensively — `localStorage` can throw in a locked-down
 * embed/iframe context (Safari private mode historically, some hardened browser configs), and a
 * first-run visitor has no key at all.
 *
 * Returns `undefined` for "no stored preference" rather than collapsing it into `false`. That
 * distinction is load-bearing once a host can default to collapsed (`defaultCollapsed` below): if
 * absent and `'0'` both read as `false`, they behave identically under an expanded default but
 * diverge sharply under a collapsed one — an operator who deliberately expanded the rail would find
 * it collapsed again on every reload, because their explicit `'0'` would be indistinguishable from
 * never having chosen. A stored value always wins over the default; only its absence defers.
 */
function readPersisted(storageKey: string): boolean | undefined {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return undefined;
    return raw === '1';
  } catch {
    return undefined;
  }
}

function writePersisted(storageKey: string, collapsed: boolean): void {
  try {
    localStorage.setItem(storageKey, collapsed ? '1' : '0');
  } catch {
    // Best-effort — a user who cannot persist the preference still gets a working toggle for the
    // current tab; failing loudly here would break the rail over a non-essential preference write.
  }
}

export interface SidebarRail {
  collapsed: boolean;
  toggle: () => void;
}

/**
 * @param storageKey `localStorage` key to persist under. Defaults to
 * {@link DEFAULT_SIDEBAR_RAIL_STORAGE_KEY}. Read on first render only — changing it on a mounted
 * hook re-points the *writes* and the cross-tab listener, but does not re-read the new key's value,
 * since a key that changes mid-session is not a case any host has.
 *
 * @param defaultCollapsed State for a visitor with **no stored preference**. Defaults to `false`
 * (expanded), which is what every existing host gets by not passing it. A stored preference always
 * takes precedence — see {@link readPersisted} for why absent and `'0'` must stay distinguishable.
 *
 * @complexity O(1) — one state read/write per toggle, no derived computation.
 */
export function useSidebarRail(
  storageKey: string = DEFAULT_SIDEBAR_RAIL_STORAGE_KEY,
  defaultCollapsed = false,
): SidebarRail {
  const [collapsed, setCollapsed] = useState<boolean>(() => readPersisted(storageKey) ?? defaultCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      writePersisted(storageKey, next);
      return next;
    });
  }, [storageKey]);

  /** Cross-tab sync: two admin tabs open side by side should agree on the rail state rather than
   *  silently diverging the moment either one is toggled. */
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== storageKey) return;
      // `newValue` is null when the key is REMOVED (another tab clearing storage), which is the
      // same "no stored preference" state `readPersisted` defers on — so fall back to the host's
      // default rather than hard-coding expanded, or a clear in one tab would silently override a
      // collapsed-by-default host in every other one.
      setCollapsed(event.newValue === null ? defaultCollapsed : event.newValue === '1');
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey, defaultCollapsed]);

  return { collapsed, toggle };
}
