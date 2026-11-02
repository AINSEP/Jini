import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeSketchEditorEngine } from '../../../react/dependencies-fake.js';
import { defaultSketchEditorDependencies } from '../../../dependencies.js';
import { emptySketchScene } from '../../../rules.js';
import { useSketchSaveWorkflow, useWiredSketchSaveWorkflow } from '../../../react/hooks/useSketchSaveWorkflow.js';

const t = (key: string) => key;

/**
 * A controllable `FileReader` double for exercising `blobToBase64`'s (an
 * unexported internal of this file) error/edge branches — real
 * `readAsDataURL()` always succeeds with a well-formed `data:...,<payload>`
 * string in both real browsers and jsdom, so its error path and the
 * defensive non-string/no-comma fallbacks around `.result` can't be reached
 * with a real Blob; this stub drives them directly instead.
 */
class FakeFileReader {
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  result: string | ArrayBuffer | null = null;
  error: Error | null = null;
  readAsDataURL(): void {
    queueMicrotask(() => {
      if (this.error) this.onerror?.();
      else this.onload?.();
    });
  }
}

function baseParams(overrides: Partial<Parameters<typeof useSketchSaveWorkflow>[0]> = {}) {
  return {
    dirty: false,
    saving: false,
    fileName: 'diagram.excalidraw',
    currentScene: () => emptySketchScene('diagram.excalidraw'),
    onSave: vi.fn(async () => true),
    engine: createFakeSketchEditorEngine(),
    t,
    ...overrides,
  };
}

describe('useSketchSaveWorkflow', () => {
  it.each([
    ['null prototype', Object.create(null) as unknown],
    ['throwing coercion', { toString() { throw new Error('coercion failed'); } }],
  ])('shows the export error toast and clears exporting after a %s rejection', async (_label, failure) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const engine = createFakeSketchEditorEngine({ exportToBlob: async () => { throw failure; } });
      const onExportImage = vi.fn();
      const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ engine, onExportImage })));
      await act(async () => { await result.current.handleExportImage(); });
      expect(result.current.toast).toEqual({ message: 'Could not export image', tone: 'error' });
      expect(result.current.exporting).toBe(false);
      expect(onExportImage).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it('shows the saved indicator once savedAt is set (while not dirty/saving), then hides it after the TTL', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook((props) => useSketchSaveWorkflow(props), { initialProps: baseParams({ savedAt: undefined }) });
      expect(result.current.showSaved).toBe(false);

      rerender(baseParams({ savedAt: 1 }));
      expect(result.current.showSaved).toBe(true);

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.showSaved).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the saved indicator immediately once dirty becomes true', () => {
    const { result, rerender } = renderHook((props) => useSketchSaveWorkflow(props), { initialProps: baseParams({ savedAt: 1 }) });
    expect(result.current.showSaved).toBe(true);
    rerender(baseParams({ savedAt: 1, dirty: true }));
    expect(result.current.showSaved).toBe(false);
  });

  it('handleSave calls onSave with the current scene and shows a "Saved" toast', async () => {
    const onSave = vi.fn(async () => true);
    const scene = emptySketchScene('a');
    const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ onSave, currentScene: () => scene })));
    await act(async () => {
      await result.current.handleSave();
    });
    expect(onSave).toHaveBeenCalledWith(scene);
    expect(result.current.showSaved).toBe(true);
    expect(result.current.toast).toEqual({ message: 'Saved', tone: 'success' });
  });

  it('handleSave does not show "Saved" when the host explicitly rejects (returns false)', async () => {
    const onSave = vi.fn(async () => false);
    const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ onSave })));
    await act(async () => {
      await result.current.handleSave();
    });
    expect(result.current.showSaved).toBe(false);
    expect(result.current.toast).toBeNull();
  });

  it('handleExportImage exports via the engine, calls onExportImage, and shows an actionable toast', async () => {
    const onExportImage = vi.fn(async (_base64: string, fileName: string) => ({ fileName }));
    const engine = createFakeSketchEditorEngine();
    const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ onExportImage, engine, fileName: 'diagram.excalidraw' })));
    await act(async () => {
      await result.current.handleExportImage();
    });
    expect(onExportImage).toHaveBeenCalledTimes(1);
    const [base64, requestedFileName] = onExportImage.mock.calls[0]!;
    expect(typeof base64).toBe('string');
    expect(requestedFileName).toBe('diagram.png');
    expect(result.current.toast).toEqual({
      message: 'Image exported',
      details: 'diagram.png',
      tone: 'success',
      actionFileName: 'diagram.png',
    });
  });

  it('handleExportImage defaults exportBackground viewBackgroundColor to white when the scene has none', async () => {
    const engine = createFakeSketchEditorEngine();
    const exportToBlob = vi.spyOn(engine, 'exportToBlob');
    const onExportImage = vi.fn(async () => true);
    const { result } = renderHook(() =>
      useSketchSaveWorkflow(
        baseParams({ engine, onExportImage, currentScene: () => ({ elements: [], appState: {}, files: {} }) }),
      ),
    );
    await act(async () => {
      await result.current.handleExportImage();
    });
    expect(exportToBlob).toHaveBeenCalledWith(expect.objectContaining({ appState: expect.objectContaining({ viewBackgroundColor: '#ffffff' }) }));
  });

  it('handleExportImage does not show a toast when the host explicitly rejects the export (returns false)', async () => {
    const onExportImage = vi.fn(async () => false);
    const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ onExportImage })));
    await act(async () => {
      await result.current.handleExportImage();
    });
    expect(result.current.toast).toBeNull();
  });

  it('handleExportImage is a no-op without an onExportImage handler', async () => {
    const engine = createFakeSketchEditorEngine();
    const exportToBlob = vi.spyOn(engine, 'exportToBlob');
    const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ engine, onExportImage: undefined })));
    await act(async () => {
      await result.current.handleExportImage();
    });
    expect(exportToBlob).not.toHaveBeenCalled();
  });

  it('handleExportImage surfaces an error toast when reading the exported blob fails', async () => {
    const reader = new FakeFileReader();
    const secret = 'ghp_' + 's'.repeat(36);
    reader.error = new Error(`disk read failed ${secret}`);
    vi.stubGlobal(
      'FileReader',
      vi.fn(() => reader),
    );
    try {
      const engine = createFakeSketchEditorEngine();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const onExportImage = vi.fn();
      const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ engine, onExportImage })));
      await act(async () => {
        await result.current.handleExportImage();
      });
      expect(result.current.toast).toEqual({ message: 'Could not export image', tone: 'error' });
      expect(warn).toHaveBeenCalledWith('[SketchEditor] export image failed', expect.stringContaining('[REDACTED:github_token]'));
      expect(String(warn.mock.calls[0]?.[1])).not.toContain(secret);
      expect(onExportImage).not.toHaveBeenCalled();
      warn.mockRestore();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handleExportImage treats a non-string/no-comma FileReader result defensively (empty/unsliced base64)', async () => {
    const reader = new FakeFileReader();
    reader.result = 'no-comma-in-this-string';
    vi.stubGlobal(
      'FileReader',
      vi.fn(() => reader),
    );
    try {
      const engine = createFakeSketchEditorEngine();
      const onExportImage = vi.fn(async (base64: string) => ({ fileName: `captured:${base64}` }));
      const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ engine, onExportImage })));
      await act(async () => {
        await result.current.handleExportImage();
      });
      expect(onExportImage).toHaveBeenCalledWith('no-comma-in-this-string', 'diagram.png', expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handleExportImage surfaces a default error message when FileReader errors with no .error set', async () => {
    // A real FileReader always sets `.error` before firing `onerror`, but its
    // type (`DOMException | null`) doesn't guarantee that to the type
    // checker — this exercises the `?? new Error(...)` fallback directly.
    class ErroringFileReaderWithNoError extends FakeFileReader {
      override readAsDataURL(): void {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal(
      'FileReader',
      vi.fn(() => new ErroringFileReaderWithNoError()),
    );
    try {
      const engine = createFakeSketchEditorEngine();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const onExportImage = vi.fn();
      const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ engine, onExportImage })));
      await act(async () => {
        await result.current.handleExportImage();
      });
      expect(result.current.toast).toEqual({ message: 'Could not export image', tone: 'error' });
      expect(warn).toHaveBeenCalledWith('[SketchEditor] export image failed', expect.stringContaining('Error: Could not read exported image'));
      warn.mockRestore();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handleExportImage falls back to an empty base64 string when FileReader.result is not a string', async () => {
    const reader = new FakeFileReader();
    reader.result = new ArrayBuffer(0); // `readAsDataURL` never actually yields this; defensive-only path
    vi.stubGlobal(
      'FileReader',
      vi.fn(() => reader),
    );
    try {
      const engine = createFakeSketchEditorEngine();
      const onExportImage = vi.fn(async (base64: string) => ({ fileName: `captured:${base64}` }));
      const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ engine, onExportImage })));
      await act(async () => {
        await result.current.handleExportImage();
      });
      expect(onExportImage).toHaveBeenCalledWith('', 'diagram.png', expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handleExportImage surfaces an error toast when export fails', async () => {
    const engine = createFakeSketchEditorEngine({
      exportToBlob: async () => {
        throw new Error('boom');
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onExportImage = vi.fn();
    const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ engine, onExportImage })));
    await act(async () => {
      await result.current.handleExportImage();
    });
    expect(result.current.toast).toEqual({ message: 'Could not export image', tone: 'error' });
    expect(onExportImage).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('handleToastAction opens the exported file and clears the toast', async () => {
    const onOpenExportedImage = vi.fn();
    const onExportImage = vi.fn(async (_b: string, fileName: string) => ({ fileName }));
    const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ onExportImage, onOpenExportedImage })));
    await act(async () => {
      await result.current.handleExportImage();
    });
    act(() => {
      result.current.handleToastAction();
    });
    expect(onOpenExportedImage).toHaveBeenCalledWith('diagram.png');
    expect(result.current.toast).toBeNull();
  });

  it('handleToastAction is a no-op when there is no actionable toast', () => {
    const onOpenExportedImage = vi.fn();
    const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ onOpenExportedImage })));
    act(() => {
      result.current.handleToastAction();
    });
    expect(onOpenExportedImage).not.toHaveBeenCalled();
    expect(result.current.toast).toBeNull();
  });

  it('dismissToast clears the toast', async () => {
    const onSave = vi.fn(async () => true);
    const { result } = renderHook(() => useSketchSaveWorkflow(baseParams({ onSave })));
    await act(async () => {
      await result.current.handleSave();
    });
    expect(result.current.toast).not.toBeNull();
    act(() => {
      result.current.dismissToast();
    });
    expect(result.current.toast).toBeNull();
  });
});

describe('useWiredSketchSaveWorkflow', () => {
  it('binds the real engine from dependencies.ts, not a hand-rolled one', async () => {
    const exportToBlob = vi
      .spyOn(defaultSketchEditorDependencies.engine, 'exportToBlob')
      .mockResolvedValue(new Blob(['wired-export'], { type: 'image/png' }));
    try {
      const onExportImage = vi.fn(async (_base64: string, fileName: string) => ({ fileName }));
      const { result } = renderHook(() =>
        useWiredSketchSaveWorkflow({
          dirty: false,
          saving: false,
          fileName: 'diagram.excalidraw',
          currentScene: () => emptySketchScene('diagram.excalidraw'),
          onSave: vi.fn(async () => true),
          onExportImage,
          t,
        }),
      );
      await act(async () => {
        await result.current.handleExportImage();
      });
      // Proves the wired hook's `handleExportImage` routed through the exact
      // engine object `defaultSketchEditorDependencies` exports, rather than
      // a fresh/fake one the caller would otherwise have to thread by hand.
      expect(exportToBlob).toHaveBeenCalledTimes(1);
      expect(onExportImage).toHaveBeenCalledTimes(1);
    } finally {
      exportToBlob.mockRestore();
    }
  });
});
