/**
 * @module blob-storage
 *
 * A narrow, backend-agnostic blob storage port — `readFile`/`writeFile`/`listFiles`/
 * `deleteFile`/`statFile` scoped under an opaque `namespace` string — plus two
 * implementations: {@link LocalBlobStorage} (the local-disk default) and
 * {@link S3BlobStorage} (an S3-compatible backend: AWS S3, and any endpoint-compatible
 * store such as MinIO, Aliyun OSS, Tencent COS, or Huawei OBS, signed inline via
 * `./aws-sigv4.js`).
 *
 * `namespace` is deliberately opaque here — a top-level grouping key (a tenant id, a
 * workspace id, a project id, whatever the host application scopes storage by) — this
 * module carries no domain meaning for what a namespace *is*, only that paths are
 * grouped and traversal-guarded underneath one.
 */
import path from 'node:path';
import { promises as fsp, type Dirent } from 'node:fs';
import { encodeS3PathSegment, signSigV4, type SigV4Credentials } from './aws-sigv4.js';

/** Metadata for a single stored blob. */
export interface BlobFileMeta {
  /** Path relative to the namespace root. Always uses forward slashes. */
  path: string;
  /** Total size in bytes. */
  size: number;
  /** Unix epoch milliseconds of last modification. */
  mtimeMs: number;
}

/** The narrow contract every blob storage backend implements. */
export interface BlobStorage {
  /** Reads `<namespace>/<relpath>` into a Buffer. Throws a `StorageError('NOT_FOUND', ...)` when missing. */
  readFile(namespace: string, relpath: string): Promise<Buffer>;
  /** Writes `<namespace>/<relpath>`, creating parent directories/prefixes as needed. */
  writeFile(namespace: string, relpath: string, body: Buffer): Promise<BlobFileMeta>;
  /**
   * Lists every file under `<namespace>/` recursively. The order is implementation-defined;
   * callers that need deterministic order sort by `path`.
   */
  listFiles(namespace: string): Promise<BlobFileMeta[]>;
  /** Deletes a single file under `<namespace>/`. Idempotent — missing files do not throw. */
  deleteFile(namespace: string, relpath: string): Promise<void>;
  /** Reports metadata for a single file without reading its bytes. Returns `null` when missing. */
  statFile(namespace: string, relpath: string): Promise<BlobFileMeta | null>;
}

/** Error thrown by {@link BlobStorage} implementations, distinguishing not-found/traversal/IO failures. */
export class StorageError extends Error {
  readonly code: 'NOT_FOUND' | 'TRAVERSAL' | 'IO';
  constructor(code: 'NOT_FOUND' | 'TRAVERSAL' | 'IO', message: string) {
    super(message);
    this.code = code;
    this.name = 'StorageError';
  }
}

/**
 * The local-disk default backend — a thin `fs/promises` wrapper rooted at a caller-supplied
 * directory, with a traversal guard so a hostile `namespace`/`relpath` can never escape it.
 */
export class LocalBlobStorage implements BlobStorage {
  constructor(private readonly root: string) {}

  async readFile(namespace: string, relpath: string): Promise<Buffer> {
    const abs = this.resolvePath(namespace, relpath);
    try {
      return await fsp.readFile(abs);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') throw new StorageError('NOT_FOUND', `${namespace}/${relpath} not found`);
      throw new StorageError('IO', `read failed: ${e.message}`);
    }
  }

  async writeFile(namespace: string, relpath: string, body: Buffer): Promise<BlobFileMeta> {
    const abs = this.resolvePath(namespace, relpath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, body);
    const stat = await fsp.stat(abs);
    return { path: normalizeRel(relpath), size: stat.size, mtimeMs: stat.mtimeMs };
  }

  async listFiles(namespace: string): Promise<BlobFileMeta[]> {
    const root = path.join(this.root, namespace);
    const out: BlobFileMeta[] = [];
    const queue: string[] = [root];
    while (queue.length > 0) {
      const dir = queue.pop()!;
      const entries = await readDirEntries(dir);
      if (!entries) return [];
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) queue.push(abs);
        else if (entry.isFile()) out.push(await statListedFile(root, abs));
      }
    }
    return out;
  }

  async deleteFile(namespace: string, relpath: string): Promise<void> {
    const abs = this.resolvePath(namespace, relpath);
    try {
      await fsp.rm(abs, { force: true });
    } catch (err) {
      throw new StorageError('IO', `delete failed: ${(err as Error).message}`);
    }
  }

  async statFile(namespace: string, relpath: string): Promise<BlobFileMeta | null> {
    const abs = this.resolvePath(namespace, relpath);
    try {
      const stat = await fsp.stat(abs);
      if (!stat.isFile()) return null;
      return { path: normalizeRel(relpath), size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  }

  private resolvePath(namespace: string, relpath: string): string {
    if (!namespace || namespace.includes('/') || namespace.includes('\\') || namespace.includes('\0') || namespace.includes('..')) {
      throw new StorageError('TRAVERSAL', `invalid namespace ${namespace}`);
    }
    const normalized = normalizeRel(relpath);
    if (!normalized) throw new StorageError('TRAVERSAL', 'empty relpath');
    assertNoDotSegments(normalized, relpath);
    return path.join(this.root, namespace, ...normalized.split('/'));
  }
}

/**
 * An S3-compatible blob backend. Signs requests inline with AWS SigV4 (see `./aws-sigv4.js`)
 * using only `node:crypto` — no `@aws-sdk/*` dependency — targeting AWS S3 and any
 * S3-compatible endpoint (MinIO, Aliyun OSS, Tencent COS, Huawei OBS, ...).
 *
 * Five operations:
 *   readFile   → GET    /<key>
 *   writeFile  → PUT    /<key>          (with x-amz-content-sha256)
 *   deleteFile → DELETE /<key>
 *   statFile   → HEAD   /<key>
 *   listFiles  → GET    /?list-type=2&prefix=<namespace>/...
 *
 * Network is pluggable: pass `fetchFn` in the constructor (tests inject a stub; production
 * defaults to `globalThis.fetch`).
 */
export interface S3BlobStorageOptions {
  bucket: string;
  region: string;
  /** Optional path prefix inside the bucket. Lets multiple deployments share one bucket. */
  prefix?: string;
  /** S3-compatible endpoint URL (MinIO, Aliyun OSS, Tencent COS, Huawei OBS). Omit for AWS S3. */
  endpoint?: string;
  /** AWS access credentials. Callers typically resolve these from their own env/secret-manager convention. */
  credentials: SigV4Credentials;
  /** Pluggable fetch for tests. Defaults to `globalThis.fetch`. */
  fetchFn?: typeof fetch;
  /** Override for clock — tests pin signatures with this. Production leaves it undefined (`signSigV4` falls back to `new Date()`). */
  now?: () => Date;
}

export class S3BlobStorage implements BlobStorage {
  private readonly fetchFn: typeof fetch;
  constructor(public readonly options: S3BlobStorageOptions) {
    if (!options.bucket) throw new StorageError('IO', 'S3BlobStorage requires a bucket');
    if (!options.region) throw new StorageError('IO', 'S3BlobStorage requires a region');
    if (!options.credentials?.accessKeyId) throw new StorageError('IO', 'S3BlobStorage requires credentials.accessKeyId');
    if (!options.credentials?.secretAccessKey) throw new StorageError('IO', 'S3BlobStorage requires credentials.secretAccessKey');
    const fn = options.fetchFn ?? globalThis.fetch;
    if (!fn) throw new StorageError('IO', 'S3BlobStorage requires a fetch implementation');
    this.fetchFn = fn;
  }

  async readFile(namespace: string, relpath: string): Promise<Buffer> {
    const key = this.keyFor(namespace, relpath);
    const res = await this.signedRequest({ method: 'GET', key });
    if (res.status === 404) throw new StorageError('NOT_FOUND', `${namespace}/${relpath} not found`);
    if (!res.ok) throw new StorageError('IO', `S3 GET ${key} → ${res.status} ${res.statusText}: ${await safeText(res)}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async writeFile(namespace: string, relpath: string, body: Buffer): Promise<BlobFileMeta> {
    const key = this.keyFor(namespace, relpath);
    const res = await this.signedRequest({ method: 'PUT', key, body });
    if (!res.ok) throw new StorageError('IO', `S3 PUT ${key} → ${res.status} ${res.statusText}: ${await safeText(res)}`);
    return { path: normalizeRel(relpath), size: body.byteLength, mtimeMs: Date.now() };
  }

  async deleteFile(namespace: string, relpath: string): Promise<void> {
    const key = this.keyFor(namespace, relpath);
    const res = await this.signedRequest({ method: 'DELETE', key });
    // S3 returns 204 on successful delete; idempotent if missing.
    if (!res.ok && res.status !== 404) {
      throw new StorageError('IO', `S3 DELETE ${key} → ${res.status} ${res.statusText}: ${await safeText(res)}`);
    }
  }

  async statFile(namespace: string, relpath: string): Promise<BlobFileMeta | null> {
    const key = this.keyFor(namespace, relpath);
    const res = await this.signedRequest({ method: 'HEAD', key });
    if (res.status === 404) return null;
    if (!res.ok) throw new StorageError('IO', `S3 HEAD ${key} → ${res.status} ${res.statusText}`);
    const contentLength = Number(res.headers.get('content-length') ?? '0');
    const lastModified = res.headers.get('last-modified');
    return {
      path: normalizeRel(relpath),
      size: Number.isFinite(contentLength) ? contentLength : 0,
      mtimeMs: lastModified ? Date.parse(lastModified) : Date.now(),
    };
  }

  async listFiles(namespace: string): Promise<BlobFileMeta[]> {
    const namespacePrefix = this.keyFor(namespace, '');
    const out: BlobFileMeta[] = [];
    let continuationToken: string | undefined;
    // Cap iterations so a hostile bucket can't loop forever.
    for (let pages = 0; pages < 1000; pages++) {
      const query = listObjectsV2Query(namespacePrefix, continuationToken);
      const res = await this.signedRequest({ method: 'GET', key: '', extraQuery: query });
      if (!res.ok) {
        throw new StorageError('IO', `S3 LIST ${namespacePrefix} → ${res.status} ${res.statusText}: ${await safeText(res)}`);
      }
      const { entries, isTruncated, nextToken } = parseListBucketV2Xml(await res.text());
      out.push(...toNamespaceRelative(entries, namespacePrefix));
      if (!isTruncated || !nextToken) break;
      continuationToken = nextToken;
    }
    return out;
  }

  /** Builds the canonical S3 key the impl uses. Exposed for tests so the prefix/namespace/relpath join is stable. */
  keyFor(namespace: string, relpath: string): string {
    if (!namespace || namespace.includes('/') || namespace.includes('\\') || namespace.includes('..')) {
      throw new StorageError('TRAVERSAL', `invalid namespace ${namespace}`);
    }
    const normalized = relpath ? normalizeRel(relpath) : '';
    assertNoDotSegments(normalized, relpath);
    const segments = [this.options.prefix?.replace(/^\/+|\/+$/g, ''), namespace, normalized].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    return segments.join('/');
  }

  private endpointBase(): string {
    if (this.options.endpoint) return this.options.endpoint.replace(/\/+$/, '');
    return `https://${this.options.bucket}.s3.${this.options.region}.amazonaws.com`;
  }

  private async signedRequest(args: { method: string; key: string; body?: Buffer; extraQuery?: string }): Promise<Response> {
    const base = this.endpointBase();
    // Path-style for endpoint overrides (typical for S3-compat services + MinIO test setups);
    // virtual-host-style when endpoint is omitted (default AWS S3).
    const segments = args.key.split('/').filter(Boolean).map(encodeS3PathSegment);
    if (this.options.endpoint) segments.unshift(this.options.bucket);
    const pathSegment = '/' + segments.join('/');

    const headers: Record<string, string> = { host: new URL(base).host };
    const body = args.body ?? Buffer.alloc(0);
    const now = this.options.now ? this.options.now() : new Date();
    signSigV4({
      method: args.method,
      path: pathSegment,
      query: args.extraQuery ?? '',
      headers,
      body,
      region: this.options.region,
      service: 's3',
      credentials: this.options.credentials,
      now,
    });

    // `endpointBase()` already strips trailing slashes, so no second trim is needed here.
    const url = `${base}${pathSegment}${args.extraQuery ? `?${args.extraQuery}` : ''}`;
    const init: RequestInit = {
      method: args.method,
      headers,
      ...(args.body ? { body: args.body } : {}),
    };
    return this.fetchFn(url, init);
  }
}

/** Builds the ListObjectsV2 query string with keys sorted, as SigV4's canonical query requires. */
function listObjectsV2Query(prefix: string, continuationToken: string | undefined): string {
  const params: Array<[string, string]> = [
    ['list-type', '2'],
    ['prefix', prefix],
  ];
  if (continuationToken) params.push(['continuation-token', continuationToken]);
  params.sort((a, b) => a[0].localeCompare(b[0]));
  return params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/** Maps listed bucket keys to namespace-relative blob metadata, dropping the prefix marker itself. */
function toNamespaceRelative(entries: ListBucketEntry[], namespacePrefix: string): BlobFileMeta[] {
  // Strip the per-bucket namespacePrefix to surface namespace-relative paths.
  // `namespacePrefix` is `keyFor(namespace, '')`, which always includes at least the
  // (non-empty, `keyFor`-validated) namespace segment and never a trailing slash — so it's
  // always non-empty and the +1 separator always applies.
  const relStart = namespacePrefix.length + 1;
  const out: BlobFileMeta[] = [];
  for (const e of entries) {
    const rel = e.key.slice(relStart).replace(/^\/+/, '');
    if (!rel) continue; // skip the prefix marker itself
    out.push({ path: rel, size: e.size, mtimeMs: e.lastModifiedMs });
  }
  return out;
}

/** `readdir` with file types; `null` when the directory does not exist (ENOENT).
 * @throws {StorageError} `IO` for any other readdir failure.
 */
async function readDirEntries(dir: string): Promise<Dirent[] | null> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new StorageError('IO', `list failed: ${(err as Error).message}`);
  }
}

/** Stats a listed file and reports its path relative to `root` with forward slashes. */
async function statListedFile(root: string, abs: string): Promise<BlobFileMeta> {
  const stat = await fsp.stat(abs);
  const rel = path.relative(root, abs).split(path.sep).join('/');
  return { path: rel, size: stat.size, mtimeMs: stat.mtimeMs };
}

/** Refuses a normalized relpath containing a `.` or `..` segment.
 * @throws {StorageError} `TRAVERSAL`, naming the caller's original `relpath`.
 */
function assertNoDotSegments(normalized: string, relpath: string): void {
  if (normalized.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new StorageError('TRAVERSAL', `unsafe relpath ${relpath}`);
  }
}

interface ListBucketEntry {
  key: string;
  size: number;
  lastModifiedMs: number;
}

function parseListBucketV2Xml(xml: string): { entries: ListBucketEntry[]; isTruncated: boolean; nextToken?: string } {
  const entries: ListBucketEntry[] = [];
  // Lightweight XML scrape — accepts S3 / S3-compat shapes:
  //   <Contents><Key>...</Key><LastModified>2026-...</LastModified><Size>1234</Size></Contents>
  // and a single <NextContinuationToken>...</NextContinuationToken> and <IsTruncated>true|false</IsTruncated>.
  const contentsRe = /<Contents\b[^>]*>([\s\S]*?)<\/Contents>/g;
  let m: RegExpExecArray | null;
  while ((m = contentsRe.exec(xml)) !== null) {
    // `contentsRe`'s one capturing group is mandatory (not `(...)?`), so a successful `.exec()`
    // always populates it — TypeScript's `RegExpExecArray` types every group as possibly
    // `undefined` regardless, so this is a type-checker-only fallback with no real runtime path.
    const block = m[1]!;
    const key = pluckTag(block, 'Key');
    const size = Number(pluckTag(block, 'Size') ?? '0');
    const lastModifiedRaw = pluckTag(block, 'LastModified');
    if (!key) continue;
    entries.push({
      key,
      size: Number.isFinite(size) ? size : 0,
      lastModifiedMs: lastModifiedRaw ? Date.parse(lastModifiedRaw) : Date.now(),
    });
  }
  const isTruncated = (pluckTag(xml, 'IsTruncated') ?? 'false').toLowerCase() === 'true';
  const nextToken = pluckTag(xml, 'NextContinuationToken') ?? undefined;
  return nextToken ? { entries, isTruncated, nextToken } : { entries, isTruncated };
}

function pluckTag(text: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = re.exec(text);
  return m ? m[1] : undefined;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 256);
  } catch {
    return '';
  }
}

function normalizeRel(relpath: string): string {
  return String(relpath || '')
    .replace(/^[\\/]+/, '')
    .replace(/[\\]+/g, '/')
    .replace(/\/+/g, '/');
}
