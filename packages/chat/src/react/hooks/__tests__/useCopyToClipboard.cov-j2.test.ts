import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopyToClipboard } from '../useCopyToClipboard.js';

/**
 * `copy()` tries the async Clipboard API first and falls back to a hidden-textarea
 * `execCommand('copy')`; `copied` flips on only for a copy that actually happened, then resets.
 * The browser's clipboard surfaces are swapped per test and restored, never module-mocked.
 */
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

function setClipboard(clipboard: Partial<Clipboard> | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
}

function setExecCommand(impl: (command: string) => boolean): { copiedText: () => string | undefined } {
  let copied: string | undefined;
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: (command: string) => {
      const selected = document.activeElement as HTMLTextAreaElement | null;
      const ok = impl(command);
      if (ok) copied = selected?.value;
      return ok;
    },
  });
  return { copiedText: () => copied };
}

describe('useCopyToClipboard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else delete (navigator as { clipboard?: Clipboard }).clipboard;
    if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
    else delete (document as { execCommand?: unknown }).execCommand;
  });

  it('writes through the Clipboard API, flags copied, and resets the flag after the timeout', async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    const { result } = renderHook(() => useCopyToClipboard());

    let ok = false;
    await act(async () => { ok = await result.current.copy('hello'); });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.copied).toBe(false);
  });

  it('falls back to execCommand when the Clipboard API rejects, and removes its textarea', async () => {
    setClipboard({ writeText: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }) });
    const exec = setExecCommand(() => true);
    const { result } = renderHook(() => useCopyToClipboard());

    let ok = false;
    await act(async () => { ok = await result.current.copy('fallback text'); });
    expect(ok).toBe(true);
    expect(exec.copiedText()).toBe('fallback text');
    expect(result.current.copied).toBe(true);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('uses execCommand directly when there is no Clipboard API', async () => {
    setClipboard(undefined);
    const exec = setExecCommand(() => true);
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => { await result.current.copy('no api'); });
    expect(exec.copiedText()).toBe('no api');
  });

  it('reports failure and leaves copied off when execCommand throws', async () => {
    setClipboard(undefined);
    setExecCommand(() => { throw new Error('sandboxed iframe'); });
    const { result } = renderHook(() => useCopyToClipboard());

    let ok = true;
    await act(async () => { ok = await result.current.copy('blocked'); });
    expect(ok).toBe(false);
    expect(result.current.copied).toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure when execCommand declines the copy', async () => {
    setClipboard(undefined);
    setExecCommand(() => false);
    const { result } = renderHook(() => useCopyToClipboard());
    let ok = true;
    await act(async () => { ok = await result.current.copy('declined'); });
    expect(ok).toBe(false);
    expect(result.current.copied).toBe(false);
  });

  it('reports failure without touching the DOM in a runtime with neither navigator nor document', async () => {
    const { result } = renderHook(() => useCopyToClipboard());
    const copy = result.current.copy;
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('document', undefined);
    // No React work runs here: a failed copy never sets state.
    const ok = await copy('nowhere to put it');
    vi.unstubAllGlobals();
    expect(ok).toBe(false);
    expect(result.current.copied).toBe(false);
  });
});
