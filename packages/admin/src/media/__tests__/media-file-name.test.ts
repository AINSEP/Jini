import { describe, expect, it } from 'vitest';
import { mediaFileName } from '../rules.js';

describe('mediaFileName', () => {
  it('adds the extension of the sniffed type to the extension-less title', () => {
    expect(mediaFileName({ title: 'woodnest-cabin-booking', contentType: 'video/mp4' })).toBe('woodnest-cabin-booking.mp4');
    expect(mediaFileName({ title: 'hero', contentType: 'image/jpeg' })).toBe('hero.jpg');
    expect(mediaFileName({ title: 'logo', contentType: 'image/svg+xml' })).toBe('logo.svg');
    expect(mediaFileName({ title: 'intro', contentType: 'audio/mpeg' })).toBe('intro.mp3');
  });

  it('does not double an extension the title already carries, in any case', () => {
    expect(mediaFileName({ title: 'clip.MP4', contentType: 'video/mp4' })).toBe('clip.MP4');
  });

  it('shows the title as-is for an unknown or unread type', () => {
    expect(mediaFileName({ title: 'blob', contentType: 'application/octet-stream' })).toBe('blob');
    expect(mediaFileName({ title: 'blob', contentType: null })).toBe('blob');
  });
});
