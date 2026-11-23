import { useCallback, useEffect, useRef, useState } from "react";

/**
 * @file Auto-collapse the side nav to its icon rail while the assistant dock is open on a window too
 * narrow for both (owner, 2026-10-11: "horrendous" — nav expanded + dock open left the page a
 * phone-width column whose centred rows clipped at the left edge).
 *
 * The rule, chosen as the least surprising of the options: at desktop widths the nav always PUSHES
 * the page (it is a flex sibling, never an overlay); only when the expanded nav (232px) + the dock
 * (380px) + the page's padding would leave the page under {@link MIN_PAGE_WIDTH_PX} does opening the
 * dock fold the nav to its 60px rail. Closing the dock (or widening the window out of that band)
 * puts back whatever the operator's stored preference is. It never persists anything itself, never
 * fights the operator: expanding the nav by hand while the dock is open sticks until the next
 * dock-open or band crossing. Phones/tablets (≤900px) are untouched — there the nav is already the
 * off-canvas drawer with a backdrop (`styles.css`'s RESPONSIVE SHELL), which has no rail.
 *
 * Mechanism: Jini's Sidebar owns the saved preference and accepts a temporary `railOverride`.
 * This hook supplies only the dock/viewport rule and controlled toggle requests: no storage reads,
 * writes or synthetic events. A manual toggle changes the override until the next forcing transition;
 * releasing it reveals the package's current stored preference (including real cross-tab updates).
 */

/** Smallest page width (px, inside `.admin-content`'s padding) the dock + expanded nav may leave. */
export const MIN_PAGE_WIDTH_PX = 480;

/**
 * The viewport band where the auto-rail applies: from the rail's own 901px floor (below it the nav
 * is the mobile drawer) up to expanded nav 232 + dock 380 + page padding 2 × 40 + 480 = 1172px.
 * `1171.98px` rather than `1171px` so a fractional-zoom width just under 1172 still matches.
 */
export const DOCK_AUTO_RAIL_QUERY = "(min-width: 901px) and (max-width: 1171.98px)";

/** The slice of a `MediaQueryList` this hook reads. */
export interface AutoRailMediaQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

/**
 * Whether the rail should be forced right now: the dock is open AND the window is in the band.
 *
 * @param state.dockOpen - The assistant dock is open (docked, not the phone sheet).
 * @param state.narrow - The viewport matches {@link DOCK_AUTO_RAIL_QUERY}.
 * @complexity O(1)
 */
export function shouldAutoRail(
  { dockOpen, narrow }: { readonly dockOpen: boolean; readonly narrow: boolean },
  _options: Record<string, never> = {},
): boolean {
  return dockOpen && narrow;
}

function defaultMatchMedia({ query }: { query: string }, _options = {}): AutoRailMediaQuery | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}

/** Props passed directly to Jini's Sidebar; a null override restores its own saved preference. */
export interface DockAutoRail {
  readonly railOverride: boolean | null;
  readonly onRailCollapsedChange: (collapsed: boolean) => void;
}

/**
 * Folds the nav to its rail while the dock is open in a narrow window; releases the override when
 * either stops being true. Jini remains the sole owner of persistence and real cross-tab sync.
 *
 * @param required.dockOpen - `useChatDockLayout().chatOpen`.
 * @param optional.matchMedia - Viewport query port. @default window.matchMedia (null → never folds)
 * @returns Sidebar override props; manual toggles stick until the next dock-open/band transition.
 * @sideeffects One `change` listener on the band's MediaQueryList while mounted; state changes only
 *   on forcing transitions or a controlled toggle request, never on unrelated re-renders.
 * @complexity O(1) per transition.
 */
export function useDockAutoRail(
  { dockOpen }: { readonly dockOpen: boolean },
  {
    matchMedia = defaultMatchMedia,
  }: {
    readonly matchMedia?: (required: { query: string }) => AutoRailMediaQuery | null;
  } = {},
): DockAutoRail {
  // Survives the effect re-running on every `dockOpen` change, which is exactly when it is read: a
  // close must know whether the open before it folded the rail (restore) or not (leave it alone).
  const forced = useRef(false);
  const [railOverride, setRailOverride] = useState<boolean | null>(null);

  // Jini requests changes only while controlled. Keep a hand-expanded nav expanded until the next
  // dock-open/band crossing, without changing the operator's saved preference during this override.
  const onRailCollapsedChange = useCallback((collapsed: boolean) => {
    if (forced.current) setRailOverride(collapsed);
  }, []);

  useEffect(() => {
    const band = matchMedia({ query: DOCK_AUTO_RAIL_QUERY });
    if (!band) return undefined;
    const apply = () => {
      const want = shouldAutoRail({ dockOpen, narrow: band.matches });
      if (want === forced.current) return;
      forced.current = want;
      setRailOverride(want ? true : null);
    };
    apply();
    band.addEventListener("change", apply);
    return () => band.removeEventListener("change", apply);
  }, [dockOpen, matchMedia]);

  return { railOverride, onRailCollapsedChange };
}
