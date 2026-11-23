/** Promise-shaped confirmation for the host's local-sites controller, rendered by the shared `ConfirmDialog`. */
import { createElement, useCallback, useRef } from "react";
import type { Translate } from "@jini-ai/core/text";
import { useConfirmRequest } from "../../react/components/ConfirmDialog/use-confirm-request.js";
import type { ConfirmTone } from "../../react/types.js";

/** Title, confirm label and tone for one confirmable action; the body is the controller's own message. */
export interface SiteConfirmPresentation { titleKey: string; confirmKey: string; tone: ConfirmTone }

/**
 * Replaces `window.confirm` with the admin's own modal: `confirm` resolves when the operator answers.
 * The request lifecycle (a newer request, or unmount, denies the outstanding one; stale answers are
 * ignored) is `useConfirmRequest`'s; this hook only supplies each action's copy and tone.
 * @param input - Bound translator for the dialog chrome, and the host's per-action presentation
 *   (title and confirm-label translation keys, tone) — host copy, injected rather than owned here.
 * @returns `confirm` for the host's local-sites controller, plus the `dialog` props for one always-mounted `ConfirmDialog`.
 * @complexity O(1) per request.
 */
export function useSiteConfirm<TAction extends string>(
  { t, presentation }: { t: Translate; presentation: Readonly<Record<TAction, SiteConfirmPresentation>> },
  _optional = {},
) {
  const request = useConfirmRequest({});
  const translate = useRef(t);
  translate.current = t;
  const copy = useRef(presentation);
  copy.current = presentation;
  const open = request.confirm;
  const confirm = useCallback(({ message, action }: { message: string; action: TAction }, _optional = {}) => {
    const shown = copy.current[action];
    return open({ dialog: {
      title: translate.current(shown.titleKey),
      body: createElement("p", null, message),
      confirmLabel: translate.current(shown.confirmKey),
      tone: shown.tone,
    } });
  }, [open]);
  return { confirm, dialog: request.dialog };
}
/** What `useSiteConfirm` returns; `LocalSiteConfirmDialog` renders its `dialog`. */
export type SiteConfirmController<TAction extends string = string> = ReturnType<typeof useSiteConfirm<TAction>>;
