import { useCallback, useRef, type MouseEvent } from "react";

const SEND_STOP_GRACE_MS = 500;
const monotonicNow = () => performance.now();

/** The enabled composer Send/Stop button under the pointer and the composer that owns it, or null for anything else. */
export function enabledComposerButton(target: EventTarget): { button: HTMLButtonElement; composer: Element } | null {
  if (!(target instanceof Element)) return null;
  const button = target.closest<HTMLButtonElement>("button.jini-composer-send");
  const composer = button?.closest(".jini-composer");
  return button && !button.disabled && composer ? { button, composer } : null;
}

/**
 * Jini changes Send into Stop under the pointer, but exposes no cancellation-click hook.
 * Capture at the existing host wrapper BEFORE its onCancel handler: guarding stopRun alone
 * would still abort the subscription and mark the reply "Stopped." inside Jini.
 *
 * The short window also covers browsers that reset click detail when the button changes.
 * detail > 1 covers slower OS double-click settings. Scope both to the composer that sent;
 * a newly mounted conversation must not inherit another pane's Send. Keyboard/assistive
 * activations (detail === 0) remain immediately available, and ignored clicks don't extend
 * the window. Remove this compatibility hook when Jini owns the guard in Composer.
 */
export function useComposerSendStopGuard(
  _required: Record<string, never> = {},
  { now = monotonicNow }: { now?: () => number } = {},
) {
  const lastSend = useRef<{ composer: Element; at: number } | null>(null);
  return useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.detail === 0) return;
    const target = enabledComposerButton(event.target);
    if (!target) return;
    const { button, composer } = target;
    if (!button.classList.contains("jini-composer-send--stop")) {
      lastSend.current = { composer, at: now() };
      return;
    }
    const sent = lastSend.current;
    if (sent?.composer === composer && (event.detail > 1 || now() - sent.at < SEND_STOP_GRACE_MS)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, [now]);
}
