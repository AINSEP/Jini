import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useChatPaneFileDrop } from '../../hooks/useChatPaneFileDrop.hooks.js';

function fileDrop(files: File[]): DragEvent<HTMLDivElement> {
  return {
    type: 'drop',
    preventDefault: vi.fn(),
    currentTarget: { contains: () => false },
    relatedTarget: null,
    dataTransfer: { types: undefined, items: undefined, files, dropEffect: 'copy' },
  } as unknown as DragEvent<HTMLDivElement>;
}

describe('useChatPaneFileDrop — a host effect that throws synchronously', () => {
  it('reports the throw instead of letting it escape the drop handler', async () => {
    const failure = new Error('onFiles threw before returning a promise');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFiles = vi.fn((): void => { throw failure; });
    const { result } = renderHook(() => useChatPaneFileDrop({ enabled: true, onFiles }));

    try {
      const file = new File(['dropped'], 'dropped.txt');
      await act(async () => {
        result.current.targetProps.onDrop(fileDrop([file]));
        // Flush past filesFromDataTransfer's internal await before onFiles() runs.
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onFiles).toHaveBeenCalledWith([file]);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith('[@jini-ai/chat] useChatPaneFileDrop onFiles host effect failed:', failure);
      expect(result.current.dropReadError).toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });
});
