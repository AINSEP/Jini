// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGallerySelection } from '../hooks/GallerySelection.hooks.js';

it('selects unique images, preserves edits across reorder, rejects overflow and removes images', () => {
  let images: { mediaId: string; alt: string; caption: string }[] = [];
  const { result, rerender } = renderHook(() => useGallerySelection({ images, onChange: next => { images = next; } }, { maxImages: 2 }));
  act(() => result.current.add({ images: [{ mediaId: 'a', alt: 'A', caption: '' }, { mediaId: 'a', alt: 'duplicate', caption: '' }, { mediaId: 'b', alt: 'B', caption: '' }] }));
  rerender(); expect(images.map(image => image.mediaId)).toEqual(['a', 'b']);
  act(() => result.current.update({ mediaId: 'a', patch: { caption: 'Caption', alt: '' } }));
  rerender();
  act(() => result.current.move({ mediaId: 'a', beforeId: 'b' }));
  rerender(); expect(images[0]).toEqual({ mediaId: 'a', alt: '', caption: 'Caption' });
  act(() => result.current.move({ mediaId: 'b', beforeId: 'a' }));
  rerender(); expect(images.map(image => image.mediaId)).toEqual(['b', 'a']);
  expect(() => result.current.add({ images: [{ mediaId: 'c', alt: '', caption: '' }] })).toThrow('at most 2');
  expect(images).toHaveLength(2);
  act(() => result.current.remove({ mediaId: 'a' }));
  rerender(); expect(images.map(image => image.mediaId)).toEqual(['b']);
});
