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
