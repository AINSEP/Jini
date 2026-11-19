import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptySketchScene } from '../../../rules.js';
import type { SketchScene } from '../../../types.js';
import { useSketchScene } from '../../../react/hooks/useSketchScene.js';

function makeScene(overrides: Partial<SketchScene> = {}): SketchScene {
  return { elements: [], appState: { viewBackgroundColor: '#fff' }, files: {}, ...overrides };
}

describe('useSketchScene', () => {
  it('builds initial data from the scene/fileName on first render', () => {
    const scene = makeScene({ elements: [{ id: '1' }] });
    const { result } = renderHook(() => useSketchScene({ scene, fileName: 'a.excalidraw', onSceneChange: vi.fn() }));
    expect(result.current.initialData.elements).toEqual(scene.elements);
    expect(result.current.editorInstanceKey).toBe('a.excalidraw:0');
  });

  it('skips the first onChange call (Excalidraw hydration) without invoking onSceneChange', () => {
    const onSceneChange = vi.fn();
    const { result } = renderHook(() => useSketchScene({ scene: makeScene(), fileName: 'a', onSceneChange }));
    result.current.handleChange([{ id: '1', version: 1, versionNonce: 1 }] as never, { viewBackgroundColor: '#fff' } as never, {} as never);
    expect(onSceneChange).not.toHaveBeenCalled();
  });

  it('calls onSceneChange with markDirty on a real content change after hydration', () => {
    const onSceneChange = vi.fn();
    const { result } = renderHook(() => useSketchScene({ scene: makeScene(), fileName: 'a', onSceneChange }));
    // First call is the hydration no-op.
    result.current.handleChange([] as never, {} as never, {} as never);
    result.current.handleChange([{ id: '1', version: 1, versionNonce: 1, isDeleted: false }] as never, { viewBackgroundColor: '#fff' } as never, {} as never);
    expect(onSceneChange).toHaveBeenCalledTimes(1);
    expect(onSceneChange).toHaveBeenCalledWith(expect.objectContaining({ elements: [{ id: '1', version: 1, versionNonce: 1, isDeleted: false }] }), {
      markDirty: true,
    });
  });

  it('dedupes a repeated identical content signature', () => {
    const onSceneChange = vi.fn();
    const { result } = renderHook(() => useSketchScene({ scene: makeScene(), fileName: 'a', onSceneChange }));
    const elements = [{ id: '1', version: 1, versionNonce: 1, isDeleted: false }] as never;
    const appState = { viewBackgroundColor: '#fff' } as never;
    result.current.handleChange([] as never, {} as never, {} as never); // hydration
    result.current.handleChange(elements, appState, {} as never);
    result.current.handleChange(elements, appState, {} as never);
    expect(onSceneChange).toHaveBeenCalledTimes(1);
  });

  it('currentScene falls back to the scene prop when no Excalidraw API is bound', () => {
    const scene = makeScene({ elements: [{ id: 'x' }] });
    const { result } = renderHook(() => useSketchScene({ scene, fileName: 'a', onSceneChange: vi.fn() }));
    expect(result.current.currentScene()).toEqual(scene);
  });

  it('currentScene reads from the bound Excalidraw API once handleExcalidrawAPI fires', () => {
    const { result } = renderHook(() => useSketchScene({ scene: makeScene(), fileName: 'a', onSceneChange: vi.fn() }));
    result.current.handleExcalidrawAPI({
      updateScene: vi.fn(),
      getSceneElementsIncludingDeleted: () => [{ id: 'live' }],
      getAppState: () => ({ viewBackgroundColor: '#000' }),
      getFiles: () => ({}),
    } as never);
    expect(result.current.currentScene().elements).toEqual([{ id: 'live' }]);
  });

  it('handleClear calls the host onClear when provided, without emitting an empty scene', () => {
    const onClear = vi.fn();
    const onSceneChange = vi.fn();
    const { result } = renderHook(() => useSketchScene({ scene: makeScene(), fileName: 'a', onSceneChange, onClear }));
    result.current.handleClear();
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onSceneChange).not.toHaveBeenCalled();
  });

  it('handleClear emits an empty scene via onSceneChange when no onClear is given', () => {
    const onSceneChange = vi.fn();
    const { result } = renderHook(() => useSketchScene({ scene: makeScene(), fileName: 'a.excalidraw', onSceneChange }));
    result.current.handleClear();
    expect(onSceneChange).toHaveBeenCalledWith(emptySketchScene({}, { name: 'a.excalidraw' }), { markDirty: true });
  });

  it('handleClear bumps the editor instance key, forcing a remount', () => {
    const { result, rerender } = renderHook(() => useSketchScene({ scene: makeScene(), fileName: 'a', onSceneChange: vi.fn() }));
    const before = result.current.editorInstanceKey;
    result.current.handleClear();
    rerender();
    expect(result.current.editorInstanceKey).not.toBe(before);
  });

  it('closeActiveDialog clears the open dialog via the bound API', () => {
    const updateScene = vi.fn();
    const { result } = renderHook(() => useSketchScene({ scene: makeScene(), fileName: 'a', onSceneChange: vi.fn() }));
    result.current.handleExcalidrawAPI({
      updateScene,
      getSceneElementsIncludingDeleted: () => [],
      getAppState: () => ({}),
      getFiles: () => ({}),
    } as never);
    result.current.closeActiveDialog();
    expect(updateScene).toHaveBeenCalledWith({ appState: { openDialog: null } });
  });
});
