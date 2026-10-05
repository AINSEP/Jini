import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMediaCard } from '../hooks/MediaCard.hooks.js';
import type { MediaCardProps } from '../hooks/MediaCard.hooks.js';
import type { MediaAsset } from '../../models.js';
import type { MediaApiPort } from '../../ports.js';

const asset = (patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'Photo 1', title: 'Photo', alt: 'A photo', contentType: null, publicUrl: null, status: 'active', sha256: 'x',
  caption: '', credit: '', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', version: 1, byteSize: 2048, ...patch,
});
// Only originalUrl is read by the card; the rest of the port is never touched here.
const api = { originalUrl: ({ id, version }: { id: string; version?: number }) => `/media/${id}?v=${version}` } as unknown as MediaApiPort;
const mount = (props: Partial<MediaCardProps> = {}) =>
  renderHook((p: Partial<MediaCardProps>) => useMediaCard({ item: asset(), api, ...p }), { initialProps: props });

describe('useMediaCard', () => {
  it('derives metadata, handles and the image-first preview for an active asset', () => {
    const onPreview = vi.fn();
    const { result } = mount({ onPreview });
    expect(result.current).toMatchObject({
      busy: false, byteSize: '2 KB', uploadDate: 'Jan 2, 2026', metadataSeparator: ' · ', src: '/media/Photo 1?v=1',
      stage: 'image', image: true, video: false, canPreview: true, imagePreview: true, alt: 'A photo',
      statusClassName: 'jini-status jini-status-active', statusLabel: 'active', statusTone: 'success', trashed: false,
      handles: { expand: 'media-item-photo-1-expand', edit: 'media-item-photo-1-edit', menu: 'media-item-photo-1-menu' },
      menuLabel: 'Actions for "Photo"', menuItems: [],
    });
    result.current.preview();
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it('omits the byte size and separator when the host reports no size', () => {
    const { byteSize: _size, ...unsized } = asset();
    const { result } = mount({ item: unsized, locale: 'en-GB' });
    expect(result.current).toMatchObject({ byteSize: null, uploadDate: '2 Jan 2026', metadataSeparator: '' });
  });

  it('omits the separator when the upload date is unreadable', () => {
    const { result } = mount({ item: asset({ createdAt: 'not a date' }) });
    expect(result.current).toMatchObject({ byteSize: '2 KB', uploadDate: null, metadataSeparator: '' });
  });

  it('falls back from alt to title to a generic label', () => {
    expect(mount({ item: asset({ alt: '' }) }).result.current.alt).toBe('Photo');
    expect(mount({ item: asset({ alt: '', title: '' }) }).result.current.alt).toBe('Untitled asset');
  });

  it('falls back image to video to unsupported, and retries from image when the version changes', () => {
    const { result, rerender } = mount({ onPreview: vi.fn() });
    act(() => result.current.onImageError());
    expect(result.current).toMatchObject({ stage: 'video', image: false, video: true, imagePreview: false, canPreview: true });
    act(() => result.current.onVideoError());
    expect(result.current).toMatchObject({ stage: 'unsupported', canPreview: false });
    rerender({ onPreview: vi.fn(), item: asset({ version: 2 }) });
    expect(result.current).toMatchObject({ stage: 'image', src: '/media/Photo 1?v=2', canPreview: true });
  });

  it('has no preview without a safe URL or a preview handler', () => {
    const unsafe = { originalUrl: () => 'javascript:alert(1)' } as unknown as MediaApiPort;
    const { result } = mount({ api: unsafe, onPreview: vi.fn() });
    expect(result.current).toMatchObject({ src: undefined, canPreview: false, imagePreview: false });
    expect(mount().result.current.canPreview).toBe(false);
    expect(() => mount().result.current.preview()).not.toThrow();
  });

  it('offers edit and trash on active cards, restore and purge on trashed cards, all disabled while busy', () => {
    const handlers = { onEdit: vi.fn(), onTrash: vi.fn(), onRestore: vi.fn(), onPurge: vi.fn() };
    const active = mount({ ...handlers, handleBase: 'card' }).result.current;
    expect(active.menuItems.map(item => [item.id, item.disabled])).toEqual([['edit', false], ['trash', false]]);
    expect(active.handles.menu).toBe('card-menu');
    const trashed = mount({ ...handlers, busy: true, item: asset({ status: 'trashed' }) }).result.current;
    expect(trashed.menuItems.map(item => [item.id, item.disabled])).toEqual([['edit', true], ['restore', true], ['purge', true]]);
    expect(trashed).toMatchObject({ busy: true, trashed: true, statusTone: 'warning' });
  });
});
