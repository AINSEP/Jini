import { screen } from "@testing-library/react";

const FOCUSABLE =
  "a[href],button:not([disabled]),input:not([disabled]):not([type='hidden']),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

/**
 * Focuses the rendered dialog's last focusable element and presses Tab on it — the keystroke that
 * walks out of an untrapped `aria-modal` dialog. Returns the dispatched event and the dialog's first
 * focusable element, which is where a trapped dialog must send focus.
 */
export function tabFromLastFocusableInDialog(): { event: KeyboardEvent; first: HTMLElement } {
  const focusable = Array.from(screen.getByRole("dialog").querySelectorAll<HTMLElement>(FOCUSABLE));
  const last = focusable[focusable.length - 1]!;
  last.focus();
  const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  last.dispatchEvent(event);
  return { event, first: focusable[0]! };
}
