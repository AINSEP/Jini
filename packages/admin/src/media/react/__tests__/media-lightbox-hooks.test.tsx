import { describe, expect, it, vi } from 'vitest';
import { useMediaLightbox } from '../hooks/MediaLightbox.hooks.js';
import type { MediaAsset } from '../../models.js';
import type { MediaApiPort } from '../../ports.js';

const item = (id: string) => ({ id, title: id.toUpperCase() }) as MediaAsset;
const items = [item('a'), item('b'), item('c')];
const api = {} as MediaApiPort;
const run = (activeIndex: number | null) => useMediaLightbox({ items, api, activeIndex, onNavigate: vi.fn(), onClose: vi.fn() });

describe('useMediaLightbox', () => {
  it('is closed without an active asset', () => {
    expect(run(null)).toMatchObject({ item: null, lightbox: { open: false, title: '', index: 0, count: 3 } });
  });

  it('treats an index past the list as closed', () => {
    expect(run(7)).toMatchObject({ item: null, lightbox: { open: false } });
  });

  it('resolves the open asset, its title and its position in the set', () => {
    expect(run(1)).toMatchObject({ item: items[1], lightbox: { open: true, title: 'B', index: 1, count: 3 } });
  });
});
