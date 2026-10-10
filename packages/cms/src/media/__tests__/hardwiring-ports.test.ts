import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFfmpegVideoFrameExtractor, createVideoExtractionLock, findVideoBinaries } from '../video-frames.ffmpeg.js';
import { createEntryLockState, withEntryLock } from '../../widgets/concurrency.js';

const bytes = new Uint8Array([0, 0, 0, 24, ...Buffer.from('ftypisom'), 0, 0, 2, 0, ...Buffer.from('isomiso2')]);

// hwb #16: no codec runs; the host supplies fake executables and the finder only checks access.
it('discovers only from the supplied environment and platform', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwb-video-'));
  try {
    for (const name of ['nice', 'ffmpeg', 'ffprobe']) { await writeFile(join(dir, name), ''); await chmod(join(dir, name), 0o700); }
    expect(await findVideoBinaries({}, { env: { PATH: dir }, platform: 'linux' })).toEqual({ nice: join(dir, 'nice'), ffmpeg: join(dir, 'ffmpeg'), ffprobe: join(dir, 'ffprobe') });
    expect(await findVideoBinaries({}, { env: { PATH: dir }, platform: 'win32' })).toBeUndefined();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// hwb #16: same host lock stays busy; a separate host can proceed; failure releases the lock.
it('honors injected lock ownership and releases it on unavailable or rejected discovery', async () => {
  const lock = createVideoExtractionLock({});
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const findBinaries = () => new Promise<undefined>(resolve => { finish = () => resolve(undefined); started(); });
  const first = createFfmpegVideoFrameExtractor({ lock, findBinaries });
  const pending = first.extract({ bytes }, {});
  await ready;
  try {
    const same = createFfmpegVideoFrameExtractor({ lock, findBinaries: async () => undefined });
    expect(await same.extract({ bytes }, {})).toEqual({ ok: false, reason: 'busy', message: 'Video preview is busy. Try again after the current extraction finishes.' });
    const other = createFfmpegVideoFrameExtractor({ lock: createVideoExtractionLock({}), findBinaries: async () => undefined });
    expect((await other.extract({ bytes }, {})).ok).toBe(false);
    const result = await other.extract({ bytes }, {});
    expect(result).toMatchObject({ reason: 'unavailable' });
  } finally { finish(); await pending; }
  const failed = createFfmpegVideoFrameExtractor({ lock, findBinaries: async () => { throw new Error('probe failed'); } });
  expect(await failed.extract({ bytes }, {})).toMatchObject({ reason: 'invalid' });
  const release = lock.tryAcquire({}, {});
  expect(typeof release).toBe('function');
  release?.();
});

// hwb widgets: deleting a predecessor's newer tail would allow a third caller to overlap the second.
it('serializes waiters, keeps their tail until completion, and prunes failed and idle keys', async () => {
  const locks = createEntryLockState({});
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const order: number[] = [];
  const first = withEntryLock({ key: 'entry', fn: async () => { order.push(1); await gate; } }, { locks });
  const second = withEntryLock({ key: 'entry', fn: async () => { order.push(2); throw new Error('write failed'); } }, { locks });
  const failure = expect(second).rejects.toThrow('write failed');
  const third = withEntryLock({ key: 'entry', fn: async () => { order.push(3); return 'done'; } }, { locks });
  await Promise.resolve();
  expect(order).toEqual([1]);
  expect(locks.size).toBe(1);
  release(); await first; await failure;
  expect(await third).toBe('done');
  expect(order).toEqual([1, 2, 3]);
  expect(locks.size).toBe(0);
});

it('a repeated release cannot unlock a later video extraction', () => {
  const lock = createVideoExtractionLock({});
  const first = lock.tryAcquire({}, {})!;
  first();
  const second = lock.tryAcquire({}, {})!;
  first();
  expect(lock.tryAcquire({}, {})).toBeUndefined();
  second();
  expect(typeof lock.tryAcquire({}, {})).toBe('function');
});
