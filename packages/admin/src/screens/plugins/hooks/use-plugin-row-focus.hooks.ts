import { useEffect, useRef } from "react";

/**
 * @file The Plugins page's `?plugin=<id>` deep link (owner 2026-10-25): a linked agent plugin's
 * padlock on Agent Plugins opens its provider plugin here. The named row scrolls to the middle of
 * the screen, takes focus on its summary button (so a keyboard user lands on it too) and is marked
 * `data-focused` for its highlight. An unknown id matches no row and does nothing.
 *
 * @returns The ref for the row's `<li>`.
 */
export function usePluginRowFocus({ focused }: { focused: boolean }) {
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    if (!focused || !row) return;
    row.scrollIntoView?.({ block: "center", behavior: "smooth" });
    row.querySelector<HTMLElement>(".plugin-row-summary")?.focus({ preventScroll: true });
  }, [focused]);
  return rowRef;
}
