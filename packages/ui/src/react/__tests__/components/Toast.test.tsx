// @vitest-environment jsdom
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOAST_DEFAULT_TTL,
  TOAST_EXIT_MS,
  TOAST_TONE_ICON,
  Toast,
  toastAriaLive,
  toastClassName,
  toastEffectiveTtl,
  toastFadeDelay,
  toastShouldAutoDismiss,
  toastToneIcon,
  useLatestRef,
  useToastAutoDismiss,
} from '../../components/Toast.js';

// --- Pure derivations -------------------------------------------------------

describe('Toast pure helpers', () => {
  it('toastEffectiveTtl pins to 0 only when code is a non-empty string', () => {
    expect(toastEffectiveTtl('npm i foo', 4000)).toBe(0);
    expect(toastEffectiveTtl('', 4000)).toBe(4000); // empty string is falsy
    expect(toastEffectiveTtl(null, 4000)).toBe(4000);
    expect(toastEffectiveTtl(undefined, 4000)).toBe(4000);
  });

  it('toastToneIcon maps each tone to its glyph', () => {
    expect(toastToneIcon('default')).toBeNull();
    expect(toastToneIcon('success')).toBe('check');
    expect(toastToneIcon('error')).toBe('close');
    expect(toastToneIcon('loading')).toBe('spinner');
    // The exported table backs the helper.
    expect(TOAST_TONE_ICON.success).toBe('check');
  });

  it('toastAriaLive is assertive for alerts, polite otherwise', () => {
    expect(toastAriaLive('alert')).toBe('assertive');
    expect(toastAriaLive('status')).toBe('polite');
  });

  it('toastShouldAutoDismiss requires a callback, a finite TTL, and TTL > 0', () => {
    expect(toastShouldAutoDismiss(true, 1000)).toBe(true);
    expect(toastShouldAutoDismiss(false, 1000)).toBe(false); // no callback
    expect(toastShouldAutoDismiss(true, 0)).toBe(false); // pinned
    expect(toastShouldAutoDismiss(true, -5)).toBe(false); // negative
    expect(toastShouldAutoDismiss(true, Infinity)).toBe(false); // non-finite
    expect(toastShouldAutoDismiss(true, Number.NaN)).toBe(false); // non-finite
  });

  it('toastFadeDelay starts the fade TOAST_EXIT_MS early, clamped at 0', () => {
    expect(toastFadeDelay(4000)).toBe(4000 - TOAST_EXIT_MS);
    expect(toastFadeDelay(TOAST_EXIT_MS)).toBe(0);
    expect(toastFadeDelay(50)).toBe(0); // shorter than the fade window -> clamped
    expect(TOAST_EXIT_MS).toBe(160);
    expect(TOAST_DEFAULT_TTL).toBe(4000);
  });

  it('toastClassName composes tone/placement and optional className + leaving', () => {
    expect(toastClassName({ tone: 'default', placement: 'bottom', leaving: false }))
      .toBe('jini-toast tone-default placement-bottom');
    expect(toastClassName({ tone: 'success', placement: 'top', className: 'wide', leaving: false }))
      .toBe('jini-toast tone-success placement-top wide');
    expect(toastClassName({ tone: 'error', placement: 'bottom', leaving: true }))
      .toBe('jini-toast tone-error placement-bottom leaving');
    expect(toastClassName({ tone: 'loading', placement: 'top', className: 'wide', leaving: true }))
      .toBe('jini-toast tone-loading placement-top wide leaving');
  });
});

// --- useLatestRef -----------------------------------------------------------

describe('useLatestRef', () => {
  it('exposes the initial value and updates to the latest after re-render', () => {
    const { result, rerender } = renderHook(({ v }) => useLatestRef(v), {
      initialProps: { v: 1 },
    });
    expect(result.current.current).toBe(1);
    rerender({ v: 2 });
    expect(result.current.current).toBe(2);
    rerender({ v: 3 });
    expect(result.current.current).toBe(3);
  });
});

// --- useToastAutoDismiss ----------------------------------------------------

describe('useToastAutoDismiss', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sets leaving at the fade delay and fires onDismiss at the TTL', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() =>
      useToastAutoDismiss({ message: 'Saved', effectiveTtl: 1000, onDismiss }),
    );
    expect(result.current.leaving).toBe(false);
    act(() => vi.advanceTimersByTime(toastFadeDelay(1000))); // 840ms
    expect(result.current.leaving).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(TOAST_EXIT_MS)); // remaining 160ms -> 1000ms
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not arm timers when there is no dismiss callback', () => {
    const { result } = renderHook(() =>
      useToastAutoDismiss({ message: 'x', effectiveTtl: 1000 }),
    );
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.leaving).toBe(false);
  });

  it('does not arm timers when effectiveTtl is 0 (pinned)', () => {
    const onDismiss = vi.fn();
    renderHook(() => useToastAutoDismiss({ message: 'x', effectiveTtl: 0, onDismiss }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('fireDismiss invokes the latest callback when present', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() =>
      useToastAutoDismiss({ message: 'x', effectiveTtl: 0, onDismiss }),
    );
    act(() => result.current.fireDismiss());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('fireDismiss is a safe no-op when no callback is present (defensive guard)', () => {
    const { result } = renderHook(() =>
      useToastAutoDismiss({ message: 'x', effectiveTtl: 0 }),
    );
    expect(() => act(() => result.current.fireDismiss())).not.toThrow();
  });

  it('re-arms and clears the leaving flag when the message changes', () => {
    const onDismiss = vi.fn();
    const { result, rerender } = renderHook(
      ({ message }) => useToastAutoDismiss({ message, effectiveTtl: 1000, onDismiss }),
      { initialProps: { message: 'first' } },
    );
    act(() => vi.advanceTimersByTime(900)); // past fade start
    expect(result.current.leaving).toBe(true);
    rerender({ message: 'second' }); // re-entrant reuse resets leaving + re-arms
    expect(result.current.leaving).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(onDismiss).toHaveBeenCalledTimes(1); // only the re-armed timer fired
  });

  it('keeps a stable countdown when a fresh onDismiss identity arrives mid-flight', () => {
    const spy = vi.fn();
    const { rerender } = renderHook(
      ({ cb }) => useToastAutoDismiss({ message: 'run', effectiveTtl: 1000, onDismiss: cb }),
      { initialProps: { cb: () => spy() } },
    );
    act(() => vi.advanceTimersByTime(500));
    // A brand-new closure identity should NOT re-arm the timer (deadline holds).
    rerender({ cb: () => spy() });
    act(() => vi.advanceTimersByTime(500));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// --- Component --------------------------------------------------------------

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-dismisses after ttlMs', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Saved" ttlMs={1000} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('defaults ttlMs to TOAST_DEFAULT_TTL when omitted', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Saved" onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(TOAST_DEFAULT_TTL - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('applies the leaving class once the fade begins', () => {
    const onDismiss = vi.fn();
    const { container } = render(<Toast message="Saved" ttlMs={1000} onDismiss={onDismiss} />);
    const root = container.querySelector('.jini-toast')!;
    expect(root.classList.contains('leaving')).toBe(false);
    act(() => vi.advanceTimersByTime(toastFadeDelay(1000)));
    expect(root.classList.contains('leaving')).toBe(true);
  });

  it('never auto-dismisses when code is present', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Copy failed" code="npm install foo" ttlMs={1000} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('renders a tone icon and status glyph for a non-default tone', () => {
    const { container } = render(<Toast message="Done" tone="success" ttlMs={0} />);
    expect(container.querySelector('.jini-toast-icon')).not.toBeNull();
    expect(container.querySelector('.jini-toast.tone-success')).not.toBeNull();
  });

  it('renders no tone icon for the default tone', () => {
    const { container } = render(<Toast message="Plain" ttlMs={0} />);
    expect(container.querySelector('.jini-toast-icon')).toBeNull();
  });

  it('applies a custom className and top placement', () => {
    const { container } = render(<Toast message="Hi" className="wide" placement="top" ttlMs={0} />);
    const root = container.querySelector('.jini-toast')!;
    expect(root.classList.contains('wide')).toBe(true);
    expect(root.classList.contains('placement-top')).toBe(true);
  });

  it('uses aria-live=assertive for the alert role', () => {
    render(<Toast message="Failed" role="alert" ttlMs={0} />);
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('renders details and an action button, preferring actionAriaLabel', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <Toast
        message="Upload failed"
        details="Network error"
        actionLabel="Retry"
        actionAriaLabel="Retry upload"
        onAction={onAction}
        ttlMs={0}
      />,
    );
    expect(screen.getByText('Network error')).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Retry upload' });
    await user.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('falls back to actionLabel for the action aria-label', () => {
    render(
      <Toast message="Upload failed" actionLabel="Retry" onAction={vi.fn()} ttlMs={0} />,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('renders no action button when onAction is missing', () => {
    const { container } = render(<Toast message="No action" actionLabel="Retry" ttlMs={0} />);
    expect(container.querySelector('.jini-toast-action')).toBeNull();
  });

  it('renders the icon close button (not code) when onDismiss is present', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const { container } = render(<Toast message="Bye" ttlMs={0} onDismiss={onDismiss} />);
    expect(container.querySelector('.jini-toast-dismiss')).toBeNull();
    const close = container.querySelector('.jini-toast-close')!;
    await user.click(close as HTMLElement);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders the labelled Dismiss button for a code toast with onDismiss', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const { container } = render(
      <Toast message="Copy" code="ls -la" ttlMs={0} onDismiss={onDismiss} />,
    );
    expect(container.querySelector('.jini-toast-close')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders neither dismiss button when onDismiss is absent', () => {
    const { container } = render(<Toast message="Ephemeral" ttlMs={0} />);
    expect(container.querySelector('.jini-toast-close')).toBeNull();
    expect(container.querySelector('.jini-toast-dismiss')).toBeNull();
  });

  it('does not re-arm the timer on parent re-renders with a fresh onDismiss closure', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast message="Running 1s" ttlMs={1000} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(500));
    // Simulate a parent re-render passing a brand new closure identity.
    rerender(<Toast message="Running 1s" ttlMs={1000} onDismiss={() => onDismiss()} />);
    act(() => vi.advanceTimersByTime(500));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('Toast with hook override prop', () => {
  it('uses useToastAutoDismiss hook prop to render normal non-leaving state (state 1)', () => {
    const customHook = () => ({ leaving: false, fireDismiss: vi.fn() });

    const { container } = render(
      <Toast message="Test Toast" useToastAutoDismiss={customHook} />,
    );

    const toastDiv = container.querySelector('.jini-toast')!;
    expect(toastDiv).toBeTruthy();
    expect(toastDiv.className).not.toContain('leaving');
  });

  it('uses useToastAutoDismiss hook prop to render leaving animation state (state 2)', () => {
    const customHook = () => ({ leaving: true, fireDismiss: vi.fn() });

    const { container } = render(
      <Toast message="Test Toast" useToastAutoDismiss={customHook} />,
    );

    const toastDiv = container.querySelector('.jini-toast')!;
    expect(toastDiv).toBeTruthy();
    expect(toastDiv.className).toContain('leaving');
  });
});
