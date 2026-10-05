import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaLightbox } from '../hooks/MediaLightbox.hooks.js';
import type { MediaLightboxProps } from '../hooks/MediaLightbox.hooks.js';
import type { MediaAsset } from '../../models.js';
import type { MediaApiPort } from '../../ports.js';

afterEach(cleanup);
const item = (id: string) => ({ id, title: id.toUpperCase() }) as MediaAsset;
const items = [item('a'), item('b'), item('c')];
const api = {} as MediaApiPort;

// Attaches the hook's refs to real elements, the way the lightbox component does.
function mount(activeIndex: number | null) {
  let vm!: ReturnType<typeof useMediaLightbox>;
  const onNavigate = vi.fn(), onClose = vi.fn();
  function Harness(props: MediaLightboxProps) {
    vm = useMediaLightbox(props);
    return (
      <dialog ref={vm.dialogRef} open>
        <button data-jini-part="media.lightbox.previous">prev</button>
        <button data-jini-part="media.lightbox.next">next</button>
        <button ref={vm.closeRef}>close</button>
      </dialog>
    );
  }
  const view = render(<Harness items={items} api={api} activeIndex={activeIndex} onNavigate={onNavigate} onClose={onClose} />);
  const rerender = (index: number | null) => view.rerender(<Harness items={items} api={api} activeIndex={index} onNavigate={onNavigate} onClose={onClose} />);
  const button = (name: string) => view.getByRole('button', { name });
  return { vm: () => vm, onNavigate, rerender, button };
}

describe('useMediaLightbox', () => {
  it('is closed and inert without an active asset', () => {
    const { vm, onNavigate } = mount(null);
    expect(vm()).toMatchObject({ item: null, open: false, title: 'Media preview', position: '', hasPrev: false, hasNext: false });
    vm().previous(); vm().next();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('treats an index past the list as closed', () => {
    expect(mount(7).vm()).toMatchObject({ item: null, open: false });
  });

  it('focuses close on open and describes the position', () => {
    const { vm, button } = mount(1);
    expect(vm()).toMatchObject({ open: true, title: 'Media preview: B', position: '2 / 3', hasPrev: true, hasNext: true });
    expect(document.activeElement).toBe(button('close'));
  });

  it('moves with the arrow keys and ignores other keys', () => {
    const { onNavigate } = mount(1);
    const other = fireEvent.keyDown(document, { key: 'Enter' });
    expect(other).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(document, { key: 'ArrowRight' })).toBe(false);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onNavigate.mock.calls).toEqual([[2], [0]]);
  });

  it('clamps at both ends instead of wrapping', () => {
    const first = mount(0);
    expect(first.vm()).toMatchObject({ hasPrev: false, hasNext: true });
    first.vm().previous();
    expect(first.onNavigate).not.toHaveBeenCalled();
    cleanup();
    const last = mount(2);
    expect(last.vm()).toMatchObject({ hasPrev: true, hasNext: false });
    last.vm().next();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(last.onNavigate).not.toHaveBeenCalled();
  });

  it('keeps focus in the dialog when the focused arrow disappears at a boundary', () => {
    const toFirst = mount(1);
    toFirst.button('prev').focus();
    act(() => toFirst.vm().previous());
    expect(toFirst.onNavigate).toHaveBeenCalledWith(0);
    expect(document.activeElement).toBe(toFirst.button('close'));
    cleanup();
    const toLast = mount(1);
    toLast.button('next').focus();
    act(() => toLast.vm().next());
    expect(toLast.onNavigate).toHaveBeenCalledWith(2);
    expect(document.activeElement).toBe(toLast.button('close'));
  });

  it('leaves focus where the operator put it for interior moves', () => {
    const { vm, button, onNavigate, rerender } = mount(1);
    button('next').focus();
    act(() => vm().previous());
    expect(onNavigate).toHaveBeenCalledWith(0);
    expect(document.activeElement).toBe(button('next'));
    rerender(0);
    button('prev').focus();
    act(() => vm().next());
    expect(document.activeElement).toBe(button('prev'));
  });
});
