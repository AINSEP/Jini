/**
 * Covers `attachments.ts` at three levels:
 *
 * - the pure helpers (`sanitizeAttachmentName`, `detectAttachmentKind`, `isUnchangedAttachment`,
 *   `writeBoundedAttachmentBody`) directly;
 * - `createDiskAttachmentStore` against a real temp filesystem, including the security properties
 *   that are the whole point of the store (opaque capability ids, forged renderer metadata being
 *   discarded, one-time claim, symlink retargeting, quota race safety);
 * - `registerAttachmentRoutes` over a real `express()` app on `app.listen(0)` driven by real
 *   `fetch`, which is what proves the status-code mapping and the concurrency limiter as a caller
 *   actually experiences them.
 *
 * Ported from `examples/reference-web`'s `playground-attachment-registry.test.ts` (5 cases) and the
 * "playground upload boundaries" cases in its `playground-request.test.ts` (2 cases) when that
 * host-local implementation was generalized into this package.
 */
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment } from '@jini-ai/chat/core';
import {
  ATTACHMENTS_ROUTE_PATH,
  AttachmentRejectedError,
  createDiskAttachmentStore,
  detectAttachmentKind,
  isUnchangedAttachment,
  registerAttachmentRoutes,
  sanitizeAttachmentName,
  writeBoundedAttachmentBody,
  type AttachmentsHttpDeps,
  type AttachmentStore,
  type CreateDiskAttachmentStoreOptions,
  type StoredAttachment,
} from '../attachments.js';

// ---------------------------------------------------------------------------
// The mirrored wire type must stay assignable to `@jini-ai/chat/core`'s `ChatAttachment`
// ---------------------------------------------------------------------------

/**
 * `StoredAttachment` deliberately mirrors `ChatAttachment` rather than importing it, so that this
 * transport package does not depend on the `chat` domain package (see `attachments.ts`'s own note).
 * These two assignments are the price of that choice: a field added, removed, renamed, or retyped on
 * either side stops this file compiling, which is exactly the drift the mirror risks.
 */
const _storedIsChatAttachment: ChatAttachment = {
  path: 'attachment:1',
  name: 'a.png',
  kind: 'image',
  size: 1,
  order: 0,
} satisfies StoredAttachment;
const _chatIsStoredAttachment: StoredAttachment = _storedIsChatAttachment;
void _chatIsStoredAttachment;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
  vi.restoreAllMocks();
});

async function tempDirectory(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'jini-attachments-'));
  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function diskStore(
  options: Omit<CreateDiskAttachmentStoreOptions, 'uploadDirectory'> = {},
): Promise<{ root: string; store: AttachmentStore }> {
  const root = await tempDirectory();
  const store = await createDiskAttachmentStore({ uploadDirectory: root, ...options });
  cleanups.push(() => store.dispose());
  return { root, store };
}

/** Writes a file into a batch directory and registers it, the way the upload route does. */
async function stage(
  store: AttachmentStore,
  batchId: string,
  fileName: string,
  contents: string | Buffer,
): Promise<{ attachment: StoredAttachment; filePath: string; batchDirectory: string }> {
  const batchDirectory = await store.createBatchDirectory(batchId);
  const filePath = resolve(batchDirectory, fileName);
  await writeFile(filePath, contents, { mode: 0o600 });
  const attachment = await store.register({
    batchId,
    path: filePath,
    name: fileName,
    kind: 'file',
    size: Buffer.byteLength(contents as string),
  });
  return { attachment, filePath, batchDirectory };
}

interface Harness {
  readonly url: string;
  readonly deps: AttachmentsHttpDeps;
}

async function harness(
  overrides: Partial<AttachmentsHttpDeps> & {
    store?: AttachmentStore;
    /**
     * Leaves `onInternalError` genuinely absent rather than set to `undefined` — under
     * `exactOptionalPropertyTypes` those are different, and only absence selects the default sink.
     */
    useDefaultErrorSink?: boolean;
  } = {},
): Promise<Harness & { store: AttachmentStore }> {
  const { useDefaultErrorSink, ...depOverrides } = overrides;
  const store = overrides.store ?? (await diskStore()).store;
  const deps: AttachmentsHttpDeps = {
    store,
    // Off by default here: `isLocalSameOrigin` is exercised by its own test below, and every other
    // case in this file is about upload/cleanup behavior rather than the CSRF guard.
    requireSameOrigin: false,
    ...(useDefaultErrorSink === true ? {} : { onInternalError: vi.fn() }),
    ...depOverrides,
  };
  const app = express();
  // Mounted app-wide, before the route pack, exactly as a real host does (`compose-jini-kernel.ts`
  // does this for every daemon). `DELETE` needs it, and having it present is also what makes the
  // "body already drained" case below a genuine reproduction rather than a contrived one.
  app.use(express.json());
  const adapter = { resolvedPortRef: { current: 0 } };
  registerAttachmentRoutes(app, deps, adapter);
  const server: Server = app.listen(0);
  await new Promise((ready) => server.once('listening', ready));
  const { port } = server.address() as { port: number };
  adapter.resolvedPortRef.current = port;
  cleanups.push(
    () => new Promise<void>((closed) => {
      server.close(() => closed());
    }),
  );
  return { url: `http://127.0.0.1:${port}${ATTACHMENTS_ROUTE_PATH}`, deps, store };
}

async function upload(
  url: string,
  init: { batch?: string; name?: string; body?: string | Uint8Array; contentType?: string },
): Promise<Response> {
  const query = new URLSearchParams();
  if (init.batch !== undefined) query.set('batch', init.batch);
  if (init.name !== undefined) query.set('name', init.name);
  return fetch(`${url}?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': init.contentType ?? 'application/octet-stream' },
    body: init.body ?? 'contents',
  });
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------------------
// sanitizeAttachmentName
// ---------------------------------------------------------------------------

describe('sanitizeAttachmentName', () => {
  it('strips path components and control characters and falls back for unusable input', () => {
    expect(sanitizeAttachmentName('../../evil\nname?.png')).toBe('evil_name_.png');
    expect(sanitizeAttachmentName('???')).toBe('___');
    expect(sanitizeAttachmentName(null)).toBe('attachment');
    expect(sanitizeAttachmentName('')).toBe('attachment');
    // A name that sanitizes to nothing at all must still yield a usable basename.
    expect(sanitizeAttachmentName('/')).toBe('attachment');
  });
});

// ---------------------------------------------------------------------------
// detectAttachmentKind
// ---------------------------------------------------------------------------

describe('detectAttachmentKind', () => {
  it('recognizes each image signature from its leading bytes', () => {
    expect(detectAttachmentKind(PNG)).toBe('image');
    expect(detectAttachmentKind(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe('image');
    expect(detectAttachmentKind(new TextEncoder().encode('GIF87a'))).toBe('image');
    expect(detectAttachmentKind(new TextEncoder().encode('GIF89a'))).toBe('image');
    expect(detectAttachmentKind(new TextEncoder().encode('RIFF0000WEBP'))).toBe('image');
  });

  it('treats anything whose signature does not match as a plain file', () => {
    expect(detectAttachmentKind(new TextEncoder().encode('plain text'))).toBe('file');
    expect(detectAttachmentKind(new Uint8Array())).toBe('file');
  });

  it('rejects a signature that matches an image prefix but then diverges', () => {
    // Each case below makes exactly one byte of one signature wrong, so a comparison being dropped
    // from any of the four checks shows up here rather than passing by accident.
    const png = (...bytes: number[]) => Uint8Array.from([...bytes, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectAttachmentKind(png(0x00, 0x50, 0x4e, 0x47))).toBe('file');
    expect(detectAttachmentKind(png(0x89, 0x00, 0x4e, 0x47))).toBe('file');
    expect(detectAttachmentKind(png(0x89, 0x50, 0x00, 0x47))).toBe('file');
    expect(detectAttachmentKind(png(0x89, 0x50, 0x4e, 0x00))).toBe('file');
    expect(detectAttachmentKind(Uint8Array.from([0xff]))).toBe('file');
    expect(detectAttachmentKind(Uint8Array.from([0xff, 0x00, 0xff]))).toBe('file');
    expect(detectAttachmentKind(Uint8Array.from([0xff, 0xd8, 0x00]))).toBe('file');
    expect(detectAttachmentKind(new TextEncoder().encode('RIFF0000XXXX'))).toBe('file');
    expect(detectAttachmentKind(new TextEncoder().encode('XXXX0000WEBP'))).toBe('file');
  });
});

// ---------------------------------------------------------------------------
// isUnchangedAttachment
// ---------------------------------------------------------------------------

describe('isUnchangedAttachment', () => {
  const recorded = { filePath: '/uploads/batch/a.bin', dev: 1, ino: 2, size: 3 };
  const observed = { isRegularFile: true, dev: 1, ino: 2, size: 3, canonicalPath: recorded.filePath };

  it('accepts a file whose identity is unchanged since registration', () => {
    expect(isUnchangedAttachment(recorded, observed)).toBe(true);
  });

  it('rejects every single-field divergence, including one no real filesystem test can stage', () => {
    expect(isUnchangedAttachment(recorded, { ...observed, isRegularFile: false })).toBe(false);
    expect(isUnchangedAttachment(recorded, { ...observed, canonicalPath: '/elsewhere/a.bin' })).toBe(false);
    // A path that keeps its name but lands on a different device — only reachable here.
    expect(isUnchangedAttachment(recorded, { ...observed, dev: 99 })).toBe(false);
    expect(isUnchangedAttachment(recorded, { ...observed, ino: 99 })).toBe(false);
    expect(isUnchangedAttachment(recorded, { ...observed, size: 99 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// writeBoundedAttachmentBody
// ---------------------------------------------------------------------------

describe('writeBoundedAttachmentBody', () => {
  it('streams Buffer and string chunks to a private file and returns the leading signature', async () => {
    const directory = await tempDirectory();
    const filePath = resolve(directory, 'valid.bin');
    async function* body(): AsyncGenerator<unknown> {
      yield Buffer.from('ab');
      yield 'cd';
    }

    await expect(writeBoundedAttachmentBody({ request: body(), filePath, maxBytes: 4 }))
      .resolves.toEqual({ size: 4, signature: Buffer.from('abcd') });
    expect(await readFile(filePath, 'utf8')).toBe('abcd');
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it('stops collecting signature bytes once twelve are buffered', async () => {
    const directory = await tempDirectory();
    const filePath = resolve(directory, 'long.bin');
    async function* body(): AsyncGenerator<unknown> {
      // Deliberately more than twelve bytes across several chunks: the signature must be the first
      // twelve and nothing more, however the stream happens to be framed.
      yield Buffer.from('RIFF0000');
      yield Buffer.from('WEBP');
      yield Buffer.from('trailing payload that must not be buffered');
    }

    const result = await writeBoundedAttachmentBody({ request: body(), filePath, maxBytes: 1024 });
    expect(Buffer.from(result.signature).toString()).toBe('RIFF0000WEBP');
    expect(result.size).toBe(54);
  });

  it('removes the partial file when the byte cap trips mid-stream', async () => {
    const directory = await tempDirectory();
    const filePath = resolve(directory, 'oversized.bin');
    async function* body(): AsyncGenerator<unknown> {
      yield Buffer.from('12345');
    }

    await expect(writeBoundedAttachmentBody({ request: body(), filePath, maxBytes: 4 }))
      .rejects.toThrow('Each attachment must be 4 bytes or smaller');
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports the cap in megabytes when it is a whole number of them', async () => {
    const directory = await tempDirectory();
    async function* body(): AsyncGenerator<unknown> {
      yield Buffer.alloc(1024 * 1024 + 1);
    }

    await expect(writeBoundedAttachmentBody({
      request: body(),
      filePath: resolve(directory, 'mb.bin'),
      maxBytes: 1024 * 1024,
    })).rejects.toThrow('Each attachment must be 1 MB or smaller');
  });

  it('propagates a post-stream failure after the handle is already closed', async () => {
    const directory = await tempDirectory();
    const filePath = resolve(directory, 'vanishes.bin');
    // Deletes the file it just wrote, so the `chmod` after a *successful* close fails. This is the
    // one error path reached with the handle already closed, and it must still clean up and rethrow.
    async function* body(): AsyncGenerator<unknown> {
      yield Buffer.from('gone');
      await rm(filePath, { force: true });
    }

    await expect(writeBoundedAttachmentBody({ request: body(), filePath, maxBytes: 64 }))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to overwrite an existing file at the target path', async () => {
    const directory = await tempDirectory();
    const filePath = resolve(directory, 'taken.bin');
    await writeFile(filePath, 'original');
    async function* body(): AsyncGenerator<unknown> {
      yield Buffer.from('replacement');
    }

    await expect(writeBoundedAttachmentBody({ request: body(), filePath, maxBytes: 64 }))
      .rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(filePath, 'utf8')).toBe('original');
  });
});

// ---------------------------------------------------------------------------
// createDiskAttachmentStore
// ---------------------------------------------------------------------------

describe('createDiskAttachmentStore', () => {
  it('returns opaque capabilities and replaces forged renderer metadata on a one-time claim', async () => {
    const { root, store } = await diskStore();
    const batchDirectory = await store.createBatchDirectory('batch-0001');
    const filePath = resolve(batchDirectory, 'image.png');
    await writeFile(filePath, PNG.subarray(0, 4), { mode: 0o600 });
    const attachment = await store.register({
      batchId: 'batch-0001',
      path: filePath,
      name: 'image.png',
      kind: 'image',
      size: 4,
    });

    expect(attachment.path).toMatch(/^attachment:[a-f0-9-]{36}$/u);
    expect(attachment.path).not.toContain(root);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(batchDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);

    const claim = await store.claim(
      [{ ...attachment, name: 'forged.txt', kind: 'file', size: 999 }],
      'run-1',
    );
    expect(claim).toEqual({
      attachments: [{ path: filePath, name: 'image.png', kind: 'image', size: 4 }],
      batchDirectory,
    });
    await expect(store.claim([attachment], 'run-2')).rejects.toThrow('unknown or already claimed');
    await store.cleanupRun('run-1');
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('empties an upload directory it inherits, because those files cannot be authenticated', async () => {
    const root = await tempDirectory();
    const orphanFile = resolve(root, 'orphan.bin');
    const orphanDirectory = resolve(root, 'batch-orphaned');
    await writeFile(orphanFile, 'left by a previous process');
    await mkdir(orphanDirectory);
    await writeFile(resolve(orphanDirectory, 'inside.bin'), 'also orphaned');

    const store = await createDiskAttachmentStore({ uploadDirectory: root });
    cleanups.push(() => store.dispose());

    await expect(stat(orphanFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(orphanDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns an empty claim without a batch directory when nothing was attached', async () => {
    const { store } = await diskStore();
    await expect(store.claim([], 'run-empty')).resolves.toEqual({ attachments: [] });
  });

  it('rejects a batch id that is not of the accepted shape', async () => {
    const { store } = await diskStore();
    for (const batchId of ['', 'short', '../escape', 'has/slash', 'has.dot', 'x'.repeat(81)]) {
      await expect(store.createBatchDirectory(batchId))
        .rejects.toThrow(new AttachmentRejectedError('invalid-batch', 'Invalid attachment batch'));
    }
    await expect(store.createBatchDirectory('valid-batch-id')).resolves.toContain('valid-batch-id');
  });

  it('rejects a file outside its batch directory, and one merely nested inside it', async () => {
    const { root, store } = await diskStore();
    const batchDirectory = await store.createBatchDirectory('batch-0007');
    const outside = resolve(root, 'outside-preserved.txt');
    await writeFile(outside, 'preserve me', { mode: 0o600 });

    await expect(store.register({
      batchId: 'batch-0007',
      path: outside,
      name: 'outside-preserved.txt',
      kind: 'file',
      size: 11,
    })).rejects.toThrow('outside its batch');
    // Load-bearing, not incidental tidiness: the containment guard sits outside the `try` whose
    // `catch` unlinks the path. If it ever moved inside, this public port would become an
    // arbitrary-file-delete primitive for anything the daemon can unlink, and this assertion is
    // what fails.
    await expect(stat(outside)).resolves.toBeDefined();

    // Nested one level deeper is also refused: `extraAllowedDirs` grants exactly the batch
    // directory, so a file the agent could not reach must not be registered as if it could.
    const nestedDirectory = resolve(batchDirectory, 'nested');
    await mkdir(nestedDirectory);
    const nested = resolve(nestedDirectory, 'deep.txt');
    await writeFile(nested, 'deep', { mode: 0o600 });
    await expect(store.register({
      batchId: 'batch-0007',
      path: nested,
      name: 'deep.txt',
      kind: 'file',
      size: 4,
    })).rejects.toThrow('outside its batch');
  });

  it('refuses a traversal path whose unnormalized parent looks like the batch directory', async () => {
    const { root, store } = await diskStore();
    const batchDirectory = await store.createBatchDirectory('batch-0027');
    const sibling = resolve(root, 'sibling.txt');
    await writeFile(sibling, 'not yours', { mode: 0o600 });

    // `dirname('<batchDir>/..') === '<batchDir>'` is TRUE as raw string algebra — this is the exact
    // shape that makes parent-directory equality insufficient on its own. It is safe only because
    // `register` calls `resolve(input.path)` first, which normalizes the `..` away. If that
    // normalization is ever removed, these three cases start being accepted.
    for (const traversal of [
      `${batchDirectory}/..`,
      `${batchDirectory}/../sibling.txt`,
      `${batchDirectory}/./../sibling.txt`,
    ]) {
      await expect(store.register({
        batchId: 'batch-0027',
        path: traversal,
        name: 'sibling.txt',
        kind: 'file',
        size: 9,
      })).rejects.toThrow('outside its batch');
    }
    // And nothing outside the batch was unlinked on the way out.
    await expect(stat(sibling)).resolves.toBeDefined();
  });

  it('refuses a relative path, which cannot be inside any batch once resolved', async () => {
    const { store } = await diskStore();
    await store.createBatchDirectory('batch-0028');

    // Resolved against the process cwd, never the batch directory.
    await expect(store.register({
      batchId: 'batch-0028',
      path: 'good.png',
      name: 'good.png',
      kind: 'file',
      size: 1,
    })).rejects.toThrow('outside its batch');
  });

  it('refuses a symlink and a directory standing in for an uploaded file', async () => {
    const { root, store } = await diskStore();
    const batchDirectory = await store.createBatchDirectory('batch-0008');
    const target = resolve(root, 'secret.txt');
    await writeFile(target, 'secret');
    const link = resolve(batchDirectory, 'link.txt');
    await symlink(target, link);

    await expect(store.register({
      batchId: 'batch-0008',
      path: link,
      name: 'link.txt',
      kind: 'file',
      size: 6,
    })).rejects.toThrow('not a regular file');
    // The refused symlink is removed; its target is untouched.
    await expect(lstat(link)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(target, 'utf8')).toBe('secret');

    // Recreated: refusing the symlink above left the batch directory empty, and the store tidies an
    // empty batch away as part of that refusal.
    await store.createBatchDirectory('batch-0008');
    // A directory at the upload path also fails, and the real reason must survive: cleaning up a
    // directory with a non-recursive `rm` throws EISDIR, which must not replace the rejection.
    const directoryPath = resolve(batchDirectory, 'a-directory');
    await mkdir(directoryPath);
    await expect(store.register({
      batchId: 'batch-0008',
      path: directoryPath,
      name: 'a-directory',
      kind: 'file',
      size: 0,
    })).rejects.toThrow('not a regular file');
  });

  it('refuses a file reached through a symlinked batch directory', async () => {
    const { root, store } = await diskStore();
    const batchDirectory = await store.createBatchDirectory('batch-0009');
    const elsewhere = resolve(root, 'elsewhere');
    await mkdir(elsewhere);
    const realFile = resolve(elsewhere, 'planted.txt');
    await writeFile(realFile, 'planted', { mode: 0o600 });
    // Swap the batch directory itself for a symlink: `lstat` on the file still reports a regular
    // file, so only the canonical-path comparison catches this.
    await rmdir(batchDirectory);
    await symlink(elsewhere, batchDirectory);

    await expect(store.register({
      batchId: 'batch-0009',
      path: resolve(batchDirectory, 'planted.txt'),
      name: 'planted.txt',
      kind: 'file',
      size: 7,
    })).rejects.toThrow('not canonical');
  });

  it('rejects a file retargeted to a symlink after registration', async () => {
    const { root, store } = await diskStore();
    const { attachment, filePath } = await stage(store, 'batch-0002', 'upload.txt', 'inside');
    const outside = resolve(root, 'outside.txt');
    await writeFile(outside, 'outside');
    await rm(filePath);
    await symlink(outside, filePath);

    await expect(store.claim([attachment], 'run-symlink')).rejects.toThrow('changed after upload');
    expect((await lstat(filePath)).isSymbolicLink()).toBe(true);
  });

  it('rejects a file replaced by a different file of the same size after registration', async () => {
    const { store } = await diskStore();
    const { attachment, filePath } = await stage(store, 'batch-0010', 'swap.txt', 'aaaaaa');
    // Same path, same byte count, different inode — the identity check has to notice.
    await rm(filePath);
    await writeFile(filePath, 'bbbbbb', { mode: 0o600 });

    await expect(store.claim([attachment], 'run-swapped')).rejects.toThrow('changed after upload');
  });

  // The exactly-once claim guarantee is what stops two runs being handed the same real path on
  // disk. `claim` checks `claimedRunId`, then awaits `lstat` + `realpath`, and only writes
  // `claimedRunId` after — so two claims that interleave at those awaits both observe "unclaimed".
  // Node's single thread does not save this: `await` is precisely where the second call gets in.
  it('fulfils only one of two concurrent claims for the same attachment', async () => {
    const { store } = await diskStore();
    const { attachment } = await stage(store, 'batch-0100', 'contended.txt', 'payload');

    const settled = await Promise.allSettled([
      store.claim([attachment], 'run-A'),
      store.claim([attachment], 'run-B'),
    ]);

    const fulfilled = settled.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = settled.filter((outcome) => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AttachmentRejectedError);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/unknown or already claimed/);
  });

  // The losing claim must not take the winner's attachment down with it: a partially-validated
  // batch that rolls back has to release exactly what it reserved and nothing else.
  it('leaves a rejected claim with nothing reserved, so a corrected retry still succeeds', async () => {
    const { store } = await diskStore();
    const { attachment: first } = await stage(store, 'batch-0101', 'one.txt', 'aaa');
    const { attachment: second } = await stage(store, 'batch-0102', 'two.txt', 'bbb');

    // Mixed batches are rejected — but only after `first` has already been walked and reserved.
    await expect(store.claim([first, second], 'run-mixed')).rejects.toThrow(/one batch/);

    // If the failed claim leaked a reservation, this retry would wrongly report "already claimed".
    const retried = await store.claim([first], 'run-retry');
    expect(retried.attachments).toHaveLength(1);
    expect(retried.attachments[0]!.name).toBe('one.txt');
  });

  it('rejects a file appended to after registration', async () => {
    const { store } = await diskStore();
    const { attachment, filePath } = await stage(store, 'batch-0011', 'grow.txt', 'short');
    // Same inode, larger — a smuggled payload growing a file the agent was already cleared to read.
    await appendFile(filePath, ' and more');

    await expect(store.claim([attachment], 'run-grown')).rejects.toThrow('changed after upload');
  });

  it('refuses a claim naming the same capability twice', async () => {
    const { store } = await diskStore();
    const { attachment } = await stage(store, 'batch-0012', 'once.txt', 'once');

    await expect(store.claim([attachment, attachment], 'run-dupe'))
      .rejects.toThrow('Duplicate attachment');
  });

  it('refuses a claim larger than one batch may hold', async () => {
    const { store } = await diskStore({ maxAttachments: 1 });
    const { attachment } = await stage(store, 'batch-0013', 'one.txt', 'one');

    await expect(store.claim(
      [attachment, { ...attachment, path: 'attachment:other' }],
      'run-too-many',
    )).rejects.toThrow('Too many attachments');
  });

  it('refuses a claim spanning two batches, so one granted directory stays sufficient', async () => {
    const { store } = await diskStore();
    const first = await stage(store, 'batch-0014', 'a.txt', 'a');
    const second = await stage(store, 'batch-0015', 'b.txt', 'b');

    await expect(store.claim([first.attachment, second.attachment], 'run-mixed'))
      .rejects.toThrow('must belong to one batch');
    // Neither was marked, so a corrected claim still works.
    await expect(store.claim([first.attachment], 'run-retry')).resolves.toMatchObject({
      batchDirectory: first.batchDirectory,
    });
  });

  it('serializes concurrent quota reservations and deletes the rejected file', async () => {
    const { store } = await diskStore({ maxAttachments: 1 });
    const batchDirectory = await store.createBatchDirectory('batch-0003');
    const firstPath = resolve(batchDirectory, 'first.txt');
    const secondPath = resolve(batchDirectory, 'second.txt');
    await Promise.all([
      writeFile(firstPath, 'first', { mode: 0o600 }),
      writeFile(secondPath, 'second', { mode: 0o600 }),
    ]);

    const results = await Promise.allSettled([
      store.register({ batchId: 'batch-0003', path: firstPath, name: 'first.txt', kind: 'file', size: 5 }),
      store.register({ batchId: 'batch-0003', path: secondPath, name: 'second.txt', kind: 'file', size: 6 }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const remaining = await Promise.allSettled([stat(firstPath), stat(secondPath)]);
    expect(remaining.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('enforces the per-batch byte quota', async () => {
    const { store } = await diskStore({ maxBatchBytes: 8 });
    await stage(store, 'batch-0016', 'five.txt', 'fives');
    const batchDirectory = await store.createBatchDirectory('batch-0016');
    const overflowPath = resolve(batchDirectory, 'overflow.txt');
    await writeFile(overflowPath, 'overflow', { mode: 0o600 });

    await expect(store.register({
      batchId: 'batch-0016',
      path: overflowPath,
      name: 'overflow.txt',
      kind: 'file',
      size: 8,
    })).rejects.toThrow('must total 8 bytes or less');
    await expect(stat(overflowPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('enforces the store-wide file-count and byte quotas independently', async () => {
    const byCount = await diskStore({ maxStoredAttachments: 1 });
    await stage(byCount.store, 'batch-0004', 'one.txt', 'one');
    const twoDirectory = await byCount.store.createBatchDirectory('batch-0005');
    const twoPath = resolve(twoDirectory, 'two.txt');
    await writeFile(twoPath, 'two', { mode: 0o600 });
    await expect(byCount.store.register({
      batchId: 'batch-0005',
      path: twoPath,
      name: 'two.txt',
      kind: 'file',
      size: 3,
    })).rejects.toThrow('storage is full');
    await expect(stat(twoPath)).rejects.toMatchObject({ code: 'ENOENT' });

    // Same refusal by total bytes rather than by file count, with the count limit far away.
    const byBytes = await diskStore({ maxStoredBytes: 4 });
    await stage(byBytes.store, 'batch-0017', 'tiny.txt', 'abc');
    const nextDirectory = await byBytes.store.createBatchDirectory('batch-0018');
    const nextPath = resolve(nextDirectory, 'next.txt');
    await writeFile(nextPath, 'def', { mode: 0o600 });
    await expect(byBytes.store.register({
      batchId: 'batch-0018',
      path: nextPath,
      name: 'next.txt',
      kind: 'file',
      size: 3,
    })).rejects.toThrow('storage is full');
  });

  it('prunes expired unclaimed uploads and leaves claimed ones alone', async () => {
    const { store } = await diskStore({ retentionMs: 0 });
    const unclaimed = await stage(store, 'batch-0006', 'old.txt', 'old');
    const claimed = await stage(store, 'batch-0019', 'kept.txt', 'kept');
    await store.claim([claimed.attachment], 'run-keeps');

    await store.pruneExpired(Date.now() + 1);
    await expect(stat(unclaimed.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    // A run is still using this one; retention must not race the run.
    await expect(stat(claimed.filePath)).resolves.toBeDefined();
  });

  it('keeps an unclaimed upload that has not yet reached its retention window', async () => {
    const { store } = await diskStore({ retentionMs: 60_000 });
    const { filePath } = await stage(store, 'batch-0020', 'fresh.txt', 'fresh');

    await store.pruneExpired();
    await expect(stat(filePath)).resolves.toBeDefined();
  });

  it('deletes only the named unclaimed uploads, never a claimed one', async () => {
    const { store } = await diskStore();
    const first = await stage(store, 'batch-0021', 'a.txt', 'a');
    const batchDirectory = await store.createBatchDirectory('batch-0021');
    const secondPath = resolve(batchDirectory, 'b.txt');
    await writeFile(secondPath, 'b', { mode: 0o600 });
    const second = await store.register({
      batchId: 'batch-0021',
      path: secondPath,
      name: 'b.txt',
      kind: 'file',
      size: 1,
    });
    await store.claim([second], 'run-holds');

    await store.deleteUnclaimed('batch-0021', [
      first.attachment.path,
      second.path,
      'attachment:never-registered',
      // A capability from another batch must not be deletable through this batch.
      first.attachment.path,
    ]);
    await expect(stat(first.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(secondPath)).resolves.toBeDefined();
  });

  it('ignores a capability id belonging to a different batch', async () => {
    const { store } = await diskStore();
    const other = await stage(store, 'batch-0022', 'other.txt', 'other');
    await store.createBatchDirectory('batch-0023');

    await store.deleteUnclaimed('batch-0023', [other.attachment.path]);
    await expect(stat(other.filePath)).resolves.toBeDefined();
  });

  it('cleans up nothing for a run that claimed nothing', async () => {
    const { store } = await diskStore();
    const { filePath } = await stage(store, 'batch-0024', 'kept.txt', 'kept');

    await store.cleanupRun('run-that-never-claimed');
    await expect(stat(filePath)).resolves.toBeDefined();
  });

  it('deletes every tracked upload on dispose', async () => {
    const { store } = await diskStore();
    const first = await stage(store, 'batch-0025', 'a.txt', 'a');
    const second = await stage(store, 'batch-0026', 'b.txt', 'b');
    await store.claim([second.attachment], 'run-disposed');

    await store.dispose();
    await expect(stat(first.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(second.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

// ---------------------------------------------------------------------------
// registerAttachmentRoutes — real express app, real fetch
// ---------------------------------------------------------------------------

describe('POST /api/attachments', () => {
  it('stores an upload and returns its opaque capability with server-derived metadata', async () => {
    const { url } = await harness();

    const response = await upload(url, {
      batch: 'batch-upload-1',
      name: '../../evil name?.png',
      body: PNG,
      // A renderer-supplied MIME saying "text" must not decide the kind — the bytes do.
      contentType: 'text/plain',
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { attachment: StoredAttachment };
    expect(body.attachment).toEqual({
      path: expect.stringMatching(/^attachment:[a-f0-9-]{36}$/u),
      name: 'evil name_.png',
      kind: 'image',
      size: PNG.byteLength,
    });
  });

  it('rejects a zero-byte upload', async () => {
    const { url } = await harness();

    const response = await upload(url, { batch: 'batch-upload-2', name: 'empty.txt', body: '' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: 'Attachment is empty' } });
  });

  it('rejects an unusable batch id with 400 and no internal-error report', async () => {
    const { url, deps } = await harness();

    const response = await upload(url, { batch: 'bad', name: 'a.txt' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: 'Invalid attachment batch' } });
    expect(deps.onInternalError).not.toHaveBeenCalled();
  });

  it('rejects an upload past the per-request byte cap with 413 and its real message', async () => {
    const { url } = await harness({ maxAttachmentBytes: 4 });

    const response = await upload(url, {
      batch: 'batch-upload-3',
      name: 'big.bin',
      body: 'far too many bytes',
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Each attachment must be 4 bytes or smaller' },
    });
  });

  it('rejects an upload past a store quota with 413 and its real message', async () => {
    const { store } = await diskStore({ maxAttachments: 1 });
    const { url } = await harness({ store });
    await upload(url, { batch: 'batch-upload-4', name: 'first.txt' });

    const response = await upload(url, { batch: 'batch-upload-4', name: 'second.txt' });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { message: 'You can attach at most 1 files to one message' },
    });
  });

  it('rate-limits beyond maxConcurrentUploads without touching the store', async () => {
    // A store whose `pruneExpired` blocks until released holds the first upload in flight, so the
    // second genuinely overlaps it rather than relying on timing.
    let releaseFirst: () => void = () => undefined;
    const firstInFlight = new Promise<void>((resolve_) => {
      releaseFirst = resolve_;
    });
    let seen = 0;
    const { store: real } = await diskStore();
    const store: AttachmentStore = {
      ...real,
      pruneExpired: async () => {
        seen += 1;
        if (seen === 1) await firstInFlight;
      },
    };
    const { url } = await harness({ store, maxConcurrentUploads: 1 });

    const first = upload(url, { batch: 'batch-upload-5', name: 'slow.txt' });
    // Give the first request time to be accepted and reach the blocked `pruneExpired`.
    await vi.waitFor(() => expect(seen).toBe(1));
    const limited = await upload(url, { batch: 'batch-upload-5', name: 'rejected.txt' });

    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', message: 'Too many attachment uploads are in progress' },
    });
    // The limiter answered without ever consulting the store.
    expect(seen).toBe(1);
    releaseFirst();
    expect((await first).status).toBe(201);

    // The slot is released once the first upload finishes, so the next request is served.
    const afterRelease = await upload(url, { batch: 'batch-upload-5', name: 'later.txt' });
    expect(afterRelease.status).toBe(201);
  });

  it('redacts an unexpected store failure behind a correlation id', async () => {
    const { store: real } = await diskStore();
    const onInternalError = vi.fn();
    const store: AttachmentStore = {
      ...real,
      register: async () => {
        throw new Error('ENOENT: /Users/someone/secret/uploads/batch/file.bin');
      },
    };
    const { url } = await harness({ store, onInternalError });

    const response = await upload(url, { batch: 'batch-upload-6', name: 'a.txt' });

    expect(response.status).toBe(500);
    const body = await response.json() as { error: { message: string; requestId?: string } };
    expect(body.error.message).toBe('an internal error occurred');
    expect(body.error.message).not.toContain('secret');
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({
      source: 'attachment-upload',
      batchId: 'batch-upload-6',
      correlationId: body.error.requestId,
    }));
  });

  it('redacts an integrity failure rather than confirming what the path looked like', async () => {
    const { store: real } = await diskStore();
    const onInternalError = vi.fn();
    const store: AttachmentStore = {
      ...real,
      register: async () => {
        throw new AttachmentRejectedError('attachment-integrity', 'Attachment path is not canonical');
      },
    };
    const { url } = await harness({ store, onInternalError });

    const response = await upload(url, { batch: 'batch-upload-7', name: 'a.txt' });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { message: 'an internal error occurred' } });
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });

  it('reports a body already drained by an upstream parser instead of calling it empty', async () => {
    const onInternalError = vi.fn();
    // The exact real-world shape of this: the harness's app-wide JSON body parser, and a user
    // dropping a `.json` file, whose browser-assigned content type that parser then claims.
    const { url } = await harness({ onInternalError });

    const response = await upload(url, {
      batch: 'batch-upload-8',
      name: 'data.json',
      body: JSON.stringify({ real: 'content' }),
      contentType: 'application/json',
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { message: 'an internal error occurred' } });
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ reason: 'attachment-body-consumed' }),
    }));
  });

  it('leaves a raw upload untouched when a JSON parser is mounted but does not claim it', async () => {
    const { url } = await harness();

    const response = await upload(url, {
      batch: 'batch-upload-9',
      name: 'a.bin',
      body: 'raw bytes',
      contentType: 'application/octet-stream',
    });

    expect(response.status).toBe(201);
    expect((await response.json() as { attachment: StoredAttachment }).attachment.size).toBe(9);
  });

  it('defaults an omitted filename to a safe placeholder', async () => {
    const { url } = await harness();

    const response = await upload(url, { batch: 'batch-upload-10', body: 'no name given' });

    expect(response.status).toBe(201);
    expect((await response.json() as { attachment: StoredAttachment }).attachment.name)
      .toBe('attachment');
  });

  it('falls back to an empty batch id when the query parameter is repeated', async () => {
    const { url } = await harness();

    // Two `batch` values arrive as an array, which is not a batch id — it must fail closed rather
    // than silently picking one.
    const response = await fetch(`${url}?batch=batch-aaaa1&batch=batch-aaaa2&name=a.txt`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: 'x',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: 'Invalid attachment batch' } });
  });
});

describe('DELETE /api/attachments', () => {
  it('deletes the named unclaimed uploads and answers 204 with no body', async () => {
    const { url, store } = await harness();
    const staged = await stage(store, 'batch-delete-1', 'a.txt', 'a');

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ batchId: 'batch-delete-1', paths: [staged.attachment.path] }),
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    await expect(stat(staged.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a malformed cleanup request', async () => {
    const { url } = await harness();
    const bodies = [
      undefined,
      { paths: [] },
      { batchId: 'batch-delete-2' },
      { batchId: 'batch-delete-2', paths: 'not-an-array' },
      { batchId: 'batch-delete-2', paths: [1, 2] },
      { batchId: 'batch-delete-2', paths: Array.from({ length: 11 }, (_, i) => `attachment:${i}`) },
    ];

    for (const body of bodies) {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { message: 'Invalid attachment cleanup request' },
      });
    }
  });

  it('honours a raised maxCleanupPaths', async () => {
    const { url } = await harness({ maxCleanupPaths: 12 });

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        batchId: 'batch-delete-3',
        paths: Array.from({ length: 11 }, (_, i) => `attachment:${i}`),
      }),
    });

    expect(response.status).toBe(204);
  });

  it('reports an unusable batch id as a client error, not an internal one', async () => {
    const { url, deps } = await harness();

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ batchId: 'bad', paths: [] }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: 'Invalid attachment batch' } });
    expect(deps.onInternalError).not.toHaveBeenCalled();
  });

  it('redacts an unexpected cleanup failure behind a correlation id', async () => {
    const { store: real } = await diskStore();
    const onInternalError = vi.fn();
    const store: AttachmentStore = {
      ...real,
      deleteUnclaimed: async () => {
        throw new Error('EACCES: /Users/someone/secret/uploads');
      },
    };
    const { url } = await harness({ store, onInternalError });

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ batchId: 'batch-delete-4', paths: [] }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { message: 'an internal error occurred' } });
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({
      source: 'attachment-cleanup',
      batchId: 'batch-delete-4',
    }));
  });
});

describe('attachment routes — same-origin guard', () => {
  it('rejects a cross-origin request on both routes when the guard is on', async () => {
    const { url } = await harness({ requireSameOrigin: true });

    const posted = await fetch(`${url}?batch=batch-origin-1&name=a.txt`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', origin: 'http://evil.example' },
      body: 'blocked',
    });
    const deleted = await fetch(url, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ batchId: 'batch-origin-1', paths: [] }),
    });

    expect(posted.status).toBe(403);
    expect(await posted.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(deleted.status).toBe(403);
  });

  it('accepts a same-origin request when the guard is on', async () => {
    const { url } = await harness({ requireSameOrigin: true });
    const origin = new URL(url).origin;

    const response = await fetch(`${url}?batch=batch-origin-2&name=a.txt`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', origin },
      body: 'allowed',
    });

    expect(response.status).toBe(201);
  });

  it('defaults the guard on, so a host must opt out deliberately', async () => {
    const { store } = await diskStore();
    const app = express();
    const adapter = { resolvedPortRef: { current: 0 } };
    registerAttachmentRoutes(app, { store }, adapter);
    const server: Server = app.listen(0);
    await new Promise((ready) => server.once('listening', ready));
    const { port } = server.address() as { port: number };
    adapter.resolvedPortRef.current = port;
    cleanups.push(
      () => new Promise<void>((closed) => {
        server.close(() => closed());
      }),
    );

    const response = await fetch(
      `http://127.0.0.1:${port}${ATTACHMENTS_ROUTE_PATH}?batch=batch-origin-3&name=a.txt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', origin: 'http://evil.example' },
        body: 'blocked',
      },
    );

    expect(response.status).toBe(403);
  });
});

describe('attachment routes — default internal-error sink', () => {
  it('logs to console.error when no host sink is supplied', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store: real } = await diskStore();
    const store: AttachmentStore = {
      ...real,
      register: async () => {
        throw new Error('boom');
      },
    };
    const { url } = await harness({ store, useDefaultErrorSink: true });

    const response = await upload(url, { batch: 'batch-sink-1', name: 'a.txt' });

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('internal error (attachment-upload, correlationId='),
      expect.any(Error),
    );
  });
});
