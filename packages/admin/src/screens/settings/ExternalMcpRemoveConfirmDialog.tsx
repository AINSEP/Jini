import type { ComponentType, RefObject } from "react";

import { type Translate } from "@jini-ai/core/text";
import type { AdminKitHooks } from "../../react/kit.js";

import type { useExternalMcpRemoveConfirm, ExternalMcpRemoveConfirmCopyBuilder } from "./hooks/use-external-mcp-remove-confirm.hooks.js";

/**
 * @file Confirmation gate in front of `SourceConfigItemCard`'s "Remove" — added after an operator
 * pressed it on a live, fully-configured OAuth connection and lost it immediately, with no way
 * back (the sealed OAuth secret is never returned by the read API, so removal meant reconnecting
 * from scratch). `@jini-ai/ui`'s card cannot own this itself (`onRemove` fires on click, no
 * confirm step) and stays unmodified per the outline's "Zero Jini change" rule for this surface —
 * `ExternalMcpSettingsPanel.tsx` intercepts the callback instead and only calls the port's
 * `remove` once this dialog's own Confirm is pressed.
 *
 * Markup, classes (`settings-dialog`/`settings-dialog-backdrop`, `btn-secondary`/`btn-danger`),
 * and behaviour (Escape-to-cancel via the paired hook, Cancel default-focused so the destructive
 * action is never the default) all mirror `features/collections/Collections.tsx`'s
 * `LifecycleConfirmDialog` — the most recent precedent for exactly this shape of dialog in this
 * app, reused rather than re-invented. `.btn-secondary`/`.btn-danger` already declare `color`
 * explicitly in `styles.css` (verified: lines 1084/1088), so this does not trip the global
 * `button { color: var(--primary-ink) }` reset that made the sibling card's own pills briefly ship
 * invisible — no new CSS is added here.
 *
 * Moved into this package with the dialog markup and its copy left in the host: the host passes its
 * own confirmation dialog as the REQUIRED `ConfirmDialog` prop (the markup and classes named above are
 * that component's) and its own `{ title, body }` builder as the REQUIRED `buildCopy`.
 */

/** The props this dialog hands the host's confirmation dialog component. */
export interface ExternalMcpRemoveConfirmFrameProps {
  dialogRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  title: string;
  body: string;
  onCancel: () => void;
  onConfirm: () => void;
  cancelText: string;
  confirmText: string;
  cancelHandle: string;
  cancelAgentLabel: string;
  confirmHandle: string;
  confirmAgentLabel: string;
}

/** The confirm dialog's two pieces of copy. */
export interface ExternalMcpRemoveConfirmCopy {
  title: string;
  body: string;
}

export interface ExternalMcpRemoveConfirmDialogProps {
  /** The server's own display name, e.g. `sourceDisplayLabel(source, fieldSpecs)` — must name
   *  the exact connection being removed, not a generic "this connection". */
  name: string;
  /** Whether this connection's credential is an OAuth-sealed secret — changes the body copy
   *  (see `buildExternalMcpRemoveConfirmCopy`). */
  isOAuth: boolean;
  /** This card's own agent-handle base (e.g. `mcp-server-higgsfield`) — Confirm/Cancel publish
   *  as `<cardHandle>-remove-confirm` / `<cardHandle>-remove-cancel`, nesting under the card's
   *  already-published `<cardHandle>-remove` the same way `-field-<key>-reveal` nests under
   *  `-field-<key>` in `@jini-ai/ui`'s own `agent-handles.ts` scheme. */
  cardHandle: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** The panel's own translator (`useT()` from `@jini-ai/ui`) — threaded down rather than called
   *  again here, same convention `Collections.tsx` uses to hand `t` to `LifecycleConfirmDialog`. */
  t: Translate;
  /** The host's confirmation dialog markup (required): rendered with exactly the props above. */
  ConfirmDialog: ComponentType<ExternalMcpRemoveConfirmFrameProps>;
  /** The host's title/body copy builder (required) — the dialog renders exactly what it returns. */
  buildCopy: ExternalMcpRemoveConfirmCopyBuilder<ExternalMcpRemoveConfirmCopy>;
  /** The host's confirmation controller hook (required); tests bind a fake. */
  useExternalMcpRemoveConfirmHook: typeof useExternalMcpRemoveConfirm;
  /** The kit's focus-trap hook (required), handed to the controller. */
  useFocusTrapHook: AdminKitHooks['useFocusTrap'];
}

export function ExternalMcpRemoveConfirmDialog({
  name,
  isOAuth,
  cardHandle,
  onConfirm,
  onCancel,
  t,
  ConfirmDialog,
  buildCopy,
  useExternalMcpRemoveConfirmHook,
  useFocusTrapHook,
}: ExternalMcpRemoveConfirmDialogProps) {
  const { copy, dialogRef } = useExternalMcpRemoveConfirmHook({ name, isOAuth, onCancel, t, buildCopy, useFocusTrapHook });
  const titleId = `${cardHandle}-remove-confirm-title`;

  return (
    /* Cancel is the default-focused control — this action is not reversible from this
       screen (an OAuth secret cannot be recovered), matching `LifecycleConfirmDialog`'s
       own "Tombstone" precedent for the same reason. */
    <ConfirmDialog
      dialogRef={dialogRef}
      titleId={titleId}
      title={copy.title}
      body={copy.body}
      onCancel={onCancel}
      onConfirm={onConfirm}
      cancelText={t("Cancel")}
      confirmText={t("Remove")}
      cancelHandle={`${cardHandle}-remove-cancel`}
      cancelAgentLabel={`Close this dialog without removing ${name}`}
      confirmHandle={`${cardHandle}-remove-confirm`}
      confirmAgentLabel={`Permanently remove ${name} — this cannot be undone from this screen`}
    />
  );
}
