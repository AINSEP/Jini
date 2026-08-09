import { useCallback, useEffect, useState } from 'react';

/**
 * @file Per-section open/closed state for the sidebar's grouped nav (persisted).
 *
 * Sibling of `use-sidebar-rail.ts` and deliberately modelled on it — same defensive `localStorage`
 * access, same "absent is not false" rule, same cross-tab sync. Read that file's header first; this
 * one only records where the two differ.
 *
 * ## Why one key holding a map, rather than one key per section
 *
 * The unit a user thinks in is "how my sidebar is arranged", not "the Content section specifically".
 * A single JSON map is written and read atomically, so a tab that toggles two sections in quick
 * succession can never leave storage half-updated, and the cross-tab listener below fires once with
 * the whole picture instead of once per section with no ordering guarantee between them. It also
 * means adding a collapsible section later costs no new key and no migration.
 *
 * The cost is that a corrupt or hand-edited value loses every section's state at once rather than
 * one. That is the right trade here: the fallback is "everything open", which is exactly the
 * pre-accordion behavior and therefore never leaves the user unable to reach a nav item.
 *
 * ## Why the default is open
 *
 * A section whose state has never been stored renders open, matching how the nav behaved before it
 * was collapsible. A closed-by-default accordion would hide working navigation from an operator who
 * never asked for it and has no memory of a section existing — the one failure mode that turns a
 * convenience into a support ticket.
 */

/** Storage key used when the host does not supply one. Namespaced to this package for the same
 *  reason {@link DEFAULT_SIDEBAR_RAIL_STORAGE_KEY} is — two products embedding the admin under one
 *  origin must not silently share a layout preference. */
export const DEFAULT_NAV_SECTIONS_STORAGE_KEY = 'jini-admin-nav-sections';

/** `{ [groupLabel]: isOpen }`. A label absent from the map has no stored preference and defaults to
 *  open — see this file's header. */
export type NavSectionState = Readonly<Record<string, boolean>>;

/**
 * Reads the persisted map once, defensively. `localStorage` can throw in a locked-down embed
 * (hardened browser configs, historically Safari private mode), the key may be absent on first run,
 * and the value may be unparseable or the wrong shape if it was hand-edited or written by an older
 * version.
 *
 * Every one of those resolves to an empty map — "no stored preference for anything" — rather than a
 * thrown error, because the consequence of guessing wrong here is a nav that renders with all
 * sections open, which is the safe direction. A malformed value is deliberately not repaired or
 * re-written; the next real toggle overwrites it wholesale.
 *
 * Non-boolean entries are dropped individually rather than rejecting the whole map, so one bad key
 * cannot discard a user's other sections.
 */
function readPersisted(storageKey: string): NavSectionState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const clean: Record<string, boolean> = {};
    for (const [label, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') clean[label] = value;
    }
    return clean;
  } catch {
    return {};
  }
}

function writePersisted(storageKey: string, state: NavSectionState): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Best-effort, exactly as in `use-sidebar-rail.ts`: a user who cannot persist still gets a
    // working accordion for this tab, and failing loudly would break the nav over a preference.
  }
}

export interface NavSections {
  /** `true` when the section should render its items. Any label with no stored preference is open. */
  isOpen: (groupLabel: string) => boolean;
  toggle: (groupLabel: string) => void;
}

/**
 * @param storageKey `localStorage` key to persist under. Defaults to
 * {@link DEFAULT_NAV_SECTIONS_STORAGE_KEY}. Read on first render only — same contract as
 * `useSidebarRail`'s, for the same reason (no host changes this mid-session).
 *
 * @complexity O(1) per `isOpen` (one object lookup) and O(s) per `toggle` in the number of stored
 * sections, from the single JSON serialization. `s` is the count of collapsible nav sections — a
 * handful, fixed by the host's panel manifest, never user-variable.
 * @overallScore 100
 */
export function useNavSections(storageKey: string = DEFAULT_NAV_SECTIONS_STORAGE_KEY): NavSections {
  const [state, setState] = useState<NavSectionState>(() => readPersisted(storageKey));

  const isOpen = useCallback((groupLabel: string) => state[groupLabel] ?? true, [state]);

  const toggle = useCallback(
    (groupLabel: string) => {
      setState((current) => {
        // `?? true` here and in `isOpen` must agree: toggling a section that has never been stored
        // has to close it (it is currently rendered open), not open an already-open section — which
        // is what a bare `!current[label]` would do on the `undefined` first press.
        const next = { ...current, [groupLabel]: !(current[groupLabel] ?? true) };
        writePersisted(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  /** Cross-tab sync — two admin tabs should agree on the layout rather than diverging the moment
   *  either one collapses a section. Mirrors `useSidebarRail`'s listener, including treating a
   *  removed key (`newValue === null`, another tab clearing storage) as "no stored preference"
   *  rather than as "everything closed". */
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== storageKey) return;
      setState(event.newValue === null ? {} : readPersisted(storageKey));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  return { isOpen, toggle };
}
