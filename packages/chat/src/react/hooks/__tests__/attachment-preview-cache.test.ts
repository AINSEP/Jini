import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetAttachmentPreviewCacheForTests,
  cacheAttachmentPreviewSource,
  getAttachmentPreviewSource,
  MAX_CACHED_ATTACHMENT_PREVIEWS,
} from '../attachment-preview-cache.js';

function makeFile(name: string, content = 'x'): File {
  return new File([content], name);
}

describe('attachment-preview-cache', () => {
  beforeEach(() => __resetAttachmentPreviewCacheForTests());

  it('returns undefined for a path that was never cached', () => {
    expect(getAttachmentPreviewSource('attachment:never-cached')).toBeUndefined();
  });

  it('round-trips a cached file by path', () => {
    const file = makeFile('a.png');
    cacheAttachmentPreviewSource('attachment:1', file);
    expect(getAttachmentPreviewSource('attachment:1')).toBe(file);
  });

  it('evicts the oldest tracked attachment once the cap is exceeded', () => {
    for (let i = 0; i < MAX_CACHED_ATTACHMENT_PREVIEWS; i += 1) {
      cacheAttachmentPreviewSource(`attachment:${i}`, makeFile(`file-${i}.txt`));
    }
    expect(getAttachmentPreviewSource('attachment:0')).toBeDefined();

    cacheAttachmentPreviewSource('attachment:overflow', makeFile('overflow.txt'));

    expect(getAttachmentPreviewSource('attachment:0')).toBeUndefined();
    expect(getAttachmentPreviewSource('attachment:overflow')).toBeDefined();
  });

  it('does not evict anything when overwriting an already-tracked path at the cap', () => {
    for (let i = 0; i < MAX_CACHED_ATTACHMENT_PREVIEWS; i += 1) {
      cacheAttachmentPreviewSource(`attachment:${i}`, makeFile(`file-${i}.txt`));
    }
    const replacement = makeFile('file-0-edited.txt');
    cacheAttachmentPreviewSource('attachment:0', replacement);

    expect(getAttachmentPreviewSource('attachment:0')).toBe(replacement);
    expect(getAttachmentPreviewSource('attachment:1')).toBeDefined();
  });
});
