import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadChatAttachments } from './attachments.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('uploadChatAttachments', () => {
  it('uploads image and file attachments with encoded metadata and preserves input order', async () => {
    const uploaded = [
      {
        id: 'image-1',
        kind: 'image' as const,
        name: 'diagram & notes.png',
        mimeType: 'image/png',
        sizeBytes: 3,
        uri: 'file:///tmp/image-1.png',
      },
      {
        id: 'file-1',
        kind: 'file' as const,
        name: 'brief.txt',
        mimeType: 'text/plain',
        sizeBytes: 4,
        uri: 'file:///tmp/file-1.txt',
      },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ attachment: uploaded[0] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ attachment: uploaded[1] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    globalThis.fetch = fetchMock;
    const files = [
      new File(['img'], 'diagram & notes.png', { type: 'image/png' }),
      new File(['text'], 'brief.txt', { type: 'text/plain' }),
    ];

    await expect(uploadChatAttachments(files, {
      batchId: 'batch-order',
      signal: new AbortController().signal,
    })).resolves.toEqual(uploaded);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/playground/attachments?batch=batch-order&name=diagram+%26+notes.png',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: files[0],
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/playground/attachments?batch=batch-order&name=brief.txt',
      expect.objectContaining({
        headers: { 'content-type': 'text/plain' },
        body: files[1],
      }),
    );
  });

  it('uses the daemon message for a rejected upload', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Attachment exceeds the 20 MB limit' }),
      {
        status: 413,
        headers: { 'content-type': 'application/json' },
      },
    ));

    await expect(uploadChatAttachments([
      new File(['large'], 'large.bin'),
    ], {
      batchId: 'batch-rejected',
      signal: new AbortController().signal,
    })).rejects.toThrow('Attachment exceeds the 20 MB limit');
  });

  it('falls back to a filename-specific error for a malformed rejection body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }));

    await expect(uploadChatAttachments([
      new File(['bad'], 'broken.dat'),
    ], {
      batchId: 'batch-malformed',
      signal: new AbortController().signal,
    })).rejects.toThrow('Could not attach broken.dat');
  });

  it('rejects a successful response that omits the attachment record', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(uploadChatAttachments([
      new File(['missing'], 'missing.txt'),
    ], {
      batchId: 'batch-missing',
      signal: new AbortController().signal,
    })).rejects.toThrow('The daemon did not return an attachment for missing.txt');
  });

  it('rejects count and aggregate limits before starting network I/O', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(uploadChatAttachments(
      Array.from({ length: 11 }, (_, index) => new File(['x'], `${index}.txt`)),
      {
        batchId: 'batch-count',
        signal: new AbortController().signal,
      },
    )).rejects.toThrow('at most 10 files');
    const aggregateFiles = [
      new File(['x'], 'one.bin'),
      new File(['x'], 'two.bin'),
      new File(['x'], 'three.bin'),
    ];
    Object.defineProperty(aggregateFiles[0], 'size', { value: 20 * 1024 * 1024 });
    Object.defineProperty(aggregateFiles[1], 'size', { value: 20 * 1024 * 1024 });
    Object.defineProperty(aggregateFiles[2], 'size', { value: 11 * 1024 * 1024 });
    await expect(uploadChatAttachments(aggregateFiles, {
      batchId: 'batch-total',
      signal: new AbortController().signal,
    })).rejects.toThrow('total 50 MB or less');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cleans up successful files when another upload in the batch fails', async () => {
    const uploaded = {
      path: '/uploads/batch-partial/one.txt',
      name: 'one.txt',
      kind: 'file' as const,
      size: 3,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ attachment: uploaded }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Upload rejected' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock;

    await expect(uploadChatAttachments([
      new File(['one'], 'one.txt'),
      new File(['two'], 'two.txt'),
    ], {
      batchId: 'batch-partial',
      signal: new AbortController().signal,
    })).rejects.toThrow('Upload rejected');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/playground/attachments', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        batchId: 'batch-partial',
        paths: [uploaded.path],
      }),
    });
  });
});
