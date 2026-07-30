/**
 * Ported from `examples/reference-web/src/attachments.test.ts` (6 cases) when that host-local
 * `uploadChatAttachments` was generalized into `createDaemonAttachmentUploader`, plus new cases for
 * the behavior the factory added: a configurable base URL and quotas, per-uploader (rather than
 * module-global) batch accounting, abort/timeout propagation, and the fixed `content-type` that
 * keeps a dropped `.json` file from being eaten by a body parser on the daemon.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDaemonAttachmentUploader } from '../create-daemon-attachment-uploader.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const uploadedImage = {
  path: 'attachment:11111111-1111-4111-8111-111111111111',
  name: 'diagram & notes.png',
  kind: 'image' as const,
  size: 3,
};
const uploadedFile = {
  path: 'attachment:22222222-2222-4222-8222-222222222222',
  name: 'brief.txt',
  kind: 'file' as const,
  size: 4,
};

function signalOptions(batchId: string, controller = new AbortController()) {
  return { batchId, signal: controller.signal };
}

describe('createDaemonAttachmentUploader', () => {
  it('uploads every file to the daemon and returns records in input order', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ attachment: uploadedImage }, 201))
      .mockResolvedValueOnce(jsonResponse({ attachment: uploadedFile }, 201));
    globalThis.fetch = fetchMock;
    const upload = createDaemonAttachmentUploader('http://127.0.0.1:4317');
    const files = [
      new File(['img'], 'diagram & notes.png', { type: 'image/png' }),
      new File(['text'], 'brief.txt', { type: 'text/plain' }),
    ];

    await expect(upload(files, signalOptions('batch-order')))
      .resolves.toEqual([uploadedImage, uploadedFile]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:4317/api/attachments?batch=batch-order&name=diagram+%26+notes.png',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: files[0],
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:4317/api/attachments?batch=batch-order&name=brief.txt',
      expect.objectContaining({ body: files[1] }),
    );
  });

  it('sends application/octet-stream even for a file the browser typed as JSON', async () => {
    // The bug this prevents: `content-type: application/json` is claimed by an app-wide
    // `express.json()` on the daemon, which drains the request stream before the upload route reads
    // it. The daemon sniffs the kind from the bytes, so this header is pure liability.
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ attachment: uploadedFile }, 201));
    globalThis.fetch = fetchMock;
    const upload = createDaemonAttachmentUploader('');

    await upload([new File(['{}'], 'data.json', { type: 'application/json' })], signalOptions('batch-json'));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/attachments?batch=batch-json&name=data.json',
      expect.objectContaining({ headers: { 'content-type': 'application/octet-stream' } }),
    );
  });

  it('targets a same-origin path when the base URL is empty, and tolerates a trailing slash', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ attachment: uploadedFile }, 201));
    globalThis.fetch = fetchMock;

    await createDaemonAttachmentUploader('')([new File(['a'], 'a.txt')], signalOptions('batch-rel'));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/attachments?batch=batch-rel&name=a.txt');

    await createDaemonAttachmentUploader('http://127.0.0.1:4317/')(
      [new File(['a'], 'a.txt')],
      signalOptions('batch-slash'),
    );
    expect(fetchMock.mock.calls[1]?.[0])
      .toBe('http://127.0.0.1:4317/api/attachments?batch=batch-slash&name=a.txt');
  });

  it('returns immediately for an empty selection without any network call', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await expect(createDaemonAttachmentUploader('')([], signalOptions('batch-empty'))).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('generates its own batch id when the composer does not supply one', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ attachment: uploadedFile }, 201));
    globalThis.fetch = fetchMock;

    await createDaemonAttachmentUploader('')([new File(['a'], 'a.txt')]);

    expect(fetchMock.mock.calls[0]?.[0]).toMatch(
      /^\/api\/attachments\?batch=[0-9a-f-]{36}&name=a\.txt$/u,
    );
  });

  it('surfaces the daemon message from either error envelope', async () => {
    // This package's own `{ error: { message } }` shape...
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: 'Each attachment must be 20 MB or smaller' } }, 413),
    );
    await expect(createDaemonAttachmentUploader('')(
      [new File(['large'], 'large.bin')],
      signalOptions('batch-envelope'),
    )).rejects.toThrow('Each attachment must be 20 MB or smaller');

    // ...and a bare `{ message }`, which a host with its own upload route may still answer with.
    globalThis.fetch = vi.fn().mockImplementation(() => jsonResponse({ message: 'Upload refused' }, 413));
    await expect(createDaemonAttachmentUploader('')(
      [new File(['large'], 'large.bin')],
      signalOptions('batch-bare'),
    )).rejects.toThrow('Upload refused');
  });

  it('falls back to a filename-specific error for a malformed rejection body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    await expect(createDaemonAttachmentUploader('')(
      [new File(['bad'], 'broken.dat')],
      signalOptions('batch-malformed'),
    )).rejects.toThrow('Could not attach broken.dat');
  });

  it('falls back when the rejection body is valid JSON carrying no message at all', async () => {
    // Well-formed JSON with neither envelope's message field — the user still has to be told which
    // file failed rather than shown "undefined".
    globalThis.fetch = vi.fn().mockImplementation(() => jsonResponse({ error: {} }, 500));
    await expect(createDaemonAttachmentUploader('')(
      [new File(['x'], 'silent.bin')],
      signalOptions('batch-no-message'),
    )).rejects.toThrow('Could not attach silent.bin');

    globalThis.fetch = vi.fn().mockImplementation(() => jsonResponse({ unrelated: true }, 500));
    await expect(createDaemonAttachmentUploader('')(
      [new File(['x'], 'quiet.bin')],
      signalOptions('batch-no-envelope'),
    )).rejects.toThrow('Could not attach quiet.bin');
  });

  it('rejects a successful response that omits the attachment record', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => jsonResponse({}, 201));

    await expect(createDaemonAttachmentUploader('')(
      [new File(['missing'], 'missing.txt')],
      signalOptions('batch-missing'),
    )).rejects.toThrow('The daemon did not return an attachment for missing.txt');
  });

  it('rejects per-file, count, and aggregate quota breaches before starting network I/O', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const upload = createDaemonAttachmentUploader('');

    const oversized = new File(['x'], 'huge.bin');
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });
    await expect(upload([oversized], signalOptions('batch-per-file')))
      .rejects.toThrow('Each attachment must be 20 MB or smaller.');

    await expect(upload(
      Array.from({ length: 11 }, (_, index) => new File(['x'], `${index}.txt`)),
      signalOptions('batch-count'),
    )).rejects.toThrow('You can attach at most 10 files to one message.');

    const aggregate = [
      new File(['x'], 'one.bin'),
      new File(['x'], 'two.bin'),
      new File(['x'], 'three.bin'),
    ];
    Object.defineProperty(aggregate[0], 'size', { value: 20 * 1024 * 1024 });
    Object.defineProperty(aggregate[1], 'size', { value: 20 * 1024 * 1024 });
    Object.defineProperty(aggregate[2], 'size', { value: 11 * 1024 * 1024 });
    await expect(upload(aggregate, signalOptions('batch-total')))
      .rejects.toThrow('Attachments for one message must total 50 MB or less.');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies caller-supplied quotas, reporting a non-megabyte cap in bytes', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const upload = createDaemonAttachmentUploader('', {
      maxAttachmentBytes: 100,
      maxAttachmentCount: 1,
      maxBatchBytes: 150,
    });

    const big = new File(['x'], 'big.bin');
    Object.defineProperty(big, 'size', { value: 101 });
    await expect(upload([big], signalOptions('batch-custom-1')))
      .rejects.toThrow('Each attachment must be 100 bytes or smaller.');
    await expect(upload(
      [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')],
      signalOptions('batch-custom-2'),
    )).rejects.toThrow('You can attach at most 1 files to one message.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts uploads already staged for the same turn against the per-turn quota', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => jsonResponse({ attachment: uploadedFile }, 201));
    const upload = createDaemonAttachmentUploader('', { maxAttachmentCount: 2 });

    await upload([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')], signalOptions('batch-running'));
    // A third file dropped into the same composer turn must be refused, even though this call only
    // carries one file.
    await expect(upload([new File(['c'], 'c.txt')], signalOptions('batch-running')))
      .rejects.toThrow('You can attach at most 2 files to one message.');
  });

  it('keeps batch accounting per uploader instance', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => jsonResponse({ attachment: uploadedFile }, 201));
    const first = createDaemonAttachmentUploader('', { maxAttachmentCount: 1 });
    const second = createDaemonAttachmentUploader('', { maxAttachmentCount: 1 });

    await first([new File(['a'], 'a.txt')], signalOptions('batch-shared'));
    // Same batch id, different uploader: the second instance must not have inherited the first's
    // usage — this is what a module-level usage map got wrong.
    await expect(second([new File(['b'], 'b.txt')], signalOptions('batch-shared'))).resolves.toHaveLength(1);
  });

  it('releases the reserved quota when the upload fails, so a retry is possible', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Transient failure' }, 500))
      .mockResolvedValueOnce(jsonResponse({ attachment: uploadedFile }, 201));
    const upload = createDaemonAttachmentUploader('', { maxAttachmentCount: 1 });

    await expect(upload([new File(['a'], 'a.txt')], signalOptions('batch-retry')))
      .rejects.toThrow('Transient failure');
    // Had the reservation stuck, this retry would fail the count check instead of reaching the wire.
    await expect(upload([new File(['a'], 'a.txt')], signalOptions('batch-retry')))
      .resolves.toEqual([uploadedFile]);
  });

  it('cleans up successful files when another upload in the batch fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ attachment: uploadedFile }, 201))
      .mockResolvedValueOnce(jsonResponse({ message: 'Upload rejected' }, 500))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock;

    await expect(createDaemonAttachmentUploader('')(
      [new File(['one'], 'one.txt'), new File(['two'], 'two.txt')],
      signalOptions('batch-partial'),
    )).rejects.toThrow('Upload rejected');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/attachments', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ batchId: 'batch-partial', paths: [uploadedFile.path] }),
    });
  });

  it('does not attempt cleanup when nothing was uploaded before the failure', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ message: 'Rejected outright' }, 500));
    globalThis.fetch = fetchMock;

    await expect(createDaemonAttachmentUploader('')(
      [new File(['one'], 'one.txt')],
      signalOptions('batch-nothing'),
    )).rejects.toThrow('Rejected outright');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still reports the original failure when the cleanup request itself fails', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ attachment: uploadedFile }, 201))
      .mockResolvedValueOnce(jsonResponse({ message: 'Upload rejected' }, 500))
      .mockRejectedValueOnce(new Error('network down'));

    await expect(createDaemonAttachmentUploader('')(
      [new File(['one'], 'one.txt'), new File(['two'], 'two.txt')],
      signalOptions('batch-cleanup-fails'),
    )).rejects.toThrow('Upload rejected');
  });

  it('aborts in-flight uploads when the composer signal aborts', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })) as unknown as typeof fetch;
    const pending = createDaemonAttachmentUploader('')(
      [new File(['a'], 'a.txt')],
      signalOptions('batch-abort', controller),
    );

    controller.abort(new Error('composer reset'));

    await expect(pending).rejects.toThrow();
  });

  it('does not start any upload when the composer signal is already aborted', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const controller = new AbortController();
    controller.abort(new Error('already gone'));

    await expect(createDaemonAttachmentUploader('')(
      [new File(['a'], 'a.txt')],
      signalOptions('batch-pre-aborted', controller),
    )).rejects.toThrow('already gone');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a non-Error abort reason as a cancellation', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const controller = new AbortController();
    // `AbortController.abort` accepts any reason; a string one must not surface as `undefined`.
    controller.abort('user navigated away');

    await expect(createDaemonAttachmentUploader('')(
      [new File(['a'], 'a.txt')],
      signalOptions('batch-string-reason', controller),
    )).rejects.toThrow('Attachment upload was canceled.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts with a timeout error once the deadline passes', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('aborted'));
        });
      })) as unknown as typeof fetch;
    const pending = createDaemonAttachmentUploader('', { timeoutMs: 5_000 })(
      [new File(['a'], 'a.txt')],
      signalOptions('batch-timeout'),
    );
    // Attached before the clock is advanced: the rejection lands inside `advanceTimersByTimeAsync`,
    // and a promise with no handler at that moment is reported as an unhandled rejection.
    const rejects = expect(pending).rejects.toThrow('Attachment upload timed out');

    await vi.advanceTimersByTimeAsync(5_000);

    await rejects;
  });

  it('honours a raised concurrency by keeping that many uploads in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    globalThis.fetch = vi.fn(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<Response>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve(jsonResponse({ attachment: uploadedFile }, 201));
        });
      });
    }) as unknown as typeof fetch;
    const pending = createDaemonAttachmentUploader('', { concurrency: 3 })(
      Array.from({ length: 6 }, (_, index) => new File(['x'], `${index}.txt`)),
      signalOptions('batch-concurrency'),
    );

    await vi.waitFor(() => expect(release).toHaveLength(3));
    expect(peak).toBe(3);
    while (release.length > 0) release.pop()?.();
    // Later files are picked up by whichever worker frees first, so all six still complete.
    await vi.waitFor(() => expect(release.length).toBeGreaterThan(0));
    while (release.length > 0) release.pop()?.();
    await expect(pending).resolves.toHaveLength(6);
  });

  it('holds concurrency to two by default', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    globalThis.fetch = vi.fn(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<Response>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve(jsonResponse({ attachment: uploadedFile }, 201));
        });
      });
    }) as unknown as typeof fetch;
    const pending = createDaemonAttachmentUploader('')(
      Array.from({ length: 4 }, (_, index) => new File(['x'], `${index}.txt`)),
      signalOptions('batch-default-concurrency'),
    );

    await vi.waitFor(() => expect(release).toHaveLength(2));
    expect(peak).toBe(2);
    while (release.length > 0) release.pop()?.();
    await vi.waitFor(() => expect(release.length).toBeGreaterThan(0));
    while (release.length > 0) release.pop()?.();
    await expect(pending).resolves.toHaveLength(4);
  });

  it('evicts stale batch usage rather than growing without bound', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => jsonResponse({ attachment: uploadedFile }, 201));
    const upload = createDaemonAttachmentUploader('', { maxAttachmentCount: 1 });
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(0);
    await upload([new File(['a'], 'a.txt')], signalOptions('batch-stale'));
    // An hour later the old turn's usage is expired, so the same batch id starts fresh instead of
    // being permanently at quota.
    nowSpy.mockReturnValue(60 * 60 * 1_000);
    await expect(upload([new File(['b'], 'b.txt')], signalOptions('batch-stale')))
      .resolves.toHaveLength(1);
  });

  it('drops the oldest tracked batch once the tracking cap is reached', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => jsonResponse({ attachment: uploadedFile }, 201));
    const upload = createDaemonAttachmentUploader('', { maxAttachmentCount: 1 });

    // 100 distinct turns fill the tracking map; the 101st must evict rather than grow, and the very
    // first turn's usage is what goes.
    for (let index = 0; index < 101; index += 1) {
      await upload([new File(['x'], 'x.txt')], signalOptions(`batch-lru-${index}`));
    }

    await expect(upload([new File(['x'], 'x.txt')], signalOptions('batch-lru-0')))
      .resolves.toHaveLength(1);
  });
});
