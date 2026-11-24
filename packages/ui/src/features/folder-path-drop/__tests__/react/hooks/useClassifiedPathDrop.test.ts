import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { describe, expect, it } from 'vitest';
import { useClassifiedPathDrop } from '../../../react/hooks/useClassifiedPathDrop.js';
import type { ClassifiedPathDrop } from '../../../types.js';

/** A neutral host classifier: one name per drop, `dir:` is a folder, `.zip` an archive, anything else refused. */
function classify(names: readonly string[]): ClassifiedPathDrop {
  if (names.length !== 1) return { kind: 'refused', message: 'one at a time' };
  const [name] = names as [string];
  if (name.startsWith('dir:')) return { kind: 'folder', path: `/x/${name.slice(4)}` };
  if (name.endsWith('.zip')) return { kind: 'archive', path: `/x/${name}` };
  return { kind: 'refused', message: 'wrong type' };
}

const namesOf = (files: readonly File[]) => files.map((file) => file.name);

function dragEvent(names: string[], calls: string[] = []): DragEvent<HTMLElement> {
  return {
    preventDefault: () => calls.push('preventDefault'),
    stopPropagation: () => calls.push('stopPropagation'),
    currentTarget: { contains: () => false },
    relatedTarget: null,
    dataTransfer: { files: names.map((name) => ({ name })), dropEffect: '' },
  } as unknown as DragEvent<HTMLElement>;
}

function setup(busy = false) {
  const seen: string[] = [];
  const hook = renderHook(() => useClassifiedPathDrop({
    busy,
    classifyDrop: ({ dataTransfer }) => classify(namesOf(Array.from(dataTransfer.files))),
    classifyFiles: ({ files }) => classify(namesOf(files)),
    onFolder: ({ path }) => seen.push(`folder:${path}`),
    onArchive: ({ path }) => seen.push(`archive:${path}`),
    onRefused: (message) => seen.push(`refused:${message}`),
  }));
  return { hook, seen };
}

describe('useClassifiedPathDrop', () => {
  it('routes a folder and an archive to their own handlers with the classified path', () => {
    const { hook, seen } = setup();
    act(() => hook.result.current.dropProps.onDropCapture(dragEvent(['dir:site'])));
    act(() => hook.result.current.dropProps.onDropCapture(dragEvent(['a.zip'])));
    expect(seen).toEqual(['folder:/x/site', 'archive:/x/a.zip']);
  });

  it('a refused drop reports the host message and still clears the drag highlight', () => {
    const { hook, seen } = setup();
    act(() => hook.result.current.dropProps.onDragOver(dragEvent([])));
    expect(hook.result.current.dragging).toBe(true);
    act(() => hook.result.current.dropProps.onDropCapture(dragEvent(['a.png'])));
    expect(hook.result.current.dragging).toBe(false);
    expect(seen).toEqual(['refused:wrong type']);
  });

  it('a busy target neither lights up nor routes a drop or a pick', () => {
    const { hook, seen } = setup(true);
    const event = dragEvent([]);
    act(() => hook.result.current.dropProps.onDragOver(event));
    expect(hook.result.current.dragging).toBe(false);
    expect(event.dataTransfer.dropEffect).toBe('none');
    act(() => hook.result.current.dropProps.onDropCapture(dragEvent(['a.zip'])));
    act(() => hook.result.current.onPicked({ files: [{ name: 'a.zip' } as File] }));
    expect(seen).toEqual([]);
  });

  it('leaving the target clears the highlight; the picker routes through the files classifier', () => {
    const { hook, seen } = setup();
    act(() => hook.result.current.dropProps.onDragOver(dragEvent([])));
    act(() => hook.result.current.dropProps.onDragLeave(dragEvent([])));
    expect(hook.result.current.dragging).toBe(false);
    act(() => hook.result.current.onPicked({ files: [{ name: 'a.zip' } as File, { name: 'b.zip' } as File] }));
    expect(seen).toEqual(['refused:one at a time']);
  });

  it('takes the drop in the capture phase and stops it there', () => {
    const { hook } = setup();
    const calls: string[] = [];
    act(() => hook.result.current.dropProps.onDropCapture(dragEvent(['dir:site'], calls)));
    expect(calls).toEqual(['preventDefault', 'stopPropagation']);
    expect('onDrop' in hook.result.current.dropProps).toBe(false);
  });
});
