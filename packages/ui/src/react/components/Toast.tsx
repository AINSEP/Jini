// Lightweight transient toast. Single-toast queue driven entirely by the
// host's own state (`message`/`onDismiss`); no portal, no DOM imperative
// work. Multi-toast support is deliberately left to the host to compose by
// rendering multiple instances.
//
// Renders an optional secondary `details` line beneath the primary message
// so callers whose error envelopes carry an upstream explanation can surface
// it alongside the primary category label.
//
// Structure follows the "dumb component + co-located testable hook(s)"
// pattern (see TooltipLayer.tsx): the pure derivations are module-level
// helpers, all state/effects/timers live in exported hooks, and `Toast`
// itself is a pure render. Everything is exported so each seam is unit- or
// hook-testable in isolation.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import { Icon } from './Icon.js';

export type ToastTone = 'default' | 'success' | 'error' | 'loading';
export type ToastPlacement = 'bottom' | 'top';
export type ToastRole = 'status' | 'alert';
export type ToastToneIcon = 'check' | 'close' | 'spinner' | null;

export interface ToastProps {
  message: string;
  className?: string;
  details?: string | null;
  actionLabel?: string | null;
  actionAriaLabel?: string;
  onAction?: () => void;
  // Optional code/preformatted body. When present the toast pins itself open
  // (no auto-dismiss) so the user has time to manually copy the content.
  code?: string | null;
  ttlMs?: number;
  onDismiss?: () => void;
  /** ARIA role. Use "alert" for error messages (announced immediately),
   *  "status" (default) for non-urgent confirmations. */
  role?: ToastRole;
  tone?: ToastTone;
  placement?: ToastPlacement;
  /** Custom hook override for dependency injection / testing. */
  useToastAutoDismiss?: typeof useToastAutoDismiss;
}

export const TOAST_DEFAULT_TTL = 4000;
// Exit fade duration — kept in sync with the `.jini-toast.leaving` CSS
// animation the host supplies. The fade plays inside the TTL window (it
// begins at ttlMs - TOAST_EXIT_MS) so the toast unmounts at exactly ttlMs.
export const TOAST_EXIT_MS = 160;

// A leading status glyph makes the toast's outcome readable at a glance: a
// check for confirmations, a spinner while an action is in flight, and a
// cross for failures.
export const TOAST_TONE_ICON: Record<ToastTone, ToastToneIcon> = {
  default: null,
  success: 'check',
  error: 'close',
  loading: 'spinner',
};

// --- Pure derivations (module-level, directly unit-testable) --------------

/**
 * When `code` is present the toast is a manual-action surface, so it must
 * never auto-dismiss out from under the user mid-copy: its effective TTL is
 * forced to 0. Otherwise the caller's `ttlMs` stands.
 */
export function toastEffectiveTtl(
  code: string | null | undefined,
  ttlMs: number,
): number {
  return code ? 0 : ttlMs;
}

/** The leading status glyph for a tone (or `null` for the default tone). */
export function toastToneIcon(tone: ToastTone): ToastToneIcon {
  return TOAST_TONE_ICON[tone];
}

/** ARIA live politeness derived from the role: alerts announce assertively. */
export function toastAriaLive(role: ToastRole): 'assertive' | 'polite' {
  return role === 'alert' ? 'assertive' : 'polite';
}

/**
 * The auto-dismiss timers only arm when there is a dismiss callback and the
 * TTL is a finite, positive number of milliseconds. A zero/negative/non-finite
 * TTL (or a pinned code toast) pins the toast open.
 */
export function toastShouldAutoDismiss(
  hasDismiss: boolean,
  effectiveTtl: number,
): boolean {
  return hasDismiss && Number.isFinite(effectiveTtl) && effectiveTtl > 0;
}

/**
 * When the fade-out should begin: `TOAST_EXIT_MS` before the deadline so the
 * exit animation plays within the TTL window and the dismiss lands at exactly
 * `effectiveTtl`. Clamped to 0 for very short TTLs.
 */
export function toastFadeDelay(effectiveTtl: number): number {
  return Math.max(0, effectiveTtl - TOAST_EXIT_MS);
}

/** The root `className` string, composed from tone/placement/extra/leaving. */
export function toastClassName(options: {
  tone: ToastTone;
  placement: ToastPlacement;
  className?: string | undefined;
  leaving: boolean;
}): string {
  const { tone, placement, className, leaving } = options;
  return `jini-toast tone-${tone} placement-${placement}${className ? ` ${className}` : ''}${leaving ? ' leaving' : ''}`;
}

// --- Hooks (co-located, exported) -----------------------------------------

/**
 * Holds the latest `value` in a ref, updated after every commit. Lets an
 * effect read the current value without listing it as a dependency (so the
 * effect's identity/lifetime stays stable across value churn).
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export interface UseToastAutoDismissOptions {
  message: string;
  details?: string | null | undefined;
  code?: string | null | undefined;
  effectiveTtl: number;
  onDismiss?: (() => void) | undefined;
}

export interface UseToastAutoDismissResult {
  /** Whether the exit-fade class should currently be applied. */
  leaving: boolean;
  /**
   * Invoke the latest dismiss callback, if any. Used internally by the
   * dismiss timer; exported so the no-callback guard is directly testable.
   */
  fireDismiss: () => void;
}

/**
 * Owns the toast's transient timing: the `leaving` fade flag and the two
 * `setTimeout`s (fade start, then dismiss). The dismiss callback is read
 * through a latched ref so a parent passing a fresh `onDismiss` closure on
 * every render doesn't clear-and-re-arm the timers (which would push the
 * deadline forward forever). The timers re-arm only when the values that
 * should reset the countdown change: `message`/`details`/`code`/`effectiveTtl`
 * and whether a callback exists at all (`hasDismiss`).
 */
export function useToastAutoDismiss(
  options: UseToastAutoDismissOptions,
): UseToastAutoDismissResult {
  const { message, details, code, effectiveTtl, onDismiss } = options;
  const onDismissRef = useLatestRef(onDismiss);
  // Stable identity: reads the latest callback via the ref at fire time.
  const fireDismiss = useCallback(() => {
    onDismissRef.current?.();
  }, [onDismissRef]);

  // `hasDismiss` is a stable boolean: re-arm only when the callback appears
  // or disappears, not when its identity changes while staying defined.
  const hasDismiss = !!onDismiss;
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Re-entrant: a new message reuses the same mounted toast, so clear any
    // prior leaving state before re-arming the timers.
    setLeaving(false);
    if (!toastShouldAutoDismiss(hasDismiss, effectiveTtl)) return;
    const fadeId = window.setTimeout(() => setLeaving(true), toastFadeDelay(effectiveTtl));
    const dismissId = window.setTimeout(fireDismiss, effectiveTtl);
    return () => {
      window.clearTimeout(fadeId);
      window.clearTimeout(dismissId);
    };
  }, [message, details, code, effectiveTtl, hasDismiss, fireDismiss]);

  return { leaving, fireDismiss };
}

// --- Dumb component --------------------------------------------------------

/**
 * Pure render of a transient toast. All timing/state lives in
 * {@link useToastAutoDismiss}; all derivations in the module-level helpers.
 * Animation is owned entirely by CSS the host supplies (`.jini-toast`
 * entrance keyframe on mount, `.leaving` exit keyframe on exit).
 */
export function Toast({
  message,
  className,
  details,
  actionLabel,
  actionAriaLabel,
  onAction,
  code,
  ttlMs = TOAST_DEFAULT_TTL,
  onDismiss,
  role = 'status',
  tone = 'default',
  placement = 'bottom',
  useToastAutoDismiss: useToastAutoDismissHook = useToastAutoDismiss,
}: ToastProps) {
  const effectiveTtl = toastEffectiveTtl(code, ttlMs);
  const { leaving } = useToastAutoDismissHook({ message, details, code, effectiveTtl, onDismiss });
  const iconName = toastToneIcon(tone);

  return (
    <div
      className={toastClassName({ tone, placement, className, leaving })}
      role={role}
      aria-live={toastAriaLive(role)}
    >
      <div className="jini-toast-body">
        {iconName ? (
          <span className="jini-toast-icon" aria-hidden>
            <Icon name={iconName} size={14} />
          </span>
        ) : null}
        <div className="jini-toast-message">{message}</div>
      </div>
      {details ? <div className="jini-toast-details">{details}</div> : null}
      {code ? (
        <pre className="jini-toast-code">{code}</pre>
      ) : null}
      {actionLabel && onAction ? (
        <button
          type="button"
          className="jini-toast-action"
          onClick={onAction}
          aria-label={actionAriaLabel ?? actionLabel}
        >
          {actionLabel}
        </button>
      ) : null}
      {!code && onDismiss ? (
        <button
          type="button"
          className="jini-toast-close"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <Icon name="close" size={13} />
        </button>
      ) : null}
      {code && onDismiss ? (
        <button
          type="button"
          className="jini-toast-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
