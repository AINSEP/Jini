import { useEffect } from "react";

/**
 * @file Click on EMPTY sidebar space toggles the desktop rail (owner request, 2026-10-05). The
 * rail toggle button is a small target under "AI Assistant"; the whole rail's blank area is a much
 * easier one. It calls the same `toggleRail` `<Sidebar.RailToggle>` calls, so the persisted
 * preference, cross-tab sync and `aria-expanded` on the real button all stay on one path.
 *
 * A native listener on the `<nav>` rather than a React `onClick`: `@jini-ai/admin/react`'s
 * `Sidebar` root takes no event props, and changing that is a package rebuild for one host's
 * layout choice. Pointer-only by construction — keyboard users keep the real toggle button, whose
 * Enter/Space click lands on a `<button>` and is therefore skipped below.
 */

/** Nav rows, including inert Soon items, are never blank space. `[tabindex]` covers custom
 *  focusable widgets; `label` covers form labels that forward clicks to an input. */
export const SIDEBAR_CONTROL_SELECTOR =
  '.cms-item, a, button, input, select, textarea, summary, label, [role="button"], [role="link"], [tabindex]';

/** Same breakpoint as `styles.css`'s `.cms-nav.is-rail` block: below it the nav is the mobile
 *  drawer, which has no rail, so a toggle there would only flip a preference nobody can see. */
const DESKTOP_RAIL_QUERY = "(min-width: 901px)";

/** How far (CSS px, either axis) the pointer may travel between press and release and still count
 *  as a click. The browser fires `click` after a drag that starts and ends on the same element — a
 *  drag across blank rail space did exactly that in a live check and toggled the rail. */
const DRAG_THRESHOLD_PX = 4;

function matchesDesktopRail(): boolean {
  return window.matchMedia(DESKTOP_RAIL_QUERY).matches;
}

export interface SidebarClick {
  readonly target: EventTarget | null;
  readonly button: number;
  readonly defaultPrevented: boolean;
}

/**
 * Whether `event` landed on blank sidebar space: a plain primary click inside `nav`, not on (or
 * inside) any control, and not the end of a drag or a text selection inside the nav.
 *
 * @param event - The click (only `target`, `button`, `defaultPrevented` are read).
 * @param context.nav - The sidebar `<nav>`.
 * @param context.selectingText - True when a non-collapsed selection starts inside `nav`.
 * @param context.dragged - True when the pointer moved past the drag threshold since press.
 */
export function isEmptySidebarClick(
  event: SidebarClick,
  { nav, selectingText, dragged }: { readonly nav: Element; readonly selectingText: boolean; readonly dragged: boolean },
): boolean {
  if (event.button !== 0 || event.defaultPrevented || selectingText || dragged) return false;
  const target = event.target;
  if (!(target instanceof Element) || !nav.contains(target)) return false;
  const control = target.closest(SIDEBAR_CONTROL_SELECTOR);
  return control === null || !nav.contains(control);
}

function movedPastThreshold({ from, event }: { from: { x: number; y: number } | null; event: MouseEvent }, _options = {}): boolean {
  if (!from) return false;
  return Math.abs(event.clientX - from.x) > DRAG_THRESHOLD_PX || Math.abs(event.clientY - from.y) > DRAG_THRESHOLD_PX;
}

function selectionStartsIn(nav: Element, doc: Document): boolean {
  const selection = doc.getSelection();
  return !!selection && !selection.isCollapsed && nav.contains(selection.anchorNode);
}

/**
 * Wires {@link isEmptySidebarClick} to `toggleRail` on the sidebar `<nav>` found by id.
 *
 * @param required.toggleRail - `useSidebar().toggleRail` — the rail toggle button's own handler.
 * @param optional.navId - The `<nav>`'s id. @default "admin-sidebar" (`Sidebar`'s own default)
 * @param optional.doc - Where to look the nav up and read the selection. @default document
 * @param optional.isDesktop - Whether the rail exists at the current width. @default matchMedia
 * @sideeffects One `pointerdown` and one `click` listener on the nav while mounted.
 */
export function useSidebarEmptyClickToggle(
  { toggleRail }: { readonly toggleRail: () => void },
  {
    navId = "admin-sidebar",
    doc = document,
    isDesktop = matchesDesktopRail,
  }: { readonly navId?: string; readonly doc?: Document; readonly isDesktop?: (() => boolean) | undefined } = {},
): void {
  useEffect(() => {
    const nav = doc.getElementById(navId);
    if (!nav) return undefined;
    let pressedAt: { x: number; y: number } | null = null;
    function onPointerDown(event: PointerEvent) {
      pressedAt = { x: event.clientX, y: event.clientY };
    }
    function onClick(event: MouseEvent) {
      if (!isDesktop() || !nav) return;
      const context = { nav, selectingText: selectionStartsIn(nav, doc), dragged: movedPastThreshold({ from: pressedAt, event }) };
      pressedAt = null;
      if (isEmptySidebarClick(event, context)) toggleRail();
    }
    nav.addEventListener("pointerdown", onPointerDown);
    nav.addEventListener("click", onClick);
    return () => {
      nav.removeEventListener("pointerdown", onPointerDown);
      nav.removeEventListener("click", onClick);
    };
  }, [toggleRail, navId, doc, isDesktop]);
}
