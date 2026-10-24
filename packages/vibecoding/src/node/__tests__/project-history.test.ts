import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openFileTreeProject } from '../project.js';
import { createVibecodingSession } from '../../session.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const base = await fs.mkdtemp(join(tmpdir(), 'vibe-history-')); roots.push(base);
  const input = { root: join(base, 'app'), stateDir: join(base, 'state'), policy: { allows: () => true } };
  await fs.mkdir(input.root); await fs.writeFile(join(input.root, 'index.ts'), 'A');
  return { input, project: await openFileTreeProject(input) };
}
test('create/delete undo and redo restore exact trees including empty managed folders', async () => {
  const { input, project } = await fixture();
  await project.applyTurn({ expectedRevision: await project.getRevision(), changes: [
    { op: 'delete', id: 'index.ts' }, { op: 'create', relativePath: 'new/deep/file.ts', content: 'B' },
  ] });
  expect(project.history.entries()).toHaveLength(1);
  expect(project.history.entries()[0]!.changes).toHaveLength(1);
  const after = await project.getRevision();
  await project.history.undo();
  expect(await fs.readdir(input.root)).toEqual(['index.ts']);
  expect(await fs.readFile(join(input.root, 'index.ts'), 'utf8')).toBe('A');
  expect((await project.getRevision()).generation).toBe(after.generation + 1);
  expect(project.history.retainedEntries()).toHaveLength(1); // Redo is pinned too.
  await project.history.redo();
  expect(await fs.readFile(join(input.root, 'new/deep/file.ts'), 'utf8')).toBe('B');
  await expect(fs.stat(join(input.root, 'index.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
});
test('directory spelling and file/directory transitions survive undo and redo', async () => {
  const { input, project } = await fixture();
  await project.applyTurn({ expectedRevision: await project.getRevision(), changes: [
    { op: 'delete', id: 'index.ts' }, { op: 'create', relativePath: 'src/deep/file.ts', content: 'B' },
  ] });
  await project.applyTurn({ expectedRevision: await project.getRevision(), changes: [
    { op: 'delete', id: 'src/deep/file.ts' }, { op: 'create', relativePath: 'SRC/deep/file.ts', content: 'B' },
  ] });
  expect(await fs.readdir(input.root)).toEqual(['SRC']);
  await project.applyTurn({ expectedRevision: await project.getRevision(), changes: [
    { op: 'delete', id: 'SRC/deep/file.ts' }, { op: 'create', relativePath: 'SRC', content: 'flat' },
  ] });
  expect(await fs.readFile(join(input.root, 'SRC'), 'utf8')).toBe('flat');
  await project.history.undo();
  expect(await fs.readFile(join(input.root, 'SRC/deep/file.ts'), 'utf8')).toBe('B');
  await project.history.redo();
  expect(await fs.readFile(join(input.root, 'SRC'), 'utf8')).toBe('flat');
});
test('A→B→A by another handle conflicts by generation and clears stale history', async () => {
  const { input, project } = await fixture();
  await project.applyTurn({ expectedRevision: await project.getRevision(), changes: [{ op: 'replace', id: 'index.ts', content: 'local' }] });
  const stale = await project.getRevision();
  const other = await openFileTreeProject(input);
  await other.applyTurn({ expectedRevision: await other.getRevision(), changes: [{ op: 'replace', id: 'index.ts', content: 'B' }] });
  await other.history.undo();
  expect((await other.getRevision()).revisionId).toBe(stale.revisionId);
  await expect(project.history.undo()).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(project.history.retainedEntries()).toEqual([]);
  expect(await fs.readFile(join(input.root, 'index.ts'), 'utf8')).toBe('local');
  // The same handle recovers after clearing: no manual reopen is necessary.
  expect((await project.getRevision()).generation).toBeGreaterThan(stale.generation);
});
test('npm-style drift is captured before undo, so undo first reverses the external revision', async () => {
  const { input, project } = await fixture();
  await project.applyTurn({ expectedRevision: await project.getRevision(), changes: [{ op: 'replace', id: 'index.ts', content: 'model' }] });
  await fs.writeFile(join(input.root, 'index.ts'), 'npm rewrote this');
  await fs.writeFile(join(input.root, 'package-lock.json'), '{"lockfileVersion":3}');
  const entry = await project.history.undo();
  expect(entry?.label).toBe('Capture external changes');
  expect(await fs.readFile(join(input.root, 'index.ts'), 'utf8')).toBe('model');
  await expect(fs.stat(join(input.root, 'package-lock.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await project.history.redo();
  expect(await fs.readFile(join(input.root, 'index.ts'), 'utf8')).toBe('npm rewrote this');
  expect(await fs.readFile(join(input.root, 'package-lock.json'), 'utf8')).toBe('{"lockfileVersion":3}');
});
test('snapshot restore is undoable and objects shared by revisions are retained', async () => {
  const { input, project } = await fixture();
  const snapshot = await project.snapshot();
  await project.applyTurn({ expectedRevision: await project.getRevision(), changes: [{ op: 'create', relativePath: 'b.ts', content: 'A' }] });
  expect(await fs.readdir(join(input.stateDir, 'objects'))).toHaveLength(1);
  await project.restore({ snapshot });
  expect(await fs.readdir(input.root)).toEqual(['index.ts']);
  await project.history.undo();
  expect(await fs.readdir(input.root)).toEqual(['b.ts', 'index.ts']);
});
test('garbage collection expires unpinned snapshots without pruning a pinned redo', async () => {
  const { input } = await fixture();
  const project = await openFileTreeProject(input, { historyLimit: 1 });
  const old = await project.snapshot();
  for (const content of ['B', 'C']) await project.applyTurn({ expectedRevision: await project.getRevision(), changes: [{ op: 'replace', id: 'index.ts', content }] });
  await expect(project.restore({ snapshot: old })).rejects.toMatchObject({ code: 'SNAPSHOT_EXPIRED' });
  await project.history.undo();
  await project.capture();
  await project.history.redo();
  expect(await fs.readFile(join(input.root, 'index.ts'), 'utf8')).toBe('C');
  expect(await fs.readdir(join(input.stateDir, 'objects'))).toHaveLength(2);
});
test('injected session shares pointer history and invalidates caches across delete/undo and drift', async () => {
  const { input, project } = await fixture();
  const session = createVibecodingSession({ target: project.target }, { history: project.history, applyTurn: project.applyEdits });
  await session.refresh(); expect(await session.readPart({ id: 'index.ts' })).toBe('A');
  await session.applyEdits({ edits: [{ id: 'index.ts', content: 'B' }] });
  expect(session.history).toBe(project.history);
  expect(project.history.entries()).toHaveLength(1);
  await project.applyTurn({ expectedRevision: await project.getRevision(), changes: [{ op: 'delete', id: 'index.ts' }] });
  await session.refresh(); expect(session.getSnapshot().parts).toEqual([]);
  await session.undo();
  expect(session.getSnapshot().parts).toEqual([{ id: 'index.ts' }]);
  expect([...session.getSnapshot().partContent]).toEqual([]);
  expect(await session.readPart({ id: 'index.ts' })).toBe('B');
  await fs.writeFile(join(input.root, 'index.ts'), 'editor');
  expect(await session.readPart({ id: 'index.ts' })).toBe('editor');
  expect(session.getSnapshot().canUndo).toBe(true);
});
