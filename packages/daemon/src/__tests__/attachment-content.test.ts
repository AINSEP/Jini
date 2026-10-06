import { describe, expect, it } from 'vitest';
import { prepareMessageAttachments } from '../attachment-content.js';

describe('message attachment content', () => {
  it('reads every ref in message order and preserves exact PNG bytes for native image inputs', async () => {
    const calls: string[] = [];
    const bytes = { green: Uint8Array.of(137, 80, 78, 71), yellow: Uint8Array.of(137, 80, 78, 72) };
    const prepared = await prepareMessageAttachments({ refs: ['green', 'yellow'], read: async ({ ref }) => {
      calls.push(ref);
      return { name: `${ref}-square.png`, mimeType: 'image/png', bytes: bytes[ref as keyof typeof bytes] };
    } }, {});
    expect(calls).toEqual(['green', 'yellow']);
    expect(prepared.images).toEqual([
      { mimeType: 'image/png', data: 'iVBORw==' },
      { mimeType: 'image/png', data: 'iVBOSA==' },
    ]);
    expect(prepared.notice).toBe('');
  });
  it('fails the entire preparation when a ref cannot be authorized or read', async () => {
    await expect(prepareMessageAttachments({ refs: ['missing'], read: async () => { throw new Error('Attachment is unavailable'); } }, {}))
      .rejects.toThrow('Attachment is unavailable');
  });
  it('states an unsupported image capability instead of claiming delivery', async () => {
    const prepared = await prepareMessageAttachments({ refs: ['image'], read: async () => ({
      name: 'square.png', mimeType: 'image/png', bytes: Uint8Array.of(137), path: '/uploads/square.png',
    }) }, { fileAccess: true, imageAccess: false });
    expect(prepared).toEqual({ images: [], imagePaths: [],
      notice: '\n\nAttachments to this message:\nsquare.png: image attachments are unsupported by this runtime.' });
  });
  it('states video unsupported explicitly and retains the local file path when available', async () => {
    const read = async () => ({ name: 'clip.mp4', mimeType: 'video/mp4', bytes: Uint8Array.of(0), path: '/uploads/clip.mp4' });
    expect((await prepareMessageAttachments({ refs: ['clip'], read }, { fileAccess: true })).notice)
      .toBe('\n\nAttachments to this message:\nclip.mp4: video attachments are unsupported by this runtime; the file is available at /uploads/clip.mp4.');
    expect((await prepareMessageAttachments({ refs: ['clip'], read }, {})).notice)
      .toBe('\n\nAttachments to this message:\nclip.mp4: video attachments are unsupported by this runtime.');
  });
});
