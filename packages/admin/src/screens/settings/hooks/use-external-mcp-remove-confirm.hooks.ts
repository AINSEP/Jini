import { useEffect, useRef, type RefObject } from "react";

import type { AdminKitHooks } from "../../../react/kit.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file `ExternalMcpRemoveConfirmDialog`'s only two behaviours — Escape-to-cancel and the
 * name/auth-mode-derived copy — so the dialog component itself is only markup. Mirrors
 * `features/collections/hooks/use-lifecycle-confirm-dialog.hooks.ts` (same split, same reason:
 * `copy` is a derived value, not something the component should compute inline).
 *
 * Not sharing `features/collections`' own `useEscapeToCancel` here: that hook is feature-local by
 * design (its own file header says nothing outside `features/collections` needs it), and this is
 * the only consumer in `features/settings` so far — duplicating an 8-line effect is cheaper than a
 * cross-feature import for one caller. If a third feature needs the same listener, that is the
 * point to extract a shared one, not before.
 *
 * Also owns the Tab trap (2026-09-20 focus-trap inventory, plan-components.md Part 3): this dialog
 * declares `aria-modal="true"` but nothing kept Tab from walking out onto the page behind it. The
 * `dialogRef`/`useFocusTrap` pair lives here rather than in the `.tsx` body, so the ref and the
 * hook that consumes it stay together — a rendering-only component file cannot silently drop the
 * `ref={dialogRef}` attribute without also dropping the whole controller wire-up a test exercises.
 *
 * `buildCopy` is required: the host owns the copy builder (its `buildExternalMcpRemoveConfirmCopy`,
 * which lives with its settings rules) and passes it in; this hook only calls it with the
 * dialog's name, auth mode and translator.
 */

/** The host's name/auth-mode → dialog copy builder (title + body, or whatever shape it returns). */
export type ExternalMcpRemoveConfirmCopyBuilder<TCopy> = (
  params: { name: string; isOAuth: boolean },
  options: { t?: Translate },
) => TCopy;

export interface ExternalMcpRemoveConfirmController<TCopy> {
  copy: TCopy;
  /** Attach to the dialog's own `aria-modal` root — see this file's header. */
  dialogRef: RefObject<HTMLDivElement | null>;
}

export function useExternalMcpRemoveConfirm<TCopy>(props: {
  name: string;
  isOAuth: boolean;
  onCancel: () => void;
  t?: Translate;
  buildCopy: ExternalMcpRemoveConfirmCopyBuilder<TCopy>;
  /** The kit's focus-trap hook, injected by the host. */
  useFocusTrapHook: AdminKitHooks['useFocusTrap'];
}): ExternalMcpRemoveConfirmController<TCopy> {
  const { onCancel } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  props.useFocusTrapHook({ containerRef: dialogRef });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const options = props.t === undefined ? {} : { t: props.t };
  return { copy: props.buildCopy({ name: props.name, isOAuth: props.isOAuth }, options), dialogRef };
}
