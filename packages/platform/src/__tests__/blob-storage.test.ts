import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalBlobStorage, S3BlobStorage, StorageError, type S3BlobStorageOptions } from '../blob-storage.js';

describe('LocalBlobStorage', () => {
  let dir: string;
  let store: LocalBlobStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jini-blob-storage-'));
    store = new LocalBlobStorage(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes and reads back a file, creating parent directories', async () => {
    const meta = await store.writeFile('ns1', 'a/b/c.txt', Buffer.from('hello'));
    expect(meta).toEqual({ path: 'a/b/c.txt', size: 5, mtimeMs: expect.any(Number) });
    expect((await store.readFile('ns1', 'a/b/c.txt')).toString()).toBe('hello');
  });

  it.each(['..', '', '.', 'a/b', 'a\\b', 'a\0b', 'x..y'])('rejects namespace %j for every operation', async (namespace) => {
    await expect(store.listFiles(namespace)).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.writeFile(namespace, 'f.txt', Buffer.from('x'))).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.readFile(namespace, 'f.txt')).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.deleteFile(namespace, 'f.txt')).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.statFile(namespace, 'f.txt')).rejects.toMatchObject({ code: 'TRAVERSAL' });
  });

  it('keeps the rest of the listing when a subdirectory vanishes during the walk', async () => {
    await store.writeFile('ns1', 'a.txt', Buffer.from('a'));
    await store.writeFile('ns1', 'sub/b.txt', Buffer.from('b'));
    const readdir = fsp.readdir.bind(fsp);
    const spy = vi.spyOn(fsp, 'readdir');
    spy.mockImplementation((async (...args: Parameters<typeof fsp.readdir>) => {
      if (String(args[0]) === join(dir, 'ns1', 'sub')) {
        throw Object.assign(new Error('directory vanished'), { code: 'ENOENT' });
      }
      return readdir(...args);
    }) as typeof fsp.readdir);
    try {
      expect((await store.listFiles('ns1')).map(file => file.path)).toEqual(['a.txt']);
    } finally {
      spy.mockRestore();
    }
  });

  it('throws NOT_FOUND reading a missing file', async () => {
    await expect(store.readFile('ns1', 'missing.txt')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      name: 'StorageError',
    });
  });

  it('throws IO reading a path that is a directory, not a file', async () => {
    await store.writeFile('ns1', 'dir/file.txt', Buffer.from('x'));
    await expect(store.readFile('ns1', 'dir')).rejects.toMatchObject({ code: 'IO' });
  });

  it('statFile returns null for a missing file', async () => {
    expect(await store.statFile('ns1', 'missing.txt')).toBeNull();
  });

  it('statFile returns null when the path is a directory', async () => {
    await store.writeFile('ns1', 'dir/file.txt', Buffer.from('x'));
    expect(await store.statFile('ns1', 'dir')).toBeNull();
  });

  it('statFile returns metadata for an existing file', async () => {
    await store.writeFile('ns1', 'f.txt', Buffer.from('12345'));
    const meta = await store.statFile('ns1', 'f.txt');
    expect(meta).toEqual({ path: 'f.txt', size: 5, mtimeMs: expect.any(Number) });
  });

  it('listFiles returns [] for a namespace that was never written to', async () => {
    expect(await store.listFiles('never-used')).toEqual([]);
  });

  it('listFiles recursively enumerates nested files with namespace-relative paths', async () => {
    await store.writeFile('ns1', 'a.txt', Buffer.from('1'));
    await store.writeFile('ns1', 'sub/b.txt', Buffer.from('22'));
    await store.writeFile('ns1', 'sub/deeper/c.txt', Buffer.from('333'));

    const files = await store.listFiles('ns1');
    expect(files.map((f) => f.path).sort()).toEqual(['a.txt', 'sub/b.txt', 'sub/deeper/c.txt']);
  });

  it('listFiles throws IO for a non-ENOENT readdir failure (namespace root is a file, not a directory)', async () => {
    writeFileSync(join(dir, 'conflict'), 'not a directory');
    await expect(store.listFiles('conflict')).rejects.toMatchObject({ code: 'IO' });
  });

  it('listFiles skips directory entries that are neither files nor directories (e.g. a symlink)', async () => {
    await store.writeFile('ns1', 'real.txt', Buffer.from('x'));
    symlinkSync(join(dir, 'ns1', 'real.txt'), join(dir, 'ns1', 'link.txt'));
    const files = await store.listFiles('ns1');
    expect(files.map((f) => f.path).sort()).toEqual(['real.txt']);
  });

  it('deleteFile is idempotent for a missing file', async () => {
    await expect(store.deleteFile('ns1', 'missing.txt')).resolves.toBeUndefined();
  });

  it('deleteFile removes an existing file', async () => {
    await store.writeFile('ns1', 'f.txt', Buffer.from('x'));
    await store.deleteFile('ns1', 'f.txt');
    expect(await store.statFile('ns1', 'f.txt')).toBeNull();
  });

  it('deleteFile throws IO when the target is a non-empty directory', async () => {
    await store.writeFile('ns1', 'sub/f.txt', Buffer.from('x'));
    await expect(store.deleteFile('ns1', 'sub')).rejects.toMatchObject({ code: 'IO' });
  });

  it.each([
    ['contains a slash', 'a/b'],
    ['contains a backslash', 'a\\b'],
    ['contains a NUL byte', 'a\0b'],
    ['contains ..', '..'],
    ['is empty', ''],
  ])('rejects a namespace that %s', async (_label, namespace) => {
    await expect(store.readFile(namespace, 'f.txt')).rejects.toMatchObject({ code: 'TRAVERSAL' });
  });

  it('rejects an empty relpath', async () => {
    await expect(store.readFile('ns1', '')).rejects.toMatchObject({ code: 'TRAVERSAL' });
  });

  it.each(['../escape.txt', 'a/../../escape.txt', './hidden.txt', 'a/./b.txt'])(
    'rejects a relpath with a %s traversal segment',
    async (relpath) => {
      await expect(store.readFile('ns1', relpath)).rejects.toMatchObject({ code: 'TRAVERSAL' });
    },
  );

  it('writing to the same path twice overwrites the content', async () => {
    await store.writeFile('ns1', 'f.txt', Buffer.from('first'));
    await store.writeFile('ns1', 'f.txt', Buffer.from('second'));
    expect((await store.readFile('ns1', 'f.txt')).toString()).toBe('second');
  });
});

function mockResponse(init: {
  ok: boolean;
  status: number;
  statusText?: string;
  body?: string;
  headers?: Record<string, string>;
  textThrows?: boolean;
}): Response {
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText ?? '',
    headers: { get: (name: string) => init.headers?.[name.toLowerCase()] ?? null },
    text: async () => {
      if (init.textThrows) throw new Error('stream already consumed');
      return init.body ?? '';
    },
    arrayBuffer: async () => {
      // `Buffer.from(string)` may allocate from Node's shared internal pool, in which case
      // `.buffer` is the whole pool's ArrayBuffer rather than one sized to this string — slice to
      // the buffer's own byteOffset/byteLength so the mock returns exactly the intended bytes.
      const buf = Buffer.from(init.body ?? '', 'utf8');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  } as unknown as Response;
}

function s3Options(overrides: Partial<S3BlobStorageOptions> = {}, fetchFn?: typeof fetch): S3BlobStorageOptions {
  return {
    bucket: 'my-bucket',
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKID', secretAccessKey: 'SECRET' },
    fetchFn: fetchFn ?? (vi.fn() as unknown as typeof fetch),
    now: () => new Date('2026-01-15T00:00:00.000Z'),
    ...overrides,
  };
}

describe('S3BlobStorage — construction', () => {
  it('throws when bucket is missing', () => {
    expect(() => new S3BlobStorage(s3Options({ bucket: '' }))).toThrow(/requires a bucket/);
  });

  it('throws when region is missing', () => {
    expect(() => new S3BlobStorage(s3Options({ region: '' }))).toThrow(/requires a region/);
  });

  it('throws when credentials.accessKeyId is missing', () => {
    expect(() => new S3BlobStorage(s3Options({ credentials: { accessKeyId: '', secretAccessKey: 'x' } }))).toThrow(
      /accessKeyId/,
    );
  });

  it('throws when credentials.secretAccessKey is missing', () => {
    expect(() => new S3BlobStorage(s3Options({ credentials: { accessKeyId: 'x', secretAccessKey: '' } }))).toThrow(
      /secretAccessKey/,
    );
  });

  it('throws when no fetch implementation is available', () => {
    const originalFetch = globalThis.fetch;
    // @ts-expect-error -- deliberately clearing the global to exercise the no-fetch branch
    delete globalThis.fetch;
    try {
      const { fetchFn: _omit, ...rest } = s3Options();
      expect(() => new S3BlobStorage(rest)).toThrow(/requires a fetch implementation/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to globalThis.fetch when fetchFn is omitted and a global fetch exists', () => {
    const { fetchFn: _omit, ...rest } = s3Options();
    expect(() => new S3BlobStorage(rest)).not.toThrow();
  });
});

describe('S3BlobStorage — readFile', () => {
  it('returns the body bytes on 200', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: 'payload' }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    const buf = await store.readFile('ns1', 'f.txt');
    expect(buf.toString()).toBe('payload');
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('https://my-bucket.s3.us-east-1.amazonaws.com/ns1/f.txt'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws NOT_FOUND on 404', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 404 }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    await expect(store.readFile('ns1', 'f.txt')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws IO on a non-404 failure, including response text in the message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 500, statusText: 'Boom', body: 'server exploded' }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    await expect(store.readFile('ns1', 'f.txt')).rejects.toMatchObject({ code: 'IO', message: expect.stringContaining('server exploded') });
  });

  it('safeText swallows a text() failure and yields an empty string in the error message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 500, textThrows: true }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    await expect(store.readFile('ns1', 'f.txt')).rejects.toMatchObject({ code: 'IO', message: expect.stringContaining('500') });
  });

  it('falls back to the current clock when `now` is not supplied in options', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: 'x' }));
    const { now: _omit, ...rest } = s3Options({}, fetchFn);
    const store = new S3BlobStorage(rest);
    await expect(store.readFile('ns1', 'f.txt')).resolves.toBeInstanceOf(Buffer);
  });

  it('uses path-style requests against a custom endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: 'x' }));
    const store = new S3BlobStorage(s3Options({ endpoint: 'http://localhost:9000' }, fetchFn));
    await store.readFile('ns1', 'f.txt');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:9000/my-bucket/ns1/f.txt',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('S3BlobStorage — writeFile', () => {
  it('PUTs the body and returns metadata', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200 }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    const meta = await store.writeFile('ns1', 'f.txt', Buffer.from('hello'));
    expect(meta).toEqual({ path: 'f.txt', size: 5, mtimeMs: expect.any(Number) });
    expect(fetchFn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'PUT', body: Buffer.from('hello') }));
  });

  it('throws IO on failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 403, statusText: 'Forbidden' }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    await expect(store.writeFile('ns1', 'f.txt', Buffer.from('x'))).rejects.toMatchObject({ code: 'IO' });
  });
});

describe('S3BlobStorage — deleteFile', () => {
  it('succeeds on 204', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 204 }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    await expect(store.deleteFile('ns1', 'f.txt')).resolves.toBeUndefined();
  });

  it('is idempotent on 404', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 404 }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    await expect(store.deleteFile('ns1', 'f.txt')).resolves.toBeUndefined();
  });

  it('throws IO on a non-404 failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 500, statusText: 'Boom' }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    await expect(store.deleteFile('ns1', 'f.txt')).rejects.toMatchObject({ code: 'IO' });
  });
});

describe('S3BlobStorage — statFile', () => {
  it('uses the current clock for a malformed last-modified header', async () => {
    const before = Date.now();
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, headers: { 'last-modified': 'not a date' } }));
    const meta = await new S3BlobStorage(s3Options({}, fetchFn)).statFile('ns1', 'f.txt');
    expect(meta?.mtimeMs).toBeGreaterThanOrEqual(before);
    expect(meta?.mtimeMs).toBeLessThanOrEqual(Date.now());
  });
  it('returns metadata from content-length and last-modified headers', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ ok: true, status: 200, headers: { 'content-length': '42', 'last-modified': 'Thu, 15 Jan 2026 00:00:00 GMT' } }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    const meta = await store.statFile('ns1', 'f.txt');
    expect(meta).toEqual({ path: 'f.txt', size: 42, mtimeMs: Date.parse('Thu, 15 Jan 2026 00:00:00 GMT') });
  });

  it('returns null on 404', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 404 }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    expect(await store.statFile('ns1', 'f.txt')).toBeNull();
  });

  it('throws IO on a non-404 failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 500 }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    await expect(store.statFile('ns1', 'f.txt')).rejects.toMatchObject({ code: 'IO' });
  });

  it('falls back to content-length "0" and no last-modified when both headers are entirely absent', async () => {
    const before = Date.now();
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200 }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    const meta = await store.statFile('ns1', 'f.txt');
    expect(meta?.size).toBe(0);
    expect(meta?.mtimeMs).toBeGreaterThanOrEqual(before);
  });

  it('falls back to size 0 when content-length is non-numeric, and Date.now() when last-modified is absent', async () => {
    const before = Date.now();
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, headers: { 'content-length': 'not-a-number' } }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    const meta = await store.statFile('ns1', 'f.txt');
    expect(meta?.size).toBe(0);
    expect(meta?.mtimeMs).toBeGreaterThanOrEqual(before);
  });
});

describe('S3BlobStorage — listFiles', () => {
  it.each(['', '/tenant a/'])('isolates ns1 from ns10 with bucket prefix %j', async (prefix) => {
    const base = prefix ? 'tenant a/' : '';
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({
      ok: true, status: 200,
      body: `<ListBucketResult><Contents><Key>${base}ns1/a.txt</Key><Size>1</Size></Contents>` +
        `<Contents><Key>${base}ns10/secret.txt</Key><Size>2</Size></Contents>` +
        `<Contents><Key>${base}ns1/</Key><Size>0</Size></Contents></ListBucketResult>`,
    }));
    const files = await new S3BlobStorage(s3Options({ prefix }, fetchFn)).listFiles('ns1');
    expect(files.map(file => file.path)).toEqual(['a.txt']);
    expect(new URL(fetchFn.mock.calls[0]![0]).searchParams.get('prefix')).toBe(`${base}ns1/`);
  });

  it('uses a finite clock fallback for malformed listing timestamps too', async () => {
    const before = Date.now();
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200,
      body: '<ListBucketResult><Contents><Key>ns1/a.txt</Key><LastModified>invalid</LastModified><Size>1</Size></Contents></ListBucketResult>',
    }));
    const [file] = await new S3BlobStorage(s3Options({}, fetchFn)).listFiles('ns1');
    expect(file?.mtimeMs).toBeGreaterThanOrEqual(before);
    expect(file?.mtimeMs).toBeLessThanOrEqual(Date.now());
  });
  function listBucketXml(entries: Array<{ key: string; size: number; lastModified: string }>, opts: { truncated?: boolean; nextToken?: string } = {}) {
    const contents = entries
      .map((e) => `<Contents><Key>${e.key}</Key><LastModified>${e.lastModified}</LastModified><Size>${e.size}</Size></Contents>`)
      .join('');
    const truncated = opts.truncated ? '<IsTruncated>true</IsTruncated>' : '<IsTruncated>false</IsTruncated>';
    const token = opts.nextToken ? `<NextContinuationToken>${opts.nextToken}</NextContinuationToken>` : '';
    return `<ListBucketResult>${contents}${truncated}${token}</ListBucketResult>`;
  }

  it('lists entries under the namespace prefix, stripping the prefix from returned paths', async () => {
    const xml = listBucketXml([
      { key: 'ns1/a.txt', size: 3, lastModified: '2026-01-15T00:00:00.000Z' },
      { key: 'ns1/sub/b.txt', size: 4, lastModified: '2026-01-15T00:00:01.000Z' },
    ]);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: xml }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    const files = await store.listFiles('ns1');
    expect(files).toEqual([
      { path: 'a.txt', size: 3, mtimeMs: Date.parse('2026-01-15T00:00:00.000Z') },
      { path: 'sub/b.txt', size: 4, mtimeMs: Date.parse('2026-01-15T00:00:01.000Z') },
    ]);
  });

  it('skips an entry equal to the prefix marker itself', async () => {
    const xml = listBucketXml([{ key: 'ns1', size: 0, lastModified: '2026-01-15T00:00:00.000Z' }]);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: xml }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    expect(await store.listFiles('ns1')).toEqual([]);
  });

  it('paginates using the continuation token until IsTruncated is false', async () => {
    const page1 = listBucketXml([{ key: 'ns1/a.txt', size: 1, lastModified: '2026-01-15T00:00:00.000Z' }], {
      truncated: true,
      nextToken: 'TOKEN1',
    });
    const page2 = listBucketXml([{ key: 'ns1/b.txt', size: 2, lastModified: '2026-01-15T00:00:01.000Z' }]);
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, body: page1 }))
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, body: page2 }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    const files = await store.listFiles('ns1');
    expect(files.map((f) => f.path)).toEqual(['a.txt', 'b.txt']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1]?.[0]).toContain('continuation-token=TOKEN1');
  });

  it('throws IO on a failed list request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 500, statusText: 'Boom' }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    await expect(store.listFiles('ns1')).rejects.toMatchObject({ code: 'IO' });
  });

  it('returns [] when the bucket has no matching entries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: listBucketXml([]) }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    expect(await store.listFiles('ns1')).toEqual([]);
  });

  it('skips a <Contents> entry with no <Key> tag', async () => {
    const xml = '<ListBucketResult><Contents><Size>1</Size></Contents><IsTruncated>false</IsTruncated></ListBucketResult>';
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: xml }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    expect(await store.listFiles('ns1')).toEqual([]);
  });

  it('defaults size to 0 when the <Size> tag is missing or non-numeric', async () => {
    const xml =
      '<ListBucketResult>' +
      '<Contents><Key>ns1/no-size.txt</Key></Contents>' +
      '<Contents><Key>ns1/bad-size.txt</Key><Size>not-a-number</Size></Contents>' +
      '<IsTruncated>false</IsTruncated></ListBucketResult>';
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: xml }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    const files = await store.listFiles('ns1');
    expect(files.map((f) => f.size)).toEqual([0, 0]);
  });

  it('defaults mtimeMs to Date.now() when the <LastModified> tag is missing', async () => {
    const before = Date.now();
    const xml = '<ListBucketResult><Contents><Key>ns1/no-date.txt</Key><Size>1</Size></Contents><IsTruncated>false</IsTruncated></ListBucketResult>';
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: xml }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    const files = await store.listFiles('ns1');
    expect(files[0]?.mtimeMs).toBeGreaterThanOrEqual(before);
  });

  it('treats a response with no <IsTruncated> tag at all as not truncated', async () => {
    const xml = '<ListBucketResult><Contents><Key>ns1/a.txt</Key><Size>1</Size></Contents></ListBucketResult>';
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: xml }));
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    const files = await store.listFiles('ns1');
    expect(files.map((f) => f.path)).toEqual(['a.txt']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('S3BlobStorage — keyFor / prefix option', () => {
  it.each(['.', 'a\0b'])('rejects namespace %j before any S3 request', async (namespace) => {
    const fetchFn = vi.fn();
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    expect(() => store.keyFor(namespace, 'f.txt')).toThrow(StorageError);
    await expect(store.listFiles(namespace)).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.readFile(namespace, 'f.txt')).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.writeFile(namespace, 'f.txt', Buffer.from('x'))).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.deleteFile(namespace, 'f.txt')).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.statFile(namespace, 'f.txt')).rejects.toMatchObject({ code: 'TRAVERSAL' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each(['', '/', '\\', '///', '\\\\', 'a\0b', '.', 'a/./b'])('rejects unsafe or empty key %j before S3 I/O', async (relpath) => {
    const fetchFn = vi.fn();
    const store = new S3BlobStorage(s3Options({}, fetchFn));
    await expect(store.readFile('ns1', relpath)).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.writeFile('ns1', relpath, Buffer.from('x'))).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.deleteFile('ns1', relpath)).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.statFile('ns1', relpath)).rejects.toMatchObject({ code: 'TRAVERSAL' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it.each([
    ['contains a slash', 'a/b'],
    ['contains a backslash', 'a\\b'],
    ['contains ..', '..'],
    ['is empty', ''],
  ])('rejects a namespace that %s', (_label, namespace) => {
    const store = new S3BlobStorage(s3Options());
    expect(() => store.keyFor(namespace, 'f.txt')).toThrow(/invalid namespace/);
  });

  it.each(['../escape.txt', 'a/../b.txt'])('rejects an unsafe relpath %s', (relpath) => {
    const store = new S3BlobStorage(s3Options());
    expect(() => store.keyFor('ns1', relpath)).toThrow(/unsafe relpath/);
  });

  it('joins an optional prefix ahead of the namespace', () => {
    const store = new S3BlobStorage(s3Options({ prefix: '/tenant-a/' }));
    expect(store.keyFor('ns1', 'f.txt')).toBe('tenant-a/ns1/f.txt');
  });

  it('keyFor permits an empty relpath only when explicitly building a listing prefix', () => {
    const store = new S3BlobStorage(s3Options());
    expect(() => store.keyFor('ns1', '')).toThrow(/empty relpath/);
    expect(store.keyFor('ns1', '', { allowPrefix: true })).toBe('ns1');
  });
});
