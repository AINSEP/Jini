import { describe, expect, it, vi } from 'vitest';
import type { JsonFileRead } from '@jini-ai/core/contracts/site/fs-durable-json';
import { countStagedPayloads, ensurePayloadNamespace, expirePayloads, payloadPaths, type ImportPayloadFs } from '../payload-namespace.js';

const id = '11111111-1111-1111-1111-111111111111';
const stale = '22222222-2222-2222-2222-222222222222';
const root = '/history';

function fixture() {
  const entries = new Map<string, 'file' | 'directory' | 'other'>([[root, 'directory']]);
  const fs: ImportPayloadFs = {
    readdir: vi.fn(({ dir }) => [...entries.keys()].filter(file => file.startsWith(`${dir}/`) && !file.slice(dir.length + 1).includes('/')).map(file => file.slice(dir.length + 1))),
    kind: ({ file }) => entries.get(file) ?? 'missing',
    rename: ({ from, to }) => { entries.set(to, entries.get(from)!); entries.delete(from); },
    rm: ({ file }) => { entries.delete(file); },
    mkdir: ({ dir }) => { entries.set(dir, 'directory'); },
    chmod: vi.fn(),
    writeExclusive: ({ file }) => { if (entries.has(file)) throw Object.assign(new Error('exists'), { code: 'EEXIST' }); entries.set(file, 'file'); },
    fsyncFile: vi.fn(), fsyncDir: vi.fn(),
  };
  const paths = payloadPaths({ root });
  const readUpload = vi.fn((_required: { uploadId: string }): JsonFileRead => ({ state: 'ok', value: { createdAt: 0 } }));
  const statusOf = vi.fn((_required: { importId: string }): 'active' | 'terminal' | 'unreadable' | 'absent' => 'active');
  const expire = () => expirePayloads({ paths, fs, clock: { nowMs: () => 1 }, readUpload, statusOf, report: vi.fn() });
  return { entries, fs, paths, readUpload, statusOf, expire };
}

describe('payload namespace', () => {
  it('staging budget and orphan sweep never enumerate the history directory', () => {
    const f = fixture();
    ensurePayloadNamespace({ root, paths: f.paths, fs: f.fs });
    f.entries.set(f.paths.upload({ uploadId: id }), 'file');
    f.entries.set(f.paths.stage({ importId: id }), 'directory');
    vi.mocked(f.fs.readdir).mockClear();
    expect(countStagedPayloads(f)).toBe(2);
    f.expire();
    expect(vi.mocked(f.fs.readdir).mock.calls.map(([arg]) => arg.dir)).toEqual([f.paths.dir, f.paths.dir]);
  });

  it('interrupted move (ZIP moved, metadata not) then restart keeps the upload claimable and owner setup completes', () => {
    const f = fixture();
    f.entries.set(`${root}/${id}.upload.zip`, 'file');
    f.entries.set(`${root}/${id}.upload.json`, 'file');
    f.entries.set(`${root}/${id}.stage`, 'directory');
    const rename = f.fs.rename;
    f.fs.rename = vi.fn((arg, optional) => {
      if (arg.from.endsWith('.upload.json')) throw Object.assign(new Error('interrupted'), { code: 'EACCES' });
      rename(arg, optional);
    });
    expect(() => ensurePayloadNamespace({ root, paths: f.paths, fs: f.fs })).toThrow();
    expect(f.entries.has(f.paths.marker)).toBe(false);
    expect(f.entries.has(f.paths.upload({ uploadId: id }))).toBe(true);
    expect(f.entries.has(`${root}/${id}.upload.json`)).toBe(true);
    f.fs.rename = rename;
    const paths = payloadPaths({ root });
    ensurePayloadNamespace({ root, paths, fs: f.fs });
    f.expire();
    expect(f.entries.has(paths.upload({ uploadId: id }))).toBe(true);
    expect(f.entries.has(paths.uploadMeta({ uploadId: id }))).toBe(true);
    expect(f.entries.has(paths.stage({ importId: id }))).toBe(true);
    expect(f.entries.has(paths.marker)).toBe(true);
  });

  it('active payloads survive the move; stale ones are removed', () => {
    const f = fixture();
    for (const uploadId of [id, stale]) {
      f.entries.set(`${root}/${uploadId}.upload.zip`, 'file');
      f.entries.set(`${root}/${uploadId}.upload.json`, 'file');
      f.entries.set(`${root}/${uploadId}.stage`, 'directory');
    }
    f.readUpload.mockImplementation(({ uploadId }: { uploadId: string }): JsonFileRead => ({ state: 'ok', value: { createdAt: uploadId === id ? 0 : -3_600_002 } }));
    f.statusOf.mockImplementation(({ importId }: { importId: string }) => importId === id ? 'unreadable' : 'terminal');
    ensurePayloadNamespace({ root, paths: f.paths, fs: f.fs });
    f.expire();
    expect(f.entries.has(f.paths.uploadMeta({ uploadId: id }))).toBe(true);
    expect(f.entries.has(f.paths.upload({ uploadId: id }))).toBe(true);
    expect(f.entries.has(f.paths.stage({ importId: id }))).toBe(true);
    expect(f.entries.has(f.paths.uploadMeta({ uploadId: stale }))).toBe(false);
    expect(f.entries.has(f.paths.upload({ uploadId: stale }))).toBe(false);
    expect(f.entries.has(f.paths.stage({ importId: stale }))).toBe(false);
  });

  it('second open does not readdir the history root', () => {
    const f = fixture();
    ensurePayloadNamespace({ root, paths: f.paths, fs: f.fs });
    vi.mocked(f.fs.readdir).mockClear();
    ensurePayloadNamespace({ root, paths: payloadPaths({ root }), fs: f.fs });
    expect(f.fs.readdir).not.toHaveBeenCalled();
  });
});

it('preserves a destination of the wrong kind and its original payload', () => {
  const f = fixture();
  const original = `${root}/${id}.upload.zip`;
  const destination = f.paths.upload({ uploadId: id });
  f.entries.set(original, 'file');
  f.entries.set(f.paths.dir, 'directory');
  f.entries.set(destination, 'directory');

  expect(() => ensurePayloadNamespace({ root, paths: f.paths, fs: f.fs })).toThrow(expect.objectContaining({
    code: 'IMPORT_PAYLOADS_UNMOVABLE', status: 503,
    message: 'Imports are paused because the app could not move its import files. Check that the app can write to its data folder, then try again.',
  }));
  expect(f.entries.get(original)).toBe('file');
  expect(f.entries.get(destination)).toBe('directory');
  expect(f.entries.has(f.paths.marker)).toBe(false);
});

it('retires a same-kind duplicate left by an interrupted move without replacing the destination', () => {
  const f = fixture();
  const original = `${root}/${id}.stage`;
  const destination = f.paths.stage({ importId: id });
  f.entries.set(original, 'directory');
  f.entries.set(f.paths.dir, 'directory');
  f.entries.set(destination, 'directory');
  const rm = vi.fn(f.fs.rm);
  const rename = vi.fn(f.fs.rename);
  f.fs.rm = rm;
  f.fs.rename = rename;

  ensurePayloadNamespace({ root, paths: f.paths, fs: f.fs });

  expect(f.entries.has(original)).toBe(false);
  expect(f.entries.get(destination)).toBe('directory');
  expect(f.entries.get(f.paths.marker)).toBe('file');
  expect(rm.mock.calls).toEqual([[{ file: original, recursive: true }]]);
  expect(rename).not.toHaveBeenCalled();
});

it('accepts an exclusive marker race only when the winner created a regular marker file', () => {
  const f = fixture();
  const writeExclusive = vi.fn<ImportPayloadFs['writeExclusive']>(({ file }) => {
    f.entries.set(file, 'file');
    throw Object.assign(new Error('marker already exists'), { code: 'EEXIST' });
  });
  f.fs.writeExclusive = writeExclusive;
  ensurePayloadNamespace({ root, paths: f.paths, fs: f.fs });
  expect(f.entries.get(f.paths.marker)).toBe('file');
  expect(writeExclusive.mock.calls).toEqual([[{ file: f.paths.marker, mode: 0o600 }]]);
  expect(f.fs.fsyncFile).toHaveBeenCalledWith({ file: f.paths.marker });

  const g = fixture();
  const error = Object.assign(new Error('non-file marker'), { code: 'EEXIST' });
  g.fs.writeExclusive = ({ file }) => { g.entries.set(file, 'other'); throw error; };
  expect(() => ensurePayloadNamespace({ root, paths: g.paths, fs: g.fs })).toThrow(error);
  expect(g.fs.fsyncFile).not.toHaveBeenCalled();
});

it('reports exhausted disk space without committing the namespace marker', () => {
  const f = fixture();
  const raw = Object.assign(new Error('private driver detail'), { code: 'ENOSPC' });
  f.fs.mkdir = () => { throw raw; };
  expect(() => ensurePayloadNamespace({ root, paths: f.paths, fs: f.fs })).toThrow(expect.objectContaining({
    code: 'IMPORT_PAYLOADS_UNMOVABLE', status: 507,
    message: 'There is not enough free disk space to prepare imports. Free up space and try again.',
  }));
  expect(f.entries.has(f.paths.dir)).toBe(false);
  expect(f.entries.has(f.paths.marker)).toBe(false);
});
