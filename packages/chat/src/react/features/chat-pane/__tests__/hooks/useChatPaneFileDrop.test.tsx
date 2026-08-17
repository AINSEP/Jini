import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useChatPaneFileDrop } from '../../hooks/useChatPaneFileDrop.hooks.js';

function fileDragEvent(overrides: {
  type?: string;
  types?: string[] | undefined;
  items?: Array<{ kind: string }> | undefined;
  files?: File[];
  currentTarget?: { contains: (node: Node | null) => boolean };
  relatedTarget?: Node | null;
} = {}): DragEvent<HTMLDivElement> {
  return {
    type: overrides.type ?? 'dragenter',
    preventDefault: vi.fn(),
    currentTarget: overrides.currentTarget ?? { contains: () => false },
    relatedTarget: overrides.relatedTarget ?? null,
    dataTransfer: {
      types: overrides.types,
      items: overrides.items,
      files: overrides.files ?? [],
      dropEffect: 'copy',
    },
  } as unknown as DragEvent<HTMLDivElement>;
}

describe('useChatPaneFileDrop', () => {
  it('ignores drag-over and drop events that do not carry files', () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useChatPaneFileDrop({ enabled: true, onFiles }));

    const textDragOver = fileDragEvent({ type: 'dragover', types: ['text/plain'], items: [] });
    act(() => result.current.targetProps.onDragOver(textDragOver));
    expect(textDragOver.preventDefault).not.toHaveBeenCalled();

    const textDrop = fileDragEvent({ type: 'drop', types: ['text/plain'], items: [], files: [] });
    act(() => result.current.targetProps.onDrop(textDrop));
    expect(textDrop.preventDefault).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('still consumes a file drag-over and drop to block browser navigation while disabled', () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useChatPaneFileDrop({ enabled: false, onFiles }));

    const dragOver = fileDragEvent({ type: 'dragover', types: ['Files'], items: [] });
    act(() => result.current.targetProps.onDragOver(dragOver));
    expect(dragOver.preventDefault).toHaveBeenCalledOnce();
    expect(dragOver.dataTransfer.dropEffect).toBe('none');
    expect(result.current.draggingFiles).toBe(false);

    const drop = fileDragEvent({ type: 'drop', types: ['Files'], items: [], files: [new File(['x'], 'x.txt')] });
    act(() => result.current.targetProps.onDrop(drop));
    expect(drop.preventDefault).toHaveBeenCalledOnce();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('falls back to the native file list when a drop omits drag types and items', async () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useChatPaneFileDrop({ enabled: true, onFiles }));

    const file = new File(['dropped'], 'dropped.txt');
    const drop = fileDragEvent({ type: 'drop', types: undefined, items: undefined, files: [file] });
    await act(async () => result.current.targetProps.onDrop(drop));

    expect(drop.preventDefault).toHaveBeenCalledOnce();
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('detects a file drag via item kind even when drag types are unavailable', () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useChatPaneFileDrop({ enabled: true, onFiles }));

    const dragEnter = fileDragEvent({ type: 'dragenter', types: undefined, items: [{ kind: 'file' }] });
    act(() => result.current.targetProps.onDragEnter(dragEnter));
    expect(result.current.draggingFiles).toBe(true);
  });

  it('clears the active state once a file drag leaves the pane', () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useChatPaneFileDrop({ enabled: true, onFiles }));

    const dragEnter = fileDragEvent({ type: 'dragenter', types: ['Files'], items: [] });
    act(() => result.current.targetProps.onDragEnter(dragEnter));
    expect(result.current.draggingFiles).toBe(true);

    const dragLeave = fileDragEvent({ type: 'dragleave', types: ['Files'], items: [] });
    act(() => result.current.targetProps.onDragLeave(dragLeave));
    expect(result.current.draggingFiles).toBe(false);
  });

  it('does not clear an active file drag when an unrelated non-file drag-leave fires', () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useChatPaneFileDrop({ enabled: true, onFiles }));

    const dragEnter = fileDragEvent({ type: 'dragenter', types: ['Files'], items: [] });
    act(() => result.current.targetProps.onDragEnter(dragEnter));
    expect(result.current.draggingFiles).toBe(true);

    const nonFileDragLeave = fileDragEvent({ type: 'dragleave', types: ['text/plain'], items: [] });
    act(() => result.current.targetProps.onDragLeave(nonFileDragLeave));
    expect(result.current.draggingFiles).toBe(true);
  });

  it('reports a rejected onFiles host effect without leaving an unhandled rejection', async () => {
    const failure = new Error('onFiles host failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFiles = vi.fn().mockRejectedValue(failure);
    const { result } = renderHook(() => useChatPaneFileDrop({ enabled: true, onFiles }));

    try {
      const file = new File(['dropped'], 'dropped.txt');
      const drop = fileDragEvent({ type: 'drop', types: undefined, items: undefined, files: [file] });
      await act(async () => {
        result.current.targetProps.onDrop(drop);
        // Flush past filesFromDataTransfer's internal await, the onFiles() call, and the
        // rejection-observing .catch() microtask this fix adds.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onFiles).toHaveBeenCalledWith([file]);
      expect(consoleError).toHaveBeenCalledWith(
        '[@jini-ai/chat] useChatPaneFileDrop onFiles host effect failed:',
        failure,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
