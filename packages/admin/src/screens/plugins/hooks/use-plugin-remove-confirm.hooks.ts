import { useEffect, useRef, type RefObject } from "react";

import { useFocusTrap } from "@jini-ai/ui/panel-kit";

import type { PluginRemoveConfirmCopy, PluginRules } from "../rules.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file `PluginRemoveConfirmDialog`'s three behaviours — Escape-to-cancel, the name-derived copy,
 * and (2026-09-20 platform review, Finding 4) the Tab focus trap — so the dialog component itself is
 * only markup. Mirrors `use-agent-plugin-disable-confirm.hooks.ts` (same split, same reason: `copy`
 * is a derived value, not something the component should compute inline) and
 * `@jini-ai/admin/screens/settings/hooks/use-external-mcp-remove-confirm.hooks` (the precedent both dialogs
 * follow for a genuinely destructive remove).
 *
 * Not sharing either of those hooks directly: each is feature-local by its own header's stated
 * convention, and duplicating an 8-line Escape effect here is cheaper than a cross-file import for
 * a third single-consumer hook — same call this directory's own sibling hook already made.
 *
 * Focus trap (Finding 4): this dialog declares `role="dialog" aria-modal="true"` but, until now, had
 * no actual Tab containment — the attribute told assistive technology everything behind the dialog
 * was unavailable while the browser let Tab walk straight out onto it. Wired through the shared
 * `useFocusTrap` primitive (`ebcda9aae`) here in the hook, not in the component body the way
 * `MediaEditDialog.tsx` does it — this admin's "logic belongs in hooks, not `.tsx`" rule, and this
 * dialog already has a paired hook to hold it. `dialogRef` is returned for the component to attach to
 * its `role="dialog"` div; `autoFocus` on Cancel is unaffected — the trap only redirects Tab once
 * focus is already somewhere inside the container, it never moves initial focus itself.
 */

export interface PluginRemoveConfirmController {
  copy: PluginRemoveConfirmCopy;
  /** Attach to the `role="dialog"` div — see this file's header. */
  dialogRef: RefObject<HTMLDivElement | null>;
}

export function usePluginRemoveConfirm(props: { name: string; onCancel: () => void; t?: Translate | undefined; rules: Pick<PluginRules, "buildPluginRemoveConfirmCopy"> }): PluginRemoveConfirmController {
  const { onCancel } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap({ containerRef: dialogRef });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return { copy: props.rules.buildPluginRemoveConfirmCopy({ name: props.name }, props.t ? { translate: props.t } : {}), dialogRef };
}
