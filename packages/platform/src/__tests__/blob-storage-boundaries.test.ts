// Boundary pins for ./blob-storage.ts: every refusal's code + exact message,
// path containment for POSIX and Windows-shaped namespace/relpath input, the
// S3 URL/query shapes, and the listing pagination cap. Written green against
// the pre-refactor code so the refactor is provably behaviour-neutral. Tests
// named "(reported, not fixed)" pin a current weakness without endorsing it.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalBlobStorage, S3BlobStorage, StorageError, type S3BlobStorageOptions } from '../blob-storage.js';

function storageRefusal(fn: () => unknown): StorageError {
  try {
    fn();
  } catch (error) {
    if (error instanceof StorageError) return error;
    throw error;
  }
  throw new Error('expected a StorageError');
}

describe('LocalBlobStorage boundaries', () => {
  let dir: string;
  let root: string;
  let store: LocalBlobStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jini-blob-bounds-'));
    root = join(dir, 'root');
    mkdirSync(root);
    store = new LocalBlobStorage(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['', 'invalid namespace '],
    ['a/b', 'invalid namespace a/b'],
    ['a\\b', 'invalid namespace a\\b'],
    ['C:\\temp', 'invalid namespace C:\\temp'],
    ['a\0b', 'invalid namespace a\0b'],
    ['..', 'invalid namespace ..'],
    ['x..y', 'invalid namespace x..y'],
  ])('refuses namespace %j with TRAVERSAL "%s"', async (namespace, message) => {
    await expect(store.readFile(namespace, 'f.txt')).rejects.toMatchObject({
      name: 'StorageError',
      code: 'TRAVERSAL',
      message,
    });
  });

  it.each(['', '/', '\\', '//', '\\\\'])('refuses relpath %j with TRAVERSAL "empty relpath"', async (relpath) => {
    await expect(store.readFile('ns1', relpath)).rejects.toMatchObject({ code: 'TRAVERSAL', message: 'empty relpath' });
  });

  it.each(['..\\escape.txt', 'a\\..\\..\\escape.txt', '.\\hidden.txt', 'a/..', '.'])(
    'refuses relpath %j with TRAVERSAL "unsafe relpath <input>"',
    async (relpath) => {
      await expect(store.readFile('ns1', relpath)).rejects.toMatchObject({
        code: 'TRAVERSAL',
        message: `unsafe relpath ${relpath}`,
      });
    },
  );

  it('applies the same guard to writeFile, deleteFile and statFile', async () => {
    const write = store.writeFile('ns1', '../x.txt', Buffer.from('x'));
    await expect(write).rejects.toMatchObject({ code: 'TRAVERSAL', message: 'unsafe relpath ../x.txt' });
    await expect(store.deleteFile('ns1', '../x.txt')).rejects.toMatchObject({ code: 'TRAVERSAL' });
    await expect(store.statFile('a/b', 'x.txt')).rejects.toMatchObject({ code: 'TRAVERSAL' });
    expect(existsSync(join(dir, 'x.txt'))).toBe(false);
  });

  it('keeps a Windows drive-letter relpath inside the namespace as a plain "C:" segment', async () => {
    const meta = await store.writeFile('ns1', 'C:\\Windows\\evil.dll', Buffer.from('x'));
    expect(meta.path).toBe('C:/Windows/evil.dll');
    expect(existsSync(join(root, 'ns1', 'C:', 'Windows', 'evil.dll'))).toBe(true);
  });

  it('keeps a UNC-shaped relpath inside the namespace (leading separators stripped)', async () => {
    const meta = await store.writeFile('ns1', '\\\\server\\share\\f.txt', Buffer.from('x'));
    expect(meta.path).toBe('server/share/f.txt');
    expect(existsSync(join(root, 'ns1', 'server', 'share', 'f.txt'))).toBe(true);
  });

  it('keeps an absolute POSIX relpath inside the namespace', async () => {
    const meta = await store.writeFile('ns1', '/etc/passwd', Buffer.from('x'));
    expect(meta.path).toBe('etc/passwd');
    expect(existsSync(join(root, 'ns1', 'etc', 'passwd'))).toBe(true);
  });

  it('collapses repeated and mixed separators in the returned path', async () => {
    const meta = await store.writeFile('ns1', 'a//b\\\\c.txt', Buffer.from('x'));
    expect(meta.path).toBe('a/b/c.txt');
  });

  it('reports NOT_FOUND as "<namespace>/<relpath> not found"', async () => {
    await expect(store.readFile('ns1', 'missing.txt')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'ns1/missing.txt not found',
    });
  });

  it('reports a non-ENOENT read failure as IO "read failed: <cause>"', async () => {
    await store.writeFile('ns1', 'dir/f.txt', Buffer.from('x'));
    await expect(store.readFile('ns1', 'dir')).rejects.toMatchObject({
      code: 'IO',
      message: expect.stringMatching(/^read failed: EISDIR/),
    });
  });

  it('reports a non-ENOENT readdir failure as IO "list failed: <cause>"', async () => {
    writeFileSync(join(root, 'conflict'), 'not a directory');
    await expect(store.listFiles('conflict')).rejects.toMatchObject({
      code: 'IO',
      message: expect.stringMatching(/^list failed: ENOTDIR/),
    });
  });

  it('reports an rm failure as IO "delete failed: <cause>"', async () => {
    vi.spyOn(fsp, 'rm').mockRejectedValueOnce(new Error('EPERM: operation not permitted'));
    await expect(store.deleteFile('ns1', 'f.txt')).rejects.toMatchObject({
      code: 'IO',
      message: 'delete failed: EPERM: operation not permitted',
    });
  });

  it('lists sizes and mtimes from stat', async () => {
    await store.writeFile('ns1', 'a.txt', Buffer.from('abc'));
    const [entry] = await store.listFiles('ns1');
    expect(entry).toEqual({ path: 'a.txt', size: 3, mtimeMs: expect.any(Number) });
  });

  it('returns [] when a nested directory vanishes mid-walk (reported, not fixed)', async () => {
    await store.writeFile('ns1', 'a.txt', Buffer.from('1'));
    await store.writeFile('ns1', 'sub/b.txt', Buffer.from('2'));
    const realReaddir = fsp.readdir.bind(fsp);
    let calls = 0;
    vi.spyOn(fsp, 'readdir').mockImplementation((async (...args: Parameters<typeof fsp.readdir>) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error('ENOENT: gone'), { code: 'ENOENT' });
      return realReaddir(...args);
    }) as typeof fsp.readdir);
    // The whole listing collapses to [], dropping a.txt which was already found.
    expect(await store.listFiles('ns1')).toEqual([]);
  });

  it('accepts namespace "." and writes straight into the storage root (reported, not fixed)', async () => {
    await store.writeFile('.', 'f.txt', Buffer.from('x'));
    expect(existsSync(join(root, 'f.txt'))).toBe(true);
  });

  it('listFiles does not validate the namespace, so ".." lists outside the root (reported, not fixed)', async () => {
    writeFileSync(join(dir, 'outside.txt'), 'secret');
    const files = await store.listFiles('..');
    expect(files.map((f) => f.path)).toContain('outside.txt');
  });

  it('listFiles with an empty namespace lists every namespace under the root (reported, not fixed)', async () => {
    await store.writeFile('ns1', 'a.txt', Buffer.from('1'));
    await store.writeFile('ns2', 'b.txt', Buffer.from('2'));
    const files = await store.listFiles('');
    expect(files.map((f) => f.path).sort()).toEqual(['ns1/a.txt', 'ns2/b.txt']);
  });
});

describe('S3BlobStorage boundaries', () => {
  function options(overrides: Partial<S3BlobStorageOptions> = {}): S3BlobStorageOptions {
    return {
      bucket: 'my-bucket',
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKID', secretAccessKey: 'SECRET' },
      now: () => new Date('2026-01-15T00:00:00.000Z'),
      ...overrides,
    };
  }

  function fetchReturning(...responses: Response[]) {
    const fn = vi.fn<typeof fetch>();
    for (const res of responses) fn.mockResolvedValueOnce(res);
    return fn;
  }

  function listXml(keys: string[], tail = '<IsTruncated>false</IsTruncated>'): string {
    const contents = keys.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join('');
    return `<ListBucketResult>${contents}${tail}</ListBucketResult>`;
  }

  it.each([
    [{ bucket: '' }, 'S3BlobStorage requires a bucket'],
    [{ region: '' }, 'S3BlobStorage requires a region'],
    [{ credentials: { accessKeyId: '', secretAccessKey: 'x' } }, 'S3BlobStorage requires credentials.accessKeyId'],
    [{ credentials: { accessKeyId: 'x', secretAccessKey: '' } }, 'S3BlobStorage requires credentials.secretAccessKey'],
  ])('refuses construction with IO "%s"', (overrides, message) => {
    const error = storageRefusal(() => new S3BlobStorage(options(overrides)));
    expect(error.code).toBe('IO');
    expect(error.message).toBe(message);
  });

  it.each([
    ['', 'invalid namespace '],
    ['a/b', 'invalid namespace a/b'],
    ['a\\b', 'invalid namespace a\\b'],
    ['C:\\temp', 'invalid namespace C:\\temp'],
    ['..', 'invalid namespace ..'],
  ])('keyFor refuses namespace %j with TRAVERSAL "%s"', (namespace, message) => {
    const error = storageRefusal(() => new S3BlobStorage(options()).keyFor(namespace, 'f.txt'));
    expect(error.code).toBe('TRAVERSAL');
    expect(error.message).toBe(message);
  });

  it.each(['..\\escape.txt', 'a\\..\\b.txt', '.\\x', '.'])('keyFor refuses relpath %j with TRAVERSAL', (relpath) => {
    const error = storageRefusal(() => new S3BlobStorage(options()).keyFor('ns1', relpath));
    expect(error.code).toBe('TRAVERSAL');
    expect(error.message).toBe(`unsafe relpath ${relpath}`);
  });

  it('keyFor keeps a Windows drive-letter relpath as a plain "C:" segment', () => {
    expect(new S3BlobStorage(options()).keyFor('ns1', 'C:\\Windows\\x.dll')).toBe('ns1/C:/Windows/x.dll');
  });

  it('keyFor strips leading and collapses repeated separators', () => {
    expect(new S3BlobStorage(options()).keyFor('ns1', '\\\\a//b\\c.txt')).toBe('ns1/a/b/c.txt');
  });

  it('keyFor drops a prefix made only of slashes', () => {
    expect(new S3BlobStorage(options({ prefix: '///' })).keyFor('ns1', 'f.txt')).toBe('ns1/f.txt');
  });

  it('keyFor accepts a NUL byte in the namespace, unlike LocalBlobStorage (reported, not fixed)', () => {
    expect(new S3BlobStorage(options()).keyFor('a\0b', 'f.txt')).toBe('a\0b/f.txt');
  });

  it('keyFor accepts namespace "." (reported, not fixed)', () => {
    expect(new S3BlobStorage(options()).keyFor('.', 'f.txt')).toBe('./f.txt');
  });

  it('readFile with relpath "/" targets the bare namespace key instead of refusing (reported, not fixed)', async () => {
    const fetchFn = fetchReturning(new Response('marker'));
    await new S3BlobStorage(options({ fetchFn })).readFile('ns1', '/');
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/ns1');
  });

  it('percent-encodes each key segment in the URL', async () => {
    const fetchFn = fetchReturning(new Response('x'));
    await new S3BlobStorage(options({ fetchFn })).readFile('ns1', "a b/it's(1).txt");
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/ns1/a%20b/it%27s%281%29.txt');
  });

  it('signs with host, x-amz-date and authorization headers and sends no body on GET', async () => {
    const fetchFn = fetchReturning(new Response('x'));
    await new S3BlobStorage(options({ fetchFn })).readFile('ns1', 'f.txt');
    const init = fetchFn.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers['host']).toBe('my-bucket.s3.us-east-1.amazonaws.com');
    expect(headers['x-amz-date']).toBe('20260115T000000Z');
    expect(headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20260115\/us-east-1\/s3\/aws4_request/);
    expect(init && 'body' in init).toBe(false);
  });

  it('strips trailing slashes from a custom endpoint and signs its host', async () => {
    const fetchFn = fetchReturning(new Response('x'));
    await new S3BlobStorage(options({ fetchFn, endpoint: 'http://minio:9000///' })).readFile('ns1', 'f.txt');
    expect(fetchFn.mock.calls[0]?.[0]).toBe('http://minio:9000/my-bucket/ns1/f.txt');
    expect((fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>)['host']).toBe('minio:9000');
  });

  it.each([
    ['readFile', (s: S3BlobStorage) => s.readFile('ns1', 'f.txt'), 'S3 GET ns1/f.txt → 500 Boom: server exploded'],
    ['writeFile', (s: S3BlobStorage) => s.writeFile('ns1', 'f.txt', Buffer.from('x')), 'S3 PUT ns1/f.txt → 500 Boom: server exploded'],
    ['deleteFile', (s: S3BlobStorage) => s.deleteFile('ns1', 'f.txt'), 'S3 DELETE ns1/f.txt → 500 Boom: server exploded'],
    ['statFile', (s: S3BlobStorage) => s.statFile('ns1', 'f.txt'), 'S3 HEAD ns1/f.txt → 500 Boom'],
    ['listFiles', (s: S3BlobStorage) => s.listFiles('ns1'), 'S3 LIST ns1 → 500 Boom: server exploded'],
  ])('%s reports an upstream failure as IO "%s"', async (_name, call, message) => {
    const fetchFn = fetchReturning(new Response('server exploded', { status: 500, statusText: 'Boom' }));
    await expect(call(new S3BlobStorage(options({ fetchFn })))).rejects.toMatchObject({ code: 'IO', message });
  });

  it('truncates the upstream error body to 256 characters', async () => {
    const fetchFn = fetchReturning(new Response('y'.repeat(300), { status: 500, statusText: 'Boom' }));
    await expect(new S3BlobStorage(options({ fetchFn })).readFile('ns1', 'f.txt')).rejects.toMatchObject({
      message: `S3 GET ns1/f.txt → 500 Boom: ${'y'.repeat(256)}`,
    });
  });

  it('reports a 404 read as NOT_FOUND "<namespace>/<relpath> not found"', async () => {
    const fetchFn = fetchReturning(new Response(null, { status: 404 }));
    await expect(new S3BlobStorage(options({ fetchFn })).readFile('ns1', 'a/b.txt')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'ns1/a/b.txt not found',
    });
  });

  it('statFile turns an unparseable last-modified into NaN mtimeMs (reported, not fixed)', async () => {
    const fetchFn = fetchReturning(new Response(null, { headers: { 'last-modified': 'not a date' } }));
    const meta = await new S3BlobStorage(options({ fetchFn })).statFile('ns1', 'f.txt');
    expect(meta?.mtimeMs).toBeNaN();
  });

  it('lists with a sorted, encoded query against the virtual-host root path', async () => {
    const fetchFn = fetchReturning(new Response(listXml([])));
    await new S3BlobStorage(options({ fetchFn, prefix: 'tenant a' })).listFiles('ns1');
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/?list-type=2&prefix=tenant%20a%2Fns1');
  });

  it('lists path-style against a custom endpoint, with the continuation token sorted first', async () => {
    const fetchFn = fetchReturning(
      new Response(listXml(['ns1/a'], '<IsTruncated>true</IsTruncated><NextContinuationToken>T+1/=</NextContinuationToken>')),
      new Response(listXml(['ns1/b'])),
    );
    const files = await new S3BlobStorage(options({ fetchFn, endpoint: 'http://minio:9000' })).listFiles('ns1');
    expect(files.map((f) => f.path)).toEqual(['a', 'b']);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('http://minio:9000/my-bucket?list-type=2&prefix=ns1');
    expect(fetchFn.mock.calls[1]?.[0]).toBe(
      'http://minio:9000/my-bucket?continuation-token=T%2B1%2F%3D&list-type=2&prefix=ns1',
    );
  });

  it('stops paginating when IsTruncated is true but no continuation token is given', async () => {
    const fetchFn = fetchReturning(new Response(listXml(['ns1/a'], '<IsTruncated>TRUE</IsTruncated>')));
    expect((await new S3BlobStorage(options({ fetchFn })).listFiles('ns1')).map((f) => f.path)).toEqual(['a']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('strips extra slashes after the namespace prefix from listed keys', async () => {
    const fetchFn = fetchReturning(new Response(listXml(['ns1//deep/a.txt'])));
    expect((await new S3BlobStorage(options({ fetchFn })).listFiles('ns1')).map((f) => f.path)).toEqual(['deep/a.txt']);
  });

  it('stops after 1000 pages even when the bucket keeps reporting more', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(listXml(['ns1/x'], '<IsTruncated>true</IsTruncated><NextContinuationToken>again</NextContinuationToken>')),
    );
    const files = await new S3BlobStorage(options({ fetchFn })).listFiles('ns1');
    expect(fetchFn).toHaveBeenCalledTimes(1000);
    expect(files).toHaveLength(1000);
  });

  it('surfaces a sibling namespace sharing the prefix as if it were this namespace (reported, not fixed)', async () => {
    // The list prefix is "ns1" with no trailing slash, so S3 also returns "ns10/...".
    const fetchFn = fetchReturning(new Response(listXml(['ns1/a.txt', 'ns10/leak.txt'])));
    const files = await new S3BlobStorage(options({ fetchFn })).listFiles('ns1');
    expect(files.map((f) => f.path)).toEqual(['a.txt', 'leak.txt']);
  });
});
