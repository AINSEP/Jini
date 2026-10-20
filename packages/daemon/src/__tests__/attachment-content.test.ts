import { describe, expect, it, vi } from 'vitest';
import { prepareMessageAttachments, type MessageAttachmentReader, type MessageAttachmentSource } from '../attachment-content.js';

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

describe('message attachment content — pinned branches', () => {
  function readerFor(sources: Record<string, MessageAttachmentSource>): MessageAttachmentReader {
    return async ({ ref }) => sources[ref]!;
  }

  it('accepts every native image MIME type and records an image path only when the source has one', async () => {
    const prepared = await prepareMessageAttachments({ refs: ['a', 'b', 'c', 'd'], read: readerFor({
      a: { name: 'a.jpg', mimeType: 'image/jpeg', bytes: Uint8Array.of(1), path: '/u/a.jpg' },
      b: { name: 'b.gif', mimeType: 'image/gif', bytes: Uint8Array.of(2) },
      c: { name: 'c.webp', mimeType: 'image/webp', bytes: Uint8Array.of(3), path: '/u/c.webp' },
      d: { name: 'd.png', mimeType: 'image/png', bytes: Uint8Array.of(4), path: '' },
    }) });
    expect(prepared).toEqual({
      images: [
        { mimeType: 'image/jpeg', data: 'AQ==' },
        { mimeType: 'image/gif', data: 'Ag==' },
        { mimeType: 'image/webp', data: 'Aw==' },
        { mimeType: 'image/png', data: 'BA==' },
      ],
      imagePaths: ['/u/a.jpg', '/u/c.webp'],
      notice: '',
    });
  });

  it('treats an image MIME type outside the native list (svg) as a plain file', async () => {
    const prepared = await prepareMessageAttachments({ refs: ['s'], read: readerFor({
      s: { name: 's.svg', mimeType: 'image/svg+xml', bytes: Uint8Array.of(0), path: '/u/s.svg' },
    }) }, { fileAccess: true });
    expect(prepared).toEqual({ images: [], imagePaths: [], notice: '\n\nAttachments to this message:\ns.svg: read the attached file at /u/s.svg.' });
  });

  it('states a non-video file unsupported without file access, even when it has a path', async () => {
    const prepared = await prepareMessageAttachments({ refs: ['f'], read: readerFor({
      f: { name: 'notes.txt', mimeType: 'text/plain', bytes: Uint8Array.of(0), path: '/u/notes.txt' },
    }) });
    expect(prepared.notice).toBe('\n\nAttachments to this message:\nnotes.txt: file attachments are unsupported by this runtime.');
  });

  it('states a file unsupported when file access is granted but the source has no path', async () => {
    const prepared = await prepareMessageAttachments({ refs: ['f'], read: readerFor({
      f: { name: 'notes.txt', mimeType: 'text/plain', bytes: Uint8Array.of(0) },
    }) }, { fileAccess: true });
    expect(prepared.notice).toBe('\n\nAttachments to this message:\nnotes.txt: file attachments are unsupported by this runtime.');
  });

  it('joins several notices in ref order beneath one heading, alongside delivered images', async () => {
    const prepared = await prepareMessageAttachments({ refs: ['img', 'doc', 'vid'], read: readerFor({
      img: { name: 'p.png', mimeType: 'image/png', bytes: Uint8Array.of(9) },
      doc: { name: 'r.pdf', mimeType: 'application/pdf', bytes: Uint8Array.of(0), path: '/u/r.pdf' },
      vid: { name: 'v.webm', mimeType: 'video/webm', bytes: Uint8Array.of(0) },
    }) }, { fileAccess: true });
    expect(prepared).toEqual({
      images: [{ mimeType: 'image/png', data: 'CQ==' }],
      imagePaths: [],
      notice: '\n\nAttachments to this message:\nr.pdf: read the attached file at /u/r.pdf.\nv.webm: video attachments are unsupported by this runtime.',
    });
  });

  it('returns empty results for no refs without calling the reader', async () => {
    const read = vi.fn<MessageAttachmentReader>();
    expect(await prepareMessageAttachments({ refs: [], read })).toEqual({ images: [], imagePaths: [], notice: '' });
    expect(read).not.toHaveBeenCalled();
  });
});
