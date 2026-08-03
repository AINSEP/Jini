import { describe, expect, it } from 'vitest';
import {
  applyImagePromptDelivery,
  augmentPromptWithImageAttachments,
  deriveImageAllowedDirs,
} from '../image-prompt-delivery.js';

describe('augmentPromptWithImageAttachments', () => {
  it('names a single image as an attachment the user provided, not a bare path dump', () => {
    const result = augmentPromptWithImageAttachments('describe this', ['/tmp/screenshot.png']);
    expect(result).toBe(
      'describe this\n\n---\n' +
        'The user attached the following image file to this message. ' +
        'It is a real file on disk — read it directly (e.g. with your file-reading tool) before responding:\n' +
        '1. /tmp/screenshot.png',
    );
  });

  it('pluralizes and numbers multiple images', () => {
    const result = augmentPromptWithImageAttachments('compare these', ['/tmp/a.png', '/tmp/b.png']);
    expect(result).toBe(
      'compare these\n\n---\n' +
        'The user attached the following image files to this message. ' +
        'These are real files on disk — read each one directly (e.g. with your file-reading tool) before responding:\n' +
        '1. /tmp/a.png\n2. /tmp/b.png',
    );
  });

  it('preserves a path containing spaces and quotes verbatim — no escaping, this is prompt text, not a shell command', () => {
    const path = '/Users/x/My Pictures/a "great" shot.png';
    const result = augmentPromptWithImageAttachments('look', [path]);
    expect(result).toContain(`1. ${path}`);
  });
});

describe('deriveImageAllowedDirs', () => {
  it('returns each path\'s containing directory', () => {
    expect(deriveImageAllowedDirs(['/uploads/a.png', '/uploads/sub/b.png'])).toEqual(['/uploads', '/uploads/sub']);
  });

  it('deduplicates directories shared by multiple images, preserving first-seen order', () => {
    expect(deriveImageAllowedDirs(['/uploads/a.png', '/uploads/b.png', '/other/c.png'])).toEqual(['/uploads', '/other']);
  });

  it('handles a directory path containing spaces and quotes', () => {
    const dir = '/Users/x/My Pictures/a "sub" dir';
    expect(deriveImageAllowedDirs([`${dir}/shot.png`])).toEqual([dir]);
  });
});

describe('applyImagePromptDelivery', () => {
  it('is a strict, byte-identical no-op when imageDelivery is not \'prompt-path\', even with images present', () => {
    const prompt = 'do the thing';
    const extraAllowedDirs = ['/uploads'];
    const imagePaths = ['/uploads/reference.png'];
    for (const delivery of ['native', 'unsupported', undefined] as const) {
      const result = applyImagePromptDelivery(delivery, prompt, imagePaths, extraAllowedDirs);
      expect(result.prompt).toBe(prompt);
      expect(result.extraAllowedDirs).toBe(extraAllowedDirs); // same reference, not just equal value
    }
  });

  it('is a strict, byte-identical no-op for \'prompt-path\' when there are zero images', () => {
    const prompt = 'do the thing';
    const extraAllowedDirs = ['/uploads'];
    const result = applyImagePromptDelivery('prompt-path', prompt, [], extraAllowedDirs);
    expect(result.prompt).toBe(prompt);
    expect(result.extraAllowedDirs).toBe(extraAllowedDirs);
  });

  it('is a strict, byte-identical no-op for \'prompt-path\' when imagePaths is undefined', () => {
    const prompt = 'do the thing';
    const result = applyImagePromptDelivery('prompt-path', prompt, undefined, undefined);
    expect(result.prompt).toBe(prompt);
    expect(result.extraAllowedDirs).toBeUndefined();
  });

  it('augments the prompt and widens extraAllowedDirs for \'prompt-path\' with images and no prior extraAllowedDirs', () => {
    const result = applyImagePromptDelivery('prompt-path', 'describe this', ['/uploads/reference.png'], undefined);
    expect(result.prompt).toContain('1. /uploads/reference.png');
    expect(result.extraAllowedDirs).toEqual(['/uploads']);
  });

  it('merges the derived image directory into pre-existing extraAllowedDirs without dropping or duplicating entries', () => {
    const result = applyImagePromptDelivery(
      'prompt-path',
      'describe this',
      ['/uploads/reference.png'],
      ['/project', '/uploads'],
    );
    expect(result.extraAllowedDirs).toEqual(['/project', '/uploads']);
  });

  it('filters out non-string and empty-string image paths before deciding whether to augment at all', () => {
    const prompt = 'do the thing';
    const result = applyImagePromptDelivery(
      'prompt-path',
      prompt,
      ['', ...([null, undefined, 42] as unknown as string[])],
      undefined,
    );
    expect(result.prompt).toBe(prompt);
    expect(result.extraAllowedDirs).toBeUndefined();
  });
});
