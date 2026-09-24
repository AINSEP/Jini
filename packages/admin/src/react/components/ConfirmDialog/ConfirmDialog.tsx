import { type ReactNode } from 'react';
import { agentHandle, type AgentElementRole } from '@jini-ai/agentic';
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
 * `close` calls themselves, and the jsdom fallback they need, live in `ConfirmDialog.hooks.tsx` —
 * see that file's doc comment.
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
 * | the confirm action, only with `agentMayConfirm` | `delete-role-confirm` | `button` |
 *
 * The confirm action is human-only by default. The page driver clicks any published element, so a
 * tagged confirm would let the assistant open a dialog and confirm it with no human in the loop,
 * which defeats the dialog. A caller whose action is safe for the assistant to finish on its own
 * (reversible, e.g. move-to-trash) opts in with `agentMayConfirm`; a destructive, secret-exposing
 * or privilege-changing dialog never should.
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
 * folded into agent-facing text — see {@link confirmDialogConsequencePhrase}.
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
  /** Also publish the confirm action (`<agentHandle>-confirm`) so the assistant can confirm this
   *  dialog without a human. Off by default: pass it only for a reversible action. Has no effect
   *  without `agentHandle`. @default false */
  agentMayConfirm?: boolean;
}

/** Sub-handle segments appended to the caller's base — literals this component chooses itself,
 *  never host data (see this file's "Agent handles" doc comment for why that means neither needs
 *  sanitizing, unlike `RowMenu`'s per-item keys). */
const CONFIRM_HANDLE_ACTION = 'confirm';
const CANCEL_HANDLE_ACTION = 'cancel';

/**
 * Plain-language phrase for what confirming actually changes, keyed off the dialog's own
 * three-tier `ConfirmTone` vocabulary (`"default"` / `"warning"` / `"danger"`, documented in
 * `../../types.js`) rather than reparsed from `title` or `body` — see this file's doc comment for
 * why those cannot be safely folded into agent-facing text.
 *
 * @param tone - The dialog's resolved tone (see `resolveTone`).
 * @returns The tier's consequence phrase, or `undefined` for `"default"`, which declares no tier.
 * @complexity O(1).
 */
function confirmDialogConsequencePhrase(tone: ConfirmTone): string | undefined {
  if (tone === 'danger') return 'cannot be undone';
  if (tone === 'warning') return 'changes access, but is reversible';
  return undefined;
}

/**
 * The confirm action's agent-facing label: what it does (`confirmLabel`), what it applies to
 * (`title`), and — when the tone declares one — its consequence tier.
 *
 * @param confirmLabel - The button's own visible text, e.g. `"Delete"`.
 * @param title - The dialog's title, e.g. `"Delete role?"`.
 * @param tone - The dialog's resolved tone.
 * @returns A label an agent can use to judge whether confirming is safe, without having read
 *   `body` (which this function never receives — see this file's doc comment for why).
 * @complexity O(1).
 */
function confirmDialogConfirmLabel(confirmLabel: string, title: string, tone: ConfirmTone): string {
  const consequence = confirmDialogConsequencePhrase(tone);
  return consequence === undefined ? `${confirmLabel} — ${title}` : `${confirmLabel} — ${title}; ${consequence}`;
}

/**
 * The cancel action's agent-facing label. Unlike {@link confirmDialogConfirmLabel}, its consequence
 * is a guarantee of this component's own contract (cancelling never calls `onConfirm`) rather than
 * something read off `tone`, so it needs no tone input at all.
 *
 * @param cancelLabel - The button's own visible text, already defaulted by the caller.
 * @param title - The dialog's title, e.g. `"Delete role?"`.
 * @returns A label stating that this action leaves the titled action unconfirmed.
 * @complexity O(1).
 */
function confirmDialogCancelLabel(cancelLabel: string, title: string): string {
  return `${cancelLabel} — leaves "${title}" unconfirmed; no action taken`;
}

/**
 * Builds the `data-agent-*` attribute props for one of this dialog's two actions, or nothing at
 * all when the dialog published no base handle — same shape as `RowMenu.tsx`'s local
 * `rowMenuAgentProps`, kept local and unexported here since only this one component needs it.
 *
 * @param base - The dialog's own handle from the caller, or `undefined` when it published none.
 * @param action - Which action this is — see {@link CONFIRM_HANDLE_ACTION}/{@link CANCEL_HANDLE_ACTION}.
 * @param options - Role and this action's already-composed label.
 * @returns Spreadable attribute props, or `{}` when `base` is `undefined`.
 * @complexity O(1).
 */
function confirmDialogAgentProps(
  base: string | undefined,
  action: typeof CONFIRM_HANDLE_ACTION | typeof CANCEL_HANDLE_ACTION,
  options: { role: AgentElementRole; label: string },
) {
  return base === undefined ? {} : agentHandle(`${base}-${action}`, options);
}

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
  agentMayConfirm = false,
  ...props
}: ConfirmDialogProps) {
  const { titleId, dialogRef, cancelRef, handleNativeCancel, handleBackdropClick } = useDialog(
    props.open,
    props.pending,
    props.onCancel,
  );

  const tone = resolveTone(props);
  const cancelLabel = useConfirmDialogCancelLabel(props.cancelLabel);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      onCancel={handleNativeCancel}
      onClick={handleBackdropClick}
    >
      <h2 id={titleId}>{props.title}</h2>
      <div className="confirm-dialog-body">{props.body}</div>
      <div className="confirm-dialog-actions">
        <button
          ref={cancelRef}
          type="button"
          className="btn-secondary"
          disabled={props.pending}
          onClick={props.onCancel}
          {...confirmDialogAgentProps(baseHandle, CANCEL_HANDLE_ACTION, {
            role: 'button',
            label: confirmDialogCancelLabel(cancelLabel, props.title),
          })}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={toneClassName(tone)}
          disabled={props.pending}
          onClick={props.onConfirm}
          {...confirmDialogAgentProps(agentMayConfirm ? baseHandle : undefined, CONFIRM_HANDLE_ACTION, {
            role: 'button',
            label: confirmDialogConfirmLabel(props.confirmLabel, props.title, tone),
          })}
        >
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
