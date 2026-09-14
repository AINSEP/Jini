import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { describe, expect, it } from 'vitest';
import type { FolderPathDropPort } from '../../../ports.js';
import {
  useFolderPathDropCapture,
  type UseFolderPathDropCaptureOptions,
} from '../../../react/hooks/useFolderPathDropCapture.js';

/** A one-item drop (a folder, or a loose file) whose `preventDefault`/`stopPropagation` land in `calls`. */
function recordingDrop(isDirectory: boolean, calls: string[]): DragEvent<Element> {
  return {
    dataTransfer: {
      items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory }) }],
      files: [{ id: 'dropped' }],
    },
    preventDefault: () => {
      calls.push('preventDefault');
    },
    stopPropagation: () => {
      calls.push('stopPropagation');
    },
  } as unknown as DragEvent<Element>;
}

function constantPort(path: string): FolderPathDropPort {
  return { getPathForFile: () => path };
}

function recordingComposer(calls: string[]) {
  return {
    current: {
      insertText: (text: string) => {
        calls.push(`insertText:${text}`);
      },
    },
  };
}

function renderCapture(initialProps: UseFolderPathDropCaptureOptions) {
  return renderHook((options: UseFolderPathDropCaptureOptions) => useFolderPathDropCapture(options), {
    initialProps,
  });
}

describe('useFolderPathDropCapture', () => {
  it('keeps the handler identity across re-renders, even when port and onFolderPaths change identity', () => {
    const composer = recordingComposer([]);
    const { result, rerender } = renderCapture({ port: constantPort('/a'), composer, onFolderPaths: () => {} });
    const first = result.current;

    rerender({ port: constantPort('/b'), composer, onFolderPaths: () => {} });

    expect(result.current).toBe(first);
  });

  it('swallows a folder drop, inserts its path, then hands the recovered paths to onFolderPaths', () => {
    const calls: string[] = [];
    const { result } = renderCapture({
      port: constantPort('/Users/x/Site'),
      composer: recordingComposer(calls),
      onFolderPaths: (paths) => {
        calls.push(`onFolderPaths:${paths.join('|')}`);
      },
    });

    act(() => result.current(recordingDrop(true, calls)));

    expect(calls).toEqual(['preventDefault', 'stopPropagation', 'insertText:/Users/x/Site', 'onFolderPaths:/Users/x/Site']);
  });

  it('leaves a non-folder drop alone and never calls onFolderPaths', () => {
    const calls: string[] = [];
    const { result } = renderCapture({
      port: constantPort('/Users/x/loose.txt'),
      composer: recordingComposer(calls),
      onFolderPaths: () => {
        calls.push('onFolderPaths');
      },
    });

    act(() => result.current(recordingDrop(false, calls)));

    expect(calls).toEqual([]);
  });

  it('leaves every drop alone while there is no port', () => {
    const calls: string[] = [];
    const { result } = renderCapture({
      port: null,
      composer: recordingComposer(calls),
      onFolderPaths: () => {
        calls.push('onFolderPaths');
      },
    });

    act(() => result.current(recordingDrop(true, calls)));

    expect(calls).toEqual([]);
  });

  it('uses the latest port and onFolderPaths after a re-render, not the first render’s', () => {
    const calls: string[] = [];
    const composer = recordingComposer(calls);
    const { result, rerender } = renderCapture({
      port: null,
      composer,
      onFolderPaths: () => {
        calls.push('stale-callback');
      },
    });

    rerender({
      port: constantPort('/Users/x/Later'),
      composer,
      onFolderPaths: (paths) => {
        calls.push(`latest-callback:${paths.join('|')}`);
      },
    });
    act(() => result.current(recordingDrop(true, calls)));

    expect(calls).toEqual(['preventDefault', 'stopPropagation', 'insertText:/Users/x/Later', 'latest-callback:/Users/x/Later']);
  });

  it('handles a folder drop with no onFolderPaths at all', () => {
    const calls: string[] = [];
    const { result } = renderCapture({ port: constantPort('/Users/x/Site'), composer: recordingComposer(calls) });

    act(() => result.current(recordingDrop(true, calls)));

    expect(calls).toEqual(['preventDefault', 'stopPropagation', 'insertText:/Users/x/Site']);
  });
});
