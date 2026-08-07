import { useEffect, useRef, useState } from 'react';

/**
 * @file Shared two-click, in-place confirmation control for destructive or access-affecting
 * actions.
 *
 * Exists because confirmation coverage is otherwise a coin flip: some screens guard a delete, some
 * ship a bare single-click Disable, and the ones that do guard each reinvent the interaction. This
 * is the one shape every screen can import instead of rebuilding.
 *
 * Chosen over a `window.confirm` wrapper: `window.confirm` blocks the whole tab and cannot carry
 * destructive-vs-warning styling or a screen-reader-specific announcement. Chosen over a shared
 * modal for the common case because the in-place shape needs no new markup at all — it renders as
 * an ordinary `<button>`, optionally with `.btn-danger`.
 *
 * Not a replacement for {@link ConfirmDialog}: an operation with real context to disclose ("this
 * restores a snapshot from 3 days ago and drops 41 entries") needs a modal that can show it. This
 * is for the common case — a single row action that would otherwise be bare or a `window.confirm`.
 */

const DEFAULT_PENDING_LABEL = '…';

export interface ConfirmButtonProps {
  /** Resting-state label, e.g. "Delete". */
  label: string;
  /** Label shown after the first (arming) click, while awaiting the confirming second click. */
  confirmLabel: string;
  /** Fired on the second (confirming) click. The caller owns in-flight/error state after that —
   *  this component only owns the armed/disarmed distinction. */
  onConfirm: () => void;
  /** Applies `.btn-danger`. Reserve for genuinely irreversible actions; a reversible-but-access-
   *  affecting action (e.g. Disable) should leave this `false` — see {@link ConfirmTone}'s
   *  warning-vs-danger split, which this boolean predates and cannot express. */
  destructive?: boolean;
  /** External in-flight flag (e.g. `rowSavingId === row.id`). Shows `pendingLabel` and disables the
   *  control. Not itself cancelable — a click already fired `onConfirm` by the time this is true. */
  pending?: boolean;
  pendingLabel?: string;
  /** Disables the control outright — e.g. a built-in row the server would reject anyway. */
  disabled?: boolean;
  className?: string;
  /** Overrides the computed accessible name. Use when several identical-looking controls share a
   *  page (one "Delete" per table row) and the row's own text doesn't disambiguate them for a
   *  screen-reader user navigating control-by-control rather than row-by-row. */
  ariaLabel?: string;
}

/**
 * Two-click in-place confirm button. First click arms it: swaps the visible label to `confirmLabel`
 * and announces the armed state through a `.visually-hidden` live region (a separate region rather
 * than relying on the button's own label swap, since AT support for announcing a text change inside
 * a live-region-less `<button>`'s accessible name is inconsistent across screen readers). Second
 * click fires `onConfirm` and disarms immediately. Losing focus, an outside click, or Escape
 * disarms without firing, so a control armed and then abandoned (a slow screen-reader read-through,
 * a misclick landing elsewhere) cannot later be fired by an unrelated click landing on the same
 * screen position.
 *
 * @complexity O(1) per render/interaction. The two document-level listeners are attached only while
 * armed, not for the component's whole mounted lifetime.
 */
export function ConfirmButton(props: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Listeners are scoped to the armed window only — an idle (disarmed) ConfirmButton costs nothing
  // beyond the button element itself, so mounting many of them (one per table row) does not add a
  // standing per-row document listener.
  useEffect(() => {
    if (!confirming) return;
    function disarm() {
      setConfirming(false);
    }
    function onDocMouseDown(e: globalThis.MouseEvent) {
      if (!buttonRef.current?.contains(e.target as Node)) disarm();
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') disarm();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [confirming]);

  function handleClick() {
    if (props.pending || props.disabled) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    props.onConfirm();
  }

  const label = props.pending
    ? (props.pendingLabel ?? DEFAULT_PENDING_LABEL)
    : confirming
      ? props.confirmLabel
      : props.label;
  const className = [props.className, props.destructive ? 'btn-danger' : null].filter(Boolean).join(' ') || undefined;

  return (
    <>
      {/* `data-armed` exists so CSS can tell a resting destructive action from an armed one. It
          carries no behavior — `confirming` is still the only source of truth — but without it a
          stylesheet has no way to distinguish the two states, which is what forces every row's
          Delete to paint full `.btn-danger` at rest and produces the "wall of red" a table of N
          rows becomes. Host row-scoped rules should key off this to stay quiet until the action is
          actually armed. */}
      <button
        ref={buttonRef}
        type="button"
        className={className}
        data-armed={confirming ? 'true' : undefined}
        disabled={props.disabled || props.pending}
        onClick={handleClick}
        onBlur={() => setConfirming(false)}
        aria-label={props.ariaLabel}
      >
        {label}
      </button>
      {/* `position: absolute` in the host's `.visually-hidden` rule takes this out of flow, so it
          never affects a flex-row action group's gap/sizing regardless of where this component is
          placed. */}
      <span className="visually-hidden" role="status" aria-live="polite">
        {confirming ? `Press "${props.confirmLabel}" to confirm, or press Escape to cancel.` : ''}
      </span>
    </>
  );
}
