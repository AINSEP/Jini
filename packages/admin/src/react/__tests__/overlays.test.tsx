import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createOverlayController, OverlayHost } from '../overlays.js';

describe('overlay controller', () => {
  it('publishes one entry whose render resolves the caller, and ignores a later cancel', async () => {
    const overlays = createOverlayController();
    let resolve!: (value: string | null) => void, cancel!: () => void;
    const opened = overlays.open<string>({ render: (handles) => { ({ resolve, cancel } = handles); return 'overlay body'; } });
    const [entry] = overlays.getSnapshot().entries;
    expect(entry!.render()).toBe('overlay body');
    resolve('chosen');
    cancel();
    expect(await opened).toBe('chosen');
    expect(overlays.getSnapshot().entries).toEqual([]);
  });

  it('rejects a second open while one is active, and cancel settles the first with null', async () => {
    const overlays = createOverlayController();
    const first = overlays.open({ render: () => null });
    await expect(overlays.open({ render: () => null })).rejects.toThrow('An overlay is already open');
    overlays.cancel();
    expect(await first).toBeNull();
    overlays.cancel();
  });

  it('settles null for an already-aborted signal without publishing, and on a later abort', async () => {
    const overlays = createOverlayController();
    const aborted = new AbortController(); aborted.abort();
    expect(await overlays.open({ render: () => null }, { signal: aborted.signal })).toBeNull();
    expect(overlays.getSnapshot().entries).toEqual([]);
    const later = new AbortController();
    const removed = vi.spyOn(later.signal, 'removeEventListener');
    const pending = overlays.open({ render: () => null }, { signal: later.signal });
    later.abort();
    expect(await pending).toBeNull();
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('settles the active overlay on dispose and refuses to open afterwards', async () => {
    const overlays = createOverlayController();
    const pending = overlays.open({ render: () => null });
    overlays.dispose();
    expect(await pending).toBeNull();
    expect(await overlays.open({ render: () => null })).toBeNull();
  });

  it('is rendered by the host re-exported from the same entry', async () => {
    const overlays = createOverlayController();
    render(<OverlayHost controller={overlays} />);
    let pending!: Promise<unknown>;
    act(() => { pending = overlays.open({ render: ({ cancel }) => <button type="button" onClick={cancel}>Close overlay</button> }); });
    act(() => screen.getByRole('button', { name: 'Close overlay' }).click());
    expect(await pending).toBeNull();
  });
});
