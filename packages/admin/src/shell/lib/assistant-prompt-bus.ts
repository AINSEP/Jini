import { useEffect, type RefObject } from "react";
import type { ChatPaneComposerHandle } from "../../react/kit.js";
import { requestAssistantDock } from "./assistant-dock-bus.js";

/**
 * @file Lets a screen hand the assistant a drafted request: it opens the dock and writes the text
 * into the composer through `ChatPaneComposerHandle.insertText` (the seam voice input and folder
 * drop already use). The text is a DRAFT; the owner reads it and presses Send. Sites' Import Site
 * tab uses it to start the existing `site-import` agent plugin on a live website (2026-10-18).
 *
 * The request is held until a mounted dock takes it, because the dock may be closed (unmounted)
 * when the screen asks, and the pane's handle is only published after its first render.
 */

let pending: string | null = null;
const listeners = new Set<() => void>();

/** Opens the dock and queues `text` for its composer. A newer request replaces an unsent one. */
export function requestAssistantPrompt({ text }: { text: string }, _optional: Record<string, never> = {}): void {
  pending = text;
  requestAssistantDock({ open: true });
  for (const listener of [...listeners]) listener();
}

/** Test seam: drops the queued text and every listener. */
export function resetAssistantPromptBus(): void {
  pending = null;
  listeners.clear();
}

const RETRY_MS = 100;
const MAX_ATTEMPTS = 50;

/**
 * The dock's half: delivers a queued request into the composer as soon as the pane's handle exists,
 * retrying briefly while the pane mounts (at most 5 s). A request still undelivered after that stays
 * queued for the next mount.
 * @complexity O(1) per attempt.
 */
export function useAssistantPromptRequests(composerHandle: RefObject<ChatPaneComposerHandle | null>): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deliver = (_required: Record<string, never>, { attempt = 0 }: { attempt?: number } = {}) => {
      clearTimeout(timer);
      if (pending === null) return;
      const handle = composerHandle.current;
      if (handle) {
        const text = pending;
        pending = null;
        handle.insertText(text);
        return;
      }
      if (attempt < MAX_ATTEMPTS) timer = setTimeout(() => deliver({}, { attempt: attempt + 1 }), RETRY_MS);
    };
    const listener = () => deliver({});
    listeners.add(listener);
    deliver({});
    return () => {
      listeners.delete(listener);
      clearTimeout(timer);
    };
  }, [composerHandle]);
}
