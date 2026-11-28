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

it('refuses non-string, scheme, protocol-relative and off-origin relative image sources, and credentialed URLs', () => {
  const isPrivatePath = vi.fn(() => false);
  for (const value of [undefined, 42, null, '', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.example/x.png', 'img\\x.png']) {
    expect(safeImageSrc({ value, isPrivatePath })).toBeNull();
  }
  expect(isPrivatePath).not.toHaveBeenCalled();
  // The URL parser strips a leading control character, so this resolves to another origin.
  expect(safeImageSrc({ value: '\u0001//evil.example/x.png', isPrivatePath })).toBeNull();
  expect(isPrivatePath).not.toHaveBeenCalled();
  expect(safeImageSrc({ value: 'https://user:pw@photos.example/x.jpg', isPrivatePath })).toBeNull();
  expect(safeImageSrc({ value: 'images/x.png', isPrivatePath })).toBe('images/x.png');
});

it('a non-string video source has no YouTube id', () => {
  expect(extractYoutubeVideoId({ value: undefined })).toBeNull();
  expect(extractYoutubeVideoId({ value: 7 })).toBeNull();
});
