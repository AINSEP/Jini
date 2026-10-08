import type { ReactNode } from 'react';
import { agentHandle } from '@jini-ai/agentic';
import type { AgentAttrsPort } from '@jini-ai/ui-kit';
import { useConfirmController } from '@jini-ai/ui-kit/react';
import { resolveTone, toneClassName, type ConfirmTone } from '../../types.js';
import { useConfirmDialog, useConfirmDialogCancelLabel, type UseConfirmDialog } from './ConfirmDialog.hooks.js';

/**
 * @file Shared modal confirmation primitive — the replacement for `window.confirm`, which blocks
 * the whole tab, cannot carry destructive-vs-neutral styling, and reads as a browser artifact
 * rather than part of the product.
 *
 * Built on the native `<dialog>` element (`showModal()`/`close()`) rather than a plain-`<div>`
 * overlay + backdrop idiom: that shape hand-rolls focus trapping, Escape handling, and a backdrop
 * element, all of which the browser's own top layer gives a real `<dialog>` for free, including
 * correct stacking above everything else on the page without a chosen `z-index`. The `showModal`/
 * `close` calls themselves, and the jsdom fallback they need, are delegated by
 * `ConfirmDialog.hooks.tsx` to UI-kit's native hook — see that adapter's doc comment.
 *
 * Unstyled, like everything in this layer: the `.confirm-dialog` / `.btn-secondary` /
 * `.btn-danger` / `.btn-warning` class names are emitted for the host stylesheet to define.
 *
 * ## Agent handles
 *
 * Given `agentHandle="delete-role"` this publishes:
 *
 * | element | handle | role |
 * |---|---|---|
 * | the cancel/dismiss action | `delete-role-cancel` | `button` |
 * | the confirm action, unless the caller opts out with `agentMayConfirm={false}` | `delete-role-confirm` | `button` |
 *
 * The confirm action is agent-reachable by default, same as every other published control — the
 * product's standing policy is that the in-page assistant may click buttons, fill forms and confirm
 * dialogs, with permanently destructive actions gated by a separate in-chat confirmation at the tool
 * level rather than by hiding the button. A caller whose dialog must stay human-only regardless
 * (e.g. it guards a secret the assistant must never see or move on its own) opts out explicitly with
 * `agentMayConfirm={false}`.
 *
 * Both segments are literals this component chooses itself, never host data — unlike `RowMenu`'s
 * per-item keys (arbitrary host strings that can collide after slugifying), `confirm`/`cancel`
 * need no sanitizing. `agentHandle` itself is NOT sanitized either: it is the caller's own explicit
 * choice of name, and a bad one should fail loudly at first render rather than silently answer to a
 * handle the caller never wrote. Omit `agentHandle` and no `data-agent-*` markup is emitted at all.
 *
 * The published handles are present in the DOM as soon as `agentHandle` is supplied, regardless of `open` —
 * this component stays mounted and toggles the native `<dialog>`'s open state rather than being
 * conditionally rendered by its caller (see `useConfirmDialog`'s doc comment), so there is no
 * "closed" render that omits them, the same reasoning `RowMenu`'s always-visible trigger handle
 * documents for itself.
 *
 * This component renders no typed-confirmation input today (no "type DELETE to confirm" field) —
 * if one is added later it needs its own handle under this same scheme (e.g. `<base>-confirm-input`,
 * role `field`).
 *
 * Labels state both the action and its consequence tier, derived from this component's own
 * three-tier `ConfirmTone` vocabulary rather than reparsed from `title`/`body`: `body` is arbitrary
 * `ReactNode` (a caller can pass JSX), not guaranteed to be a string at all, so it cannot be safely
 * folded into agent-facing text — the shared UI-kit confirmation planner owns those phrases.
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** @default the enclosing `ConfirmDialogDefaultsProvider`'s `cancelLabel`, or "Cancel" with
   *  none mounted. */
  cancelLabel?: string;
  /** Applies `.btn-warning`/`.btn-danger` to the confirm action. Defaults to `"default"` (no class,
   *  the plain primary button). Wins over `destructive` below when both are passed. */
  tone?: ConfirmTone;
  /** @deprecated Use `tone: "danger"` instead — this only ever expressed the danger tier, and the
   *  vocabulary has a second one (`"warning"`) this boolean cannot reach. Kept working (mapped to
   *  `tone: "danger"` when `tone` is not set) for existing callers rather than a breaking rename. */
  destructive?: boolean;
  /** External in-flight flag. Disables both actions and blocks Escape/backdrop dismissal so a
   *  request already underway cannot be raced by a second dismiss. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Injectable seam for the dialog's open/close and focus-management hook. Defaults to the real
   *  {@link useConfirmDialog}; a test can pass a fake here to exercise `ConfirmDialog`'s rendering
   *  without invoking the native `<dialog>` methods or DOM focus calls at all.
   *
   *  Typed against the explicit `UseConfirmDialog` contract rather than `typeof useConfirmDialog`:
   *  see `ConfirmDialogController`'s doc comment for why binding a public prop to a concrete
   *  implementation's inferred return object is a coupling rather than a convenience. */
  useDialog?: UseConfirmDialog;
  /** This dialog's own agent handle — see this file's "Agent handles" doc comment for the full
   *  scheme. Omit and no `data-agent-*` markup is emitted at all. */
  agentHandle?: string;
  /** Publishes the confirm action (`<agentHandle>-confirm`) so the assistant can confirm this
   *  dialog without a human — on by default, matching every other published control. Pass `false`
   *  only for a dialog that must stay human-only regardless (e.g. it guards a secret). Has no
   *  effect without `agentHandle`. @default true */
  agentMayConfirm?: boolean;
}

/**
 * UI-kit's confirmation planner owns the sub-handle segments appended to the caller's base:
 * literals chosen by the mechanism, never host data. Neither needs sanitizing, unlike
 * `RowMenu`'s per-item keys (see this file's "Agent handles" contract).
 *
 * Its plain-language consequence phrase is keyed off the dialog's three-tier `ConfirmTone`
 * vocabulary (`"default"` / `"warning"` / `"danger"`, documented in `../../types.js`), rather
 * than reparsed from `title` or `body`, which cannot safely supply agent-facing consequence text.
 * The confirm label names the action (`confirmLabel`), target (`title`) and declared consequence;
 * the planner does not parse `body` to decide whether an action is safe.
 *
 * The cancel label's consequence is a guarantee of the contract (cancelling never calls
 * `onConfirm`), rather than something read off `tone`, so it needs no tone input at all.
 * Agent attributes retain the shape used by `RowMenu`'s local `rowMenuAgentProps`; injecting
 * admin's attribute port into the shared owner preserves that shape and handle validation
 * without keeping a second local implementation. No base handle means no agent attributes.
 */

/**
 * Controlled modal confirm — renders the `<dialog>` markup and delegates its open/close and focus
 * lifecycle to {@link useConfirmDialog} (injectable via the `useDialog` prop, defaulted to the real
 * implementation, so a test can supply a fake without mocking modules).
 *
 * Both actions are plain `type="button"` (no `<form method="dialog">`, no `type="submit"`), so there
 * is no browser-assigned "default button" for Enter to reach for at all; confirm can only ever fire
 * from an explicit click or explicit Tab-then-Enter onto it.
 */
export function ConfirmDialog({
  useDialog = useConfirmDialog,
  agentHandle: baseHandle,
  agentMayConfirm = true,
  ...props
}: ConfirmDialogProps, _optional: Record<string, never> = {}) {
  const tone = resolveTone({}, props);
  const cancelLabel = useConfirmDialogCancelLabel({}, { explicit: props.cancelLabel });
  const controller = useConfirmController({
    open: props.open, title: props.title, body: props.body, confirmLabel: props.confirmLabel,
    cancelLabel, tone, agentMayConfirm,
    ...(baseHandle === undefined ? {} : { agentHandle: baseHandle }),
    ...(props.pending === undefined ? {} : { pending: props.pending }),
    onConfirm: () => props.onConfirm(), onCancel: () => props.onCancel(),
  }, {
    // UI-kit names selects separately; agentic publishes them as fields and still owns handle validation.
    agent: ((required, optional = {}) => agentHandle(required, {
      ...(optional.role === undefined ? {} : { role: optional.role === 'select' ? 'field' : optional.role }),
      ...(optional.label === undefined ? {} : { label: optional.label }),
    })) satisfies AgentAttrsPort,
  });
  const { titleId, dialogRef, cancelRef, handleNativeCancel, handleBackdropClick } = useDialog(
    { open: props.open, onCancel: () => { controller.requestDismiss({ reason: 'close' }); }, document },
    { pending: controller.pending },
  );
  // Keep admin's concise accessible names; the shared planner still supplies consequence-aware agent labels.
  const { 'aria-label': _cancelName, ...cancelAttrs } = controller.cancel.attrs ?? {};
  const { 'aria-label': _confirmName, ...confirmAttrs } = controller.confirm.attrs ?? {};

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      onCancel={handleNativeCancel}
      onClick={handleBackdropClick}
    >
      <h2 id={titleId}>{props.title}</h2>
      <div className="confirm-dialog-body">{props.body}{controller.error}</div>
      <div className="confirm-dialog-actions">
        <button
          ref={cancelRef}
          type="button"
          className="btn-secondary"
          disabled={controller.pending}
          onClick={() => controller.cancel.onPress?.({})}
          {...cancelAttrs}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={toneClassName({ tone })}
          disabled={controller.pending}
          onClick={() => controller.confirm.onPress?.({})}
          {...confirmAttrs}
        >
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
