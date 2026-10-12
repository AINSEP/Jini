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
function readPersisted(storageKey: string, storage: Pick<Storage, 'getItem'>): boolean | undefined {
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) return undefined;
    return raw === '1';
  } catch {
    return undefined;
  }
}

function writePersisted(storageKey: string, collapsed: boolean, storage: Pick<Storage, 'setItem'>): void {
  try {
    storage.setItem(storageKey, collapsed ? '1' : '0');
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
 * @param railOverride A boolean controls the displayed rail without changing its saved preference.
 * Null/undefined releases control and reveals the latest preference, including cross-tab updates.
 * @param onCollapsedChange Receives toggle requests only while an override is active. The host must
 * update its override to accept the request; without this callback the controlled rail stays fixed.
 * @returns Displayed collapse state and a toggle (persisted when uncontrolled, requested otherwise).
 * @example useSidebarRail({ storage, events }, { railOverride: true, onCollapsedChange: setOverride })
 *
 * @complexity O(1) — one state read/write per toggle, no derived computation.
 */
export function useSidebarRail(
  { storage, events }: { readonly storage: Pick<Storage, 'getItem' | 'setItem'>; readonly events: Pick<Window, 'addEventListener' | 'removeEventListener'> },
  { storageKey = DEFAULT_SIDEBAR_RAIL_STORAGE_KEY, defaultCollapsed = false, railOverride, onCollapsedChange }: {
    readonly storageKey?: string | undefined;
    readonly defaultCollapsed?: boolean | undefined;
    readonly railOverride?: boolean | null | undefined;
    readonly onCollapsedChange?: ((collapsed: boolean) => void) | undefined;
  } = {},
): SidebarRail {
  const [collapsed, setCollapsed] = useState<boolean>(() => readPersisted(storageKey, storage) ?? defaultCollapsed);

  const toggle = useCallback(() => {
    // A temporary host layout choice must not become the operator's saved preference. Request
    // changes outside the state updater so React's StrictMode replay cannot notify the host twice.
    if (railOverride != null) {
      onCollapsedChange?.(!railOverride);
      return;
    }
    setCollapsed((current) => {
      const next = !current;
      writePersisted(storageKey, next, storage);
      return next;
    });
  }, [storageKey, storage, railOverride, onCollapsedChange]);

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
    events.addEventListener('storage', onStorage);
    return () => events.removeEventListener('storage', onStorage);
  }, [storageKey, defaultCollapsed, events]);

  return { collapsed: railOverride ?? collapsed, toggle };
}
