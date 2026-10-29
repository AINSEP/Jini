import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openFileTreeProject } from '../filesystem.js';
import { ProjectError } from '../../index.js';
import type { ProjectValidator } from '../../../core/project.js';
import type { OpenFileTreeProjectOptions } from '../../project.js';
import { createVibecodingSession } from '../../../core/session.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function fixture({ validator, options = {} }: { validator?: ProjectValidator; options?: OpenFileTreeProjectOptions } = {}) {
  const base = await fs.mkdtemp(join(tmpdir(), 'jini-project-contract-')); roots.push(base);
  const root = join(base, 'app'), stateDir = join(base, 'state');
  await fs.mkdir(root); await fs.writeFile(join(root, 'index.txt'), 'before');
  const input = { root, stateDir, policy: { allows: () => true }, ...(validator ? { validator } : {}) };
  return { input, project: await openFileTreeProject(input, options) };
}

it.each([0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses invalid history limit %s before opening a project', async historyLimit => {
  const { input } = await fixture();
  await expect(openFileTreeProject(input, { historyLimit })).rejects.toBeInstanceOf(TypeError);
});

it('wraps native directory failures in the stable STORAGE error', async () => {
  const { input } = await fixture();
  await expect(openFileTreeProject({ ...input, root: join(input.root, 'index.txt') })).rejects.toMatchObject({ code: 'STORAGE', message: 'could not open local project' });
});

it('unchanged turns and same-revision restores preserve generation and do not invent history', async () => {
  const { project } = await fixture();
  const before = await project.getRevision(), snapshot = await project.snapshot();
  expect(await project.applyTurn({ expectedRevision: before, changes: [] })).toEqual({ status: 'unchanged', revision: before, diagnostics: [] });
  expect(await project.restore({ snapshot }, { label: 'No change' })).toEqual(before);
  expect(await project.history.undo()).toBeNull(); expect(await project.history.redo()).toBeNull();
  expect(project.history.entries()).toEqual([]);
});

it('the text target supports snapshot restore, keeps labels and cannot bypass project transactions', async () => {
  const { project } = await fixture();
  const snapshot = await project.target.snapshot();
  expect(snapshot.parts).toEqual({ 'index.txt': 'before' });
  expect(await project.target.validate({ id: 'index.txt', content: 'after' })).toEqual({ ok: true });
  await project.target.replacePart({ id: 'index.txt', content: 'after' });
  expect(await project.target.readPart({ id: 'index.txt' })).toBe('after');
  const entry = await project.history.restore({ snapshot });
  expect(entry?.label).toBe(`restore ${snapshot.id}`);
  expect(await project.target.readPart({ id: 'index.txt' })).toBe('before');
  expect(await project.history.restore({ snapshot })).toBeNull();
  await project.target.replacePart({ id: 'index.txt', content: 'third' });
  await project.target.restore({ snapshot });
  expect(await project.target.readPart({ id: 'index.txt' })).toBe('before');
  await expect(project.history.transaction({ work: async () => 'illegal' })).rejects.toMatchObject({ code: 'INVALID_CHANGE', message: 'use project.applyTurn for atomic transactions' });
});

it('maps validator refusals to per-edit corrections and direct target errors', async () => {
  const { input, project } = await fixture({ validator: { validate: async () => ({ ok: false, diagnostics: [{ code: 'A', message: 'first' }, { code: 'B', message: 'second' }] }) } });
  const edit = { id: 'index.txt', content: 'bad' };
  expect(await project.applyEdits({ edits: [edit] })).toEqual([{ status: 'rejected', id: edit.id, reason: 'first\nsecond' }]);
  await expect(project.target.replacePart(edit)).rejects.toMatchObject({ code: 'VALIDATION', message: 'first\nsecond' });
  expect(await fs.readFile(join(input.root, edit.id), 'utf8')).toBe('before');
  expect(project.history.entries()).toEqual([]);
});

it('maps failed edits to their original typed failure and refuses missing or binary text reads', async () => {
  const { input, project } = await fixture();
  const [failed] = await project.applyEdits({ edits: [{ id: 'missing.txt', content: 'bad' }] });
  expect(failed).toMatchObject({ status: 'failed', id: 'missing.txt', error: { code: 'INVALID_CHANGE', message: 'file not listed: missing.txt' } });
  await expect(project.target.replacePart({ id: 'missing.txt', content: 'bad' })).rejects.toMatchObject({ code: 'INVALID_CHANGE' });
  await expect(project.target.readPart({ id: 'missing.txt' })).rejects.toMatchObject({ code: 'INVALID_CHANGE' });
  await fs.writeFile(join(input.root, 'asset.bin'), new Uint8Array([255, 254]));
  await project.capture();
  await expect(project.target.readPart({ id: 'asset.bin' })).rejects.toMatchObject({ code: 'INVALID_CHANGE', message: 'binary asset cannot be read as UTF-8 text; use a candidate byte read' });
  await expect(project.target.snapshot()).rejects.toMatchObject({ code: 'INVALID_CHANGE' });
});

it('bounds diagnostics, defaults empty refusals and does not publish rejected bytes', async () => {
  let diagnostics: { code: string; message: string; relativePath?: string }[] | undefined;
  const { input, project } = await fixture({ validator: { validate: async () => ({ ok: false, ...(diagnostics === undefined ? {} : { diagnostics }) }) } });
  const turn = { expectedRevision: await project.getRevision(), changes: [{ op: 'replace' as const, id: 'index.txt', content: 'bad' }] };
  expect((await project.applyTurn(turn)).diagnostics).toEqual([{ code: 'VALIDATION', message: 'candidate refused by validator' }]);
  diagnostics = Array.from({ length: 101 }, (_, index) => ({ code: 'C'.repeat(101), message: 'm'.repeat(2001), ...(index ? {} : { relativePath: 'p'.repeat(201) }) }));
  const result = await project.applyTurn(turn);
  expect(result.diagnostics).toHaveLength(100);
  expect(result.diagnostics[0]).toEqual({ code: 'C'.repeat(100), message: 'm'.repeat(2000), relativePath: 'p'.repeat(200) });
  expect(result.diagnostics[1]).toEqual({ code: 'C'.repeat(100), message: 'm'.repeat(2000) });
  expect(await fs.readFile(join(input.root, 'index.txt'), 'utf8')).toBe('before');
});

it('rejects candidate reads outside its file set with the original ProjectError', async () => {
  const { project } = await fixture({ validator: { validate: async ({ candidate }) => {
    expect(Object.isFrozen(candidate.paths)).toBe(true);
    await candidate.readBytes({ relativePath: 'missing.txt' });
    return { ok: true };
  } } });
  await expect(project.applyTurn({ expectedRevision: await project.getRevision(), changes: [] })).rejects.toMatchObject({ code: 'INVALID_PATH', message: 'file not in candidate: missing.txt' });
});

it('cancels a validator that ignores its signal without publishing or blocking the next turn', async () => {
  let entered!: () => void, shouldWait = true;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const { input, project } = await fixture({ validator: { validate: async () => {
    entered(); if (shouldWait) await new Promise<void>(() => {}); return { ok: true };
  } } });
  const controller = new AbortController();
  const turn = { expectedRevision: await project.getRevision(), changes: [{ op: 'replace' as const, id: 'index.txt', content: 'after' }] };
  const pending = project.applyTurn(turn, { signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  await started; controller.abort(); await rejected;
  expect(await fs.readFile(join(input.root, 'index.txt'), 'utf8')).toBe('before');
  shouldWait = false;
  expect((await project.applyTurn(turn, { label: 'Retry' })).status).toBe('committed');
  expect(project.history.entries()[0]?.label).toBe('Retry');
});

it.each([
  { limits: { maxFileBytes: 6 }, changes: [{ op: 'replace' as const, id: 'index.txt', content: 'toolong' }], message: 'file exceeds byte limit: index.txt' },
  { limits: { maxFiles: 1 }, changes: [{ op: 'create' as const, relativePath: 'extra.txt', content: '' }], message: 'candidate exceeds file count' },
])('refuses over-limit candidates before writing: $message', async ({ limits, changes, message }) => {
  const { project, input } = await fixture({ options: { limits } });
  await expect(project.applyTurn({ expectedRevision: await project.getRevision(), changes })).rejects.toMatchObject({ code: 'LIMIT', message });
  expect(await fs.readFile(join(input.root, 'index.txt'), 'utf8')).toBe('before');
  expect(await fs.readdir(input.root)).toEqual(['index.txt']);
});

it('close releases history and makes future public operations fail CLOSED', async () => {
  const { project } = await fixture();
  await project.applyEdits({ edits: [{ id: 'index.txt', content: 'after' }] });
  await project.close();
  expect(project.history.retainedEntries()).toEqual([]);
  await expect(project.capture()).rejects.toMatchObject({ code: 'CLOSED' });
  await expect(project.getRevision()).rejects.toBeInstanceOf(ProjectError);
});

it('project sessions discard cached bytes after redo and snapshot restore, including a no-op restore', async () => {
  const { project } = await fixture();
  const session = createVibecodingSession({ target: project.target }, { history: project.history, applyTurn: project.applyEdits });
  const snapshot = await session.takeSnapshot();
  await session.readPart({ id: 'index.txt' });
  await session.applyEdits({ edits: [{ id: 'index.txt', content: 'after' }] });
  await session.undo(); expect(await session.readPart({ id: 'index.txt' })).toBe('before');
  await session.redo();
  expect([...session.getSnapshot().partContent]).toEqual([]);
  expect(await session.readPart({ id: 'index.txt' })).toBe('after');
  expect(await session.restoreSnapshot({ snapshot })).not.toBeNull();
  expect([...session.getSnapshot().partContent]).toEqual([]);
  expect(await session.readPart({ id: 'index.txt' })).toBe('before');
  expect(await session.restoreSnapshot({ snapshot })).toBeNull();
  expect([...session.getSnapshot().partContent]).toEqual([['index.txt', 'before']]);
});

it('project-session failures clear stale cached bytes and recover on the next refresh', async () => {
  const { project } = await fixture();
  const session = createVibecodingSession({ target: project.target }, { history: project.history, applyTurn: project.applyEdits });
  expect(await session.readPart({ id: 'index.txt' })).toBe('before');
  await expect(session.readPart({ id: 'missing.txt' })).rejects.toMatchObject({ code: 'INVALID_CHANGE' });
  expect(session.getSnapshot()).toMatchObject({ status: 'error', lastError: 'file not listed: missing.txt' });
  expect([...session.getSnapshot().partContent]).toEqual([]);
  await session.refresh();
  expect(session.getSnapshot()).toMatchObject({ status: 'ready', lastError: undefined, parts: [{ id: 'index.txt' }] });
});
