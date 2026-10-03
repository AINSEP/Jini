import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// aria-modal tells assistive technology that the background is unavailable; without a trap,
// Tab can still escape to those controls. Share this stack across unrelated components so only
// the innermost active dialog traps focus, and the outer dialog resumes when it closes.
const activeTraps: Array<RefObject<HTMLElement | null>> = [];

function isAvailableForFocus(element: HTMLElement): boolean {
  if (element.matches(":disabled") || element.closest("[hidden], [inert]")) return false;
  const visibility = getComputedStyle(element).visibility;
  if (visibility === "hidden" || visibility === "collapse") return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (getComputedStyle(ancestor).display === "none") return false;
  }
  return true;
}

function redirectTarget(container: HTMLElement, shiftKey: boolean): HTMLElement | null {
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isAvailableForFocus);
  if (focusable.length === 0) return null;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  if (!(active instanceof Node) || !container.contains(active)) return shiftKey ? last : first;
  if (shiftKey && active === first) return last;
  if (!shiftKey && active === last) return first;
  return null;
}

/** Trap Tab/Shift+Tab in the most recently activated container; outer traps resume on cleanup. */
export function useFocusTrap({ containerRef }: { containerRef: RefObject<HTMLElement | null> }, { active = true }: { active?: boolean | undefined } = {}): void {
  useEffect(() => {
    if (!active) return;
    activeTraps.push(containerRef);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || activeTraps[activeTraps.length - 1] !== containerRef) return;
      const container = containerRef.current;
      if (!container) return;
      const target = redirectTarget(container, event.shiftKey);
      if (!target) return;
      event.preventDefault();
      target.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      activeTraps.splice(activeTraps.lastIndexOf(containerRef), 1);
    };
  }, [containerRef, active]);
}
