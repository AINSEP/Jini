import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonFileRead } from '@jini-ai/core/contracts/site/fs-durable-json';
import {
  IMPORT_INDEX_STATE_SCHEMA, indexStatePaths, markIndexedWrite, readIndexState, retireLegacySnapshot, writeIndexState, writeIndexedWitness,
  type ImportIndexState, type LegacyRetireFs,
} from '../mode.js';

// Real node:fs ports, bound only here: the host binds its own equivalents.
const errorCode = (error: unknown) => (error as { code?: string } | null)?.code;
const kindOf = (file: string) => {
  try { const stat = fs.lstatSync(file); return stat.isFile() ? 'file' as const : stat.isDirectory() ? 'directory' as const : stat.isSymbolicLink() ? 'symlink' as const : 'other' as const; }
  catch (error) { if (errorCode(error) === 'ENOENT') return 'missing' as const; throw error; }
};
const fsyncPath = (target: string) => { const fd = fs.openSync(target, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
const witnessFs = {
  writeExclusive: ({ file, mode }: { file: string; mode: number }) => fs.closeSync(fs.openSync(file, 'wx', mode)),
  kind: ({ file }: { file: string }) => { const kind = kindOf(file); return kind === 'symlink' ? 'other' as const : kind; },
  fsyncFile: ({ file }: { file: string }) => fsyncPath(file),
  fsyncDir: ({ dir }: { dir: string }) => fsyncPath(dir),
};
const writeJson = ({ file, value }: { file: string; value: unknown }) => {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fsyncPath(temp);
  fs.renameSync(temp, file);
  fsyncPath(path.dirname(file));
};
const readJson = ({ file }: { file: string }): JsonFileRead => {
  try { return { state: 'ok', value: JSON.parse(fs.readFileSync(file, 'utf8')) as unknown }; }
  catch (error) { return errorCode(error) === 'ENOENT' ? { state: 'missing' } : { state: 'unreadable' }; }
};
const retireFs: LegacyRetireFs = {
  readdir: ({ dir }) => fs.readdirSync(dir),
  stat: ({ file }) => { const kind = kindOf(file); return { kind, mtimeMs: kind === 'missing' ? 0 : fs.lstatSync(file).mtimeMs }; },
  unlink: ({ file }) => fs.unlinkSync(file),
};

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const makeRoot = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'import-mode-')); roots.push(root); return root; };
const DB_ID = '33333333-3333-4333-8333-333333333333';
const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;

describe('import index mode on a real disk', () => {
  it('state says indexed and the 0600 witness exists before the SQL callback; a failed state write leaves neither', () => {
    const root = makeRoot();
    const paths = indexStatePaths({ root });
    const cutover: ImportIndexState = { schema: IMPORT_INDEX_STATE_SCHEMA, mode: 'cutover', dbId: DB_ID, cutoverAt: 1_000, firstIndexedWriteAt: 0, legacyRetiredAt: 0 };
    writeIndexState({ file: paths.state, writeJson, state: cutover });
    const seen: unknown[] = [];
    const sql = () => seen.push({ state: readIndexState({ file: paths.state, readJson }), witnessMode: fs.statSync(paths.witness).mode & 0o777 });
    const writeState = ({ state }: { state: ImportIndexState }) => writeIndexState({ file: paths.state, writeJson, state });
    markIndexedWrite({ state: cutover, clock: { nowMs: () => 5_000 }, writeState, ensureIndexedWitness: () => writeIndexedWitness({ root, fs: witnessFs }) });
    sql();
    expect(seen).toEqual([{ state: { kind: 'valid', state: { ...cutover, mode: 'indexed', firstIndexedWriteAt: 5_000 } }, witnessMode: 0o600 }]);
    // A second write in the same mode finds the witness already there and still allows SQL.
    expect(() => markIndexedWrite({ state: { ...cutover, mode: 'indexed', firstIndexedWriteAt: 5_000 }, clock: { nowMs: () => 6_000 }, writeState, ensureIndexedWitness: () => writeIndexedWitness({ root, fs: witnessFs }) })).not.toThrow();

    const failRoot = makeRoot();
    const failPaths = indexStatePaths({ root: failRoot });
    writeIndexState({ file: failPaths.state, writeJson, state: cutover });
    fs.mkdirSync(`${failPaths.state}.tmp`);
    let ran = false;
    expect(() => {
      markIndexedWrite({ state: cutover, clock: { nowMs: () => 5_000 }, writeState: ({ state }) => writeIndexState({ file: failPaths.state, writeJson, state }), ensureIndexedWitness: () => writeIndexedWitness({ root: failRoot, fs: witnessFs }) });
      ran = true;
    }).toThrow();
    expect(ran).toBe(false);
    expect(fs.existsSync(failPaths.witness)).toBe(false);
    expect(readIndexState({ file: failPaths.state, readJson })).toEqual({ kind: 'valid', state: cutover });
  });

  it('retirement on real files removes only old regular history files, 200 per pass, and resumes', () => {
    const root = makeRoot();
    const cutoverAt = Date.now() - 40 * 86_400_000;
    const old = (cutoverAt - 60_000) / 1000;
    for (let n = 0; n < 205; n++) {
      const file = path.join(root, `${uuid(n)}.json`);
      fs.writeFileSync(file, '{}');
      fs.utimesSync(file, old, old);
    }
    const newer = path.join(root, `${uuid(500)}.json`);
    fs.writeFileSync(newer, '{"only":"copy"}');
    fs.utimesSync(newer, (cutoverAt + 60_000) / 1000, (cutoverAt + 60_000) / 1000);
    const link = path.join(root, `${uuid(501)}.json`);
    fs.symlinkSync(path.join(root, `${uuid(0)}.json`), link);
    fs.lutimesSync(link, old, old);
    const keepers = ['notes.json', 'import-index.state.json', '.history-indexed-v1', 'site-imports.db'];
    for (const name of keepers) { fs.writeFileSync(path.join(root, name), 'x'); fs.utimesSync(path.join(root, name), old, old); }
    fs.mkdirSync(path.join(root, 'payloads'));
    fs.writeFileSync(path.join(root, 'payloads', `${uuid(600)}.json`), '{}');
    fs.utimesSync(path.join(root, 'payloads', `${uuid(600)}.json`), old, old);

    let state: ImportIndexState = { schema: IMPORT_INDEX_STATE_SCHEMA, mode: 'indexed', dbId: DB_ID, cutoverAt, firstIndexedWriteAt: cutoverAt + 1, legacyRetiredAt: 0 };
    const logs: string[] = [];
    const pass = () => retireLegacySnapshot({ root, state, clock: { nowMs: () => cutoverAt + 2_592_000_000 }, policy: { legacyRetireMs: 2_592_000_000 }, fs: retireFs,
      writeState: ({ state: next }) => { state = next; }, log: ({ message }) => logs.push(message) });
    expect(pass()).toEqual({ removed: 200, finished: false });
    expect(state.legacyRetiredAt).toBe(0);
    expect(pass()).toEqual({ removed: 5, finished: true });
    expect(state.legacyRetiredAt).toBe(cutoverAt + 2_592_000_000);
    expect(fs.readdirSync(root).sort()).toEqual([...keepers, 'payloads', `${uuid(500)}.json`, `${uuid(501)}.json`].sort());
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(newer, 'utf8')).toBe('{"only":"copy"}');
    expect(fs.readdirSync(path.join(root, 'payloads'))).toEqual([`${uuid(600)}.json`]);
    expect(logs).toEqual(['Kept 1 import history files written after the switch to indexed history.', 'Kept 1 import history files written after the switch to indexed history.']);
  });
});
