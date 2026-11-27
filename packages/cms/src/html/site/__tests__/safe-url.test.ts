import { expect, it, vi } from 'vitest';
import { extractYoutubeVideoId, safeImageSrc } from '../safe-url.js';

it('admits relative images and applies private-path policy after URL normalization', () => {
  const isPrivatePath = vi.fn((path: string) => path === '/workspaces/w/media/id/original');
  for (const value of ['/images/cover.png', 'images/cover.png', '../cover.png']) {
    const result = safeImageSrc({ value, isPrivatePath });
    expect(result).toBe(value);
    expect(result).not.toContain('jini-safehref.invalid');
  }
  expect(safeImageSrc({ value: '/workspaces/w/media/id/./original', isPrivatePath })).toBeNull();
  expect(isPrivatePath).toHaveBeenLastCalledWith('/workspaces/w/media/id/original');
});

it('preserves the authored-video projection', () => {
  expect(extractYoutubeVideoId({ value: 'https://www.youtube.com/watch?v=abc_123-XYZ' })).toBe('abc_123-XYZ');
  expect(extractYoutubeVideoId({ value: 'https://youtu.be/abc_123-XYZ' })).toBe('abc_123-XYZ');
  expect(extractYoutubeVideoId({ value: 'abc_123-XYZ' })).toBeNull();
});
it('does not emit an image URL when the URL parser refuses its authority', () => {
  const isPrivatePath = vi.fn((_path: string) => false);
  expect(safeImageSrc({ value: 'https://[invalid]/photo.jpg', isPrivatePath })).toBeNull();
  expect(isPrivatePath).not.toHaveBeenCalled();
  expect(safeImageSrc({ value: ' https://photos.example/photo.jpg ', isPrivatePath })).toBe('https://photos.example/photo.jpg');
  expect(isPrivatePath.mock.calls).toEqual([['/photo.jpg']]);
});
