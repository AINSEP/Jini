// Characterization pins for readSkillState: missing records default to enabled, everything
// else that is not a small regular file holding a well-formed record fails closed.
import { describe, expect, it } from 'vitest';
import { readSkillState } from '../state.js';
import type { SkillFilesystemPort } from '../ports.js';

const INVALID = 'Invalid skill installation record.';
const COMMIT = 'd'.repeat(40);

function filesystem(options: { stat?: SkillFilesystemPort['lstat']; read?: SkillFilesystemPort['readFile'] }) {
  const calls: { lstat: string[]; readFile: { path: string; maxBytes: number }[] } = { lstat: [], readFile: [] };
  const unused = async (): Promise<never> => { throw new Error('unexpected filesystem call'); };
  const port: SkillFilesystemPort = {
    mkdir: unused, mkdtemp: unused, writeFile: unused, rename: unused, remove: unused,
    lstat: async request => { calls.lstat.push(request.path); return (options.stat ?? (async () => ({ kind: 'file', size: 10 })))(request); },
    readFile: async request => { calls.readFile.push(request); return (options.read ?? (async () => Buffer.from('{}')))(request); },
  };
  return { port, calls };
}
const enoent = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
const read = (fs: ReturnType<typeof filesystem>) => readSkillState({ directory: '/skills/ops', stateFileName: '.state.json', filesystem: fs.port });
const content = (text: string | Uint8Array) => filesystem({ read: async () => (typeof text === 'string' ? Buffer.from(text) : text) });

describe('readSkillState', () => {
  it('reads the record beside the skill with an 8 KiB cap', async () => {
    const fs = content(JSON.stringify({ enabled: false, source: 'uploaded' }));
    expect(await read(fs)).toEqual({ enabled: false, source: 'uploaded' });
    expect(fs.calls).toEqual({ lstat: ['/skills/ops/.state.json'], readFile: [{ path: '/skills/ops/.state.json', maxBytes: 8192 }] });
  });

  it('accepts a GitHub source pinned to a 40-hex commit', async () => {
    const state = { enabled: true, source: { githubUrl: 'https://github.com/o/r', commit: COMMIT } };
    expect(await read(content(JSON.stringify(state)))).toEqual(state);
  });

  it('defaults to enabled uploads when lstat reports ENOENT', async () => {
    expect(await read(filesystem({ stat: async () => { throw enoent(); } }))).toEqual({ enabled: true, source: 'uploaded' });
  });

  it('defaults to enabled uploads when the record vanishes between lstat and read', async () => {
    expect(await read(filesystem({ read: async () => { throw enoent(); } }))).toEqual({ enabled: true, source: 'uploaded' });
  });

  it('rethrows other filesystem errors unchanged', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
    await expect(read(filesystem({ stat: async () => { throw denied; } }))).rejects.toBe(denied);
  });

  it.each(['symlink', 'directory', 'other'] as const)('refuses a %s record without reading it', async kind => {
    const fs = filesystem({ stat: async () => ({ kind, size: 2 }) });
    await expect(read(fs)).rejects.toThrow(INVALID);
    expect(fs.calls.readFile).toEqual([]);
  });

  it('refuses a record whose lstat size exceeds 8 KiB without reading it', async () => {
    const fs = filesystem({ stat: async () => ({ kind: 'file', size: 8193 }) });
    await expect(read(fs)).rejects.toThrow(INVALID);
    expect(fs.calls.readFile).toEqual([]);
  });

  it('accepts a record whose lstat size is exactly 8 KiB', async () => {
    const fs = filesystem({ stat: async () => ({ kind: 'file', size: 8192 }), read: async () => Buffer.from('{"enabled":true,"source":"uploaded"}') });
    expect(await read(fs)).toEqual({ enabled: true, source: 'uploaded' });
  });

  it('refuses when the read returns more than 8 KiB despite the cap', async () => {
    const record = JSON.stringify({ enabled: true, source: 'uploaded', pad: 'x'.repeat(8192) });
    await expect(read(content(record))).rejects.toThrow(INVALID);
  });

  it.each([
    'null', '[]', '1', '"text"', '{}', '{"enabled":"yes","source":"uploaded"}', '{"enabled":true}', '{"enabled":true,"source":null}',
    '{"enabled":true,"source":"github"}', '{"enabled":true,"source":{"commit":"' + COMMIT + '"}}',
    '{"enabled":true,"source":{"githubUrl":1,"commit":"' + COMMIT + '"}}', '{"enabled":true,"source":{"githubUrl":"u","commit":"' + COMMIT.toUpperCase() + '"}}',
    '{"enabled":true,"source":{"githubUrl":"u"}}', '{"enabled":true,"source":{"githubUrl":"u","commit":"' + COMMIT + 'd"}}',
  ])('refuses malformed record %s', async record => {
    await expect(read(content(record))).rejects.toThrow(INVALID);
  });

  it('lets malformed JSON escape as a raw SyntaxError (reported, not fixed)', async () => {
    await expect(read(content('{'))).rejects.toThrow(SyntaxError);
  });

  it('accepts a commit given as a one-element array because the regex coerces it to a string (reported, not fixed)', async () => {
    const state = { enabled: true, source: { githubUrl: 'u', commit: [COMMIT] } };
    expect(await read(content(JSON.stringify(state)))).toEqual(state);
  });
});
