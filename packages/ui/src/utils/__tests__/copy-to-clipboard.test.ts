import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from '../copy-to-clipboard.js';

// This package has no jsdom/happy-dom test environment wired up yet (see
// packages/ui/archived provenance ledger), so DOM globals are stubbed by hand here with
// the minimum surface `copyToClipboard` actually touches, rather than
// pulling in a full DOM test environment for one function.

class FakeElement {
  style: Record<string, string> = {};
  value = '';
  focus(_options?: { preventScroll?: boolean }): void {}
  select(): void {}
  get isConnected(): boolean {
    return true;
  }
}

function installFakeDom(options: { execCommandResult: boolean | 'throw' }) {
  const appendChild = vi.fn();
  const removeChild = vi.fn();
  const execCommand = vi.fn(() => {
    if (options.execCommandResult === 'throw') throw new Error('execCommand unsupported');
    return options.execCommandResult;
  });
  const priorFocusElement = new FakeElement();
  const focusSpy = vi.spyOn(priorFocusElement, 'focus');

  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('document', {
    activeElement: priorFocusElement,
    createElement: () => new FakeElement(),
    execCommand,
    body: { appendChild, removeChild },
  });

  return { appendChild, removeChild, execCommand, priorFocusElement, focusSpy };
}

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true via the Clipboard API without touching the DOM fallback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { appendChild } = installFakeDom({ execCommandResult: true });

    await expect(copyToClipboard({ text: 'hello' })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(appendChild).not.toHaveBeenCalled();
  });

  describe('when the Clipboard API rejects', () => {
    beforeEach(() => {
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      });
    });

    it('falls back to execCommand(copy) and restores prior focus', async () => {
      const { appendChild, removeChild, execCommand, focusSpy } = installFakeDom({
        execCommandResult: true,
      });

      await expect(copyToClipboard({ text: 'fallback text' })).resolves.toBe(true);
      expect(appendChild).toHaveBeenCalledTimes(1);
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(removeChild).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenCalled();
    });

    it('returns false when execCommand reports failure', async () => {
      installFakeDom({ execCommandResult: false });
      await expect(copyToClipboard({ text: 'x' })).resolves.toBe(false);
    });

    it('returns false when execCommand throws', async () => {
      const { removeChild } = installFakeDom({ execCommandResult: 'throw' });
      await expect(copyToClipboard({ text: 'x' })).resolves.toBe(false);
      // Cleanup still runs even when execCommand throws.
      expect(removeChild).toHaveBeenCalledTimes(1);
    });

    it('skips focus restoration when there was no prior active element', async () => {
      const appendChild = vi.fn();
      const removeChild = vi.fn();
      const execCommand = vi.fn(() => true);
      vi.stubGlobal('HTMLElement', FakeElement);
      vi.stubGlobal('document', {
        activeElement: null,
        createElement: () => new FakeElement(),
        execCommand,
        body: { appendChild, removeChild },
      });

      await expect(copyToClipboard({ text: 'x' })).resolves.toBe(true);
      expect(removeChild).toHaveBeenCalledTimes(1);
    });

    it('skips focus restoration when the prior active element is no longer connected', async () => {
      const appendChild = vi.fn();
      const removeChild = vi.fn();
      const execCommand = vi.fn(() => true);
      const disconnectedElement = new FakeElement();
      const focusSpy = vi.spyOn(disconnectedElement, 'focus');
      vi.spyOn(disconnectedElement, 'isConnected', 'get').mockReturnValue(false);
      vi.stubGlobal('HTMLElement', FakeElement);
      vi.stubGlobal('document', {
        activeElement: disconnectedElement,
        createElement: () => new FakeElement(),
        execCommand,
        body: { appendChild, removeChild },
      });

      await expect(copyToClipboard({ text: 'x' })).resolves.toBe(true);
      expect(focusSpy).not.toHaveBeenCalled();
    });

    it('falls back to a plain focus() call when focus({ preventScroll }) throws', async () => {
      const appendChild = vi.fn();
      const removeChild = vi.fn();
      const execCommand = vi.fn(() => true);
      const priorFocusElement = new FakeElement();
      const focusCalls: Array<{ preventScroll?: boolean } | undefined> = [];
      priorFocusElement.focus = (options?: { preventScroll?: boolean }) => {
        focusCalls.push(options);
        if (options) throw new Error('preventScroll unsupported');
      };
      vi.stubGlobal('HTMLElement', FakeElement);
      vi.stubGlobal('document', {
        activeElement: priorFocusElement,
        createElement: () => new FakeElement(),
        execCommand,
        body: { appendChild, removeChild },
      });

      await expect(copyToClipboard({ text: 'x' })).resolves.toBe(true);
      expect(focusCalls).toEqual([{ preventScroll: true }, undefined]);
    });
  });
});
