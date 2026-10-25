import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { openFileTreeProject } from './filesystem.js';
import type { ProjectValidator } from '../../core/project.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture(validator?: ProjectValidator) {
  const base = await fs.mkdtemp(join(tmpdir(), 'vibe-turn-')); roots.push(base);
  const root = join(base, 'app'), stateDir = join(base, 'state'); await fs.mkdir(root);
  await fs.writeFile(join(root, 'index.ts'), 'before');
  const project = await openFileTreeProject({ root, stateDir, policy: { allows: () => true }, ...(validator ? { validator } : {}) });
  return { root, stateDir, project };
}
test('validates mutually dependent additions together and preserves binary assets byte for byte', async () => {
  const validate = vi.fn<ProjectValidator['validate']>(async ({ candidate }) => {
    expect(candidate.paths).toEqual(['dep.ts', 'icon.bin', 'index.ts']);
    const contents = await candidate.readBytes({ relativePath: 'index.ts' });
    expect(new TextDecoder().decode(contents)).toBe('import "./dep"');
    contents.fill(0); // Validator receives copies; it cannot rewrite what will be committed.
    expect(new TextDecoder().decode(await candidate.readBytes({ relativePath: 'dep.ts' }))).toBe('export {}');
    return { ok: true };
  });
  const { root, project } = await fixture({ validate });
  await fs.writeFile(join(root, 'icon.bin'), new Uint8Array([0, 255, 7]));
  const expectedRevision = await project.capture();
  const result = await project.applyTurn({ expectedRevision, changes: [
    { op: 'replace', id: 'index.ts', content: 'import "./dep"' },
    { op: 'create', relativePath: 'dep.ts', content: 'export {}' },
  ] });
  expect(result.status).toBe('committed'); expect(validate).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(join(root, 'index.ts'), 'utf8')).toBe('import "./dep"');
  expect([...await fs.readFile(join(root, 'icon.bin'))]).toEqual([0, 255, 7]);
});
test('refusal changes neither working files, current pointer nor history', async () => {
  const { root, stateDir, project } = await fixture({ validate: async () => ({ ok: false, diagnostics: [{ code: 'TYPE', message: 'missing export' }] }) });
  const expectedRevision = await project.getRevision(), before = await fs.readFile(join(stateDir, 'current.json'), 'utf8');
  const result = await project.applyTurn({ expectedRevision, changes: [
    { op: 'replace', id: 'index.ts', content: 'bad import' }, { op: 'create', relativePath: 'extra.ts', content: 'bad' },
  ] });
  expect(result).toEqual({ status: 'rejected', revision: expectedRevision, diagnostics: [{ code: 'TYPE', message: 'missing export' }] });
  expect(await fs.readFile(join(root, 'index.ts'), 'utf8')).toBe('before');
  expect(await fs.readdir(root)).toEqual(['index.ts']);
  expect(await fs.readFile(join(stateDir, 'current.json'), 'utf8')).toBe(before);
  expect(project.history.retainedEntries()).toEqual([]);
});
test('optional validator allows stateless create and candidate-wide case-only rename', async () => {
  const { root, project } = await fixture();
  const result = await project.applyTurn({ expectedRevision: await project.getRevision(), changes: [
    { op: 'delete', id: 'index.ts' }, { op: 'create', relativePath: 'INDEX.ts', content: 'after' },
  ] });
  expect(result.status).toBe('committed');
  expect(await fs.readdir(root)).toEqual(['INDEX.ts']);
  expect(await project.target.listParts()).toEqual([{ id: 'INDEX.ts' }]);
});
test('mixed valid and invalid changes never apply a partial turn', async () => {
  const { root, project } = await fixture();
  await expect(project.applyTurn({ expectedRevision: await project.getRevision(), changes: [
    { op: 'replace', id: 'index.ts', content: 'should not land' },
    { op: 'create', relativePath: '../escaped.ts', content: 'no' },
  ] })).rejects.toMatchObject({ code: 'INVALID_PATH' });
  expect(await fs.readFile(join(root, 'index.ts'), 'utf8')).toBe('before');
  expect(project.history.entries()).toEqual([]);
});
test('an in-root directory link is not a writable alias and never publishes a journal', async () => {
  const { root, stateDir, project } = await fixture();
  await fs.mkdir(join(root, 'real'));
  await fs.symlink(join(root, 'real'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const expectedRevision = await project.getRevision();
  const pointer = await fs.readFile(join(stateDir, 'current.json'), 'utf8');
  await expect(project.applyTurn({ expectedRevision, changes: [
    { op: 'create', relativePath: 'alias/escaped.ts', content: 'no' },
  ] })).rejects.toMatchObject({ code: 'INVALID_PATH' });
  expect(await fs.readFile(join(stateDir, 'current.json'), 'utf8')).toBe(pointer);
  expect(await fs.readdir(join(root, 'real'))).toEqual([]);
});
test('repeated IDs, unknown replacements and candidate directory aliases are rejected', async () => {
  const { project } = await fixture();
  for (const changes of [
    [{ op: 'replace' as const, id: 'index.ts', content: 'x' }, { op: 'delete' as const, id: 'index.ts' }],
    [{ op: 'replace' as const, id: 'unknown.ts', content: 'x' }],
    [{ op: 'create' as const, relativePath: 'Src/a.ts', content: 'x' }, { op: 'create' as const, relativePath: 'src/b.ts', content: 'y' }],
  ]) await expect(project.applyTurn({ expectedRevision: await project.getRevision(), changes })).rejects.toBeInstanceOf(Error);
  expect(project.history.entries()).toEqual([]);
});
test('unmanaged generated contents block a directory-to-file turn before journal publication', async () => {
  const { root, stateDir, project } = await fixture();
  await fs.mkdir(join(root, 'src/node_modules'), { recursive: true });
  await fs.writeFile(join(root, 'src/a.ts'), 'managed');
  await fs.writeFile(join(root, 'src/node_modules/keep.js'), 'unmanaged');
  const expectedRevision = await project.capture();
  const before = await fs.readFile(join(stateDir, 'current.json'), 'utf8');
  await expect(project.applyTurn({ expectedRevision, changes: [
    { op: 'delete', id: 'src/a.ts' }, { op: 'create', relativePath: 'src', content: 'flat' },
  ] })).rejects.toMatchObject({ code: 'INVALID_CHANGE' });
  expect(await fs.readFile(join(stateDir, 'current.json'), 'utf8')).toBe(before);
  expect(await fs.readFile(join(root, 'src/a.ts'), 'utf8')).toBe('managed');
  expect(await fs.readFile(join(root, 'src/node_modules/keep.js'), 'utf8')).toBe('unmanaged');
});
test('native case aliases cannot overwrite a file omitted by host policy', async () => {
  const base = await fs.mkdtemp(join(tmpdir(), 'vibe-case-policy-')); roots.push(base);
  const root = join(base, 'app'), stateDir = join(base, 'state'); await fs.mkdir(root);
  await fs.writeFile(join(root, 'PRIVATE.TXT'), 'unmanaged');
  const aliases = await fs.stat(join(root, 'private.txt')).then(() => true, () => false);
  const project = await openFileTreeProject({ root, stateDir, policy: { allows: ({ relativePath }) => relativePath.endsWith('.txt') } });
  const attempt = project.applyTurn({ expectedRevision: await project.getRevision(), changes: [
    { op: 'create', relativePath: 'private.txt', content: 'new' },
  ] });
  if (aliases) await expect(attempt).rejects.toMatchObject({ code: 'INVALID_CHANGE' });
  else expect((await attempt).status).toBe('committed');
  expect(await fs.readFile(join(root, 'PRIVATE.TXT'), 'utf8')).toBe('unmanaged');
});
test('an editor write during validation is captured and refuses the stale candidate', async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  const { root, project } = await fixture({ validate: async () => { entered(); await finish; return { ok: true }; } });
  const attempt = project.applyTurn({ expectedRevision: await project.getRevision(), changes: [{ op: 'replace', id: 'index.ts', content: 'model' }] });
  await started;
  await fs.writeFile(join(root, 'index.ts'), 'editor changed this');
  release();
  await expect(attempt).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await fs.readFile(join(root, 'index.ts'), 'utf8')).toBe('editor changed this');
  // The editor write is this handle's own captured entry, so a stale caller token keeps history.
  expect(project.history.entries().map(entry => entry.label)).toEqual(['Capture external changes']);
});
test('atomic-write debris is never captured and a UTF-8 BOM survives a text round trip', async () => {
  const { root, project } = await fixture();
  await fs.writeFile(join(root, '.index.ts.123.0b1f8c6e-3a3e-4f43-9b1e-2f4f1c9d8a7b.tmp'), 'crash leftover');
  await fs.writeFile(join(root, 'bom.ts'), '\uFEFFexport {}');
  await project.capture();
  expect(await project.target.listParts()).toEqual([{ id: 'bom.ts' }, { id: 'index.ts' }]);
  const text = await project.target.readPart({ id: 'bom.ts' });
  await project.applyTurn({ expectedRevision: await project.getRevision(), changes: [{ op: 'replace', id: 'bom.ts', content: `${text}\n` }] });
  expect([...(await fs.readFile(join(root, 'bom.ts'))).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
});
test('validator exception, timeout and cancellation never publish the candidate', async () => {
  const { root, stateDir, project } = await fixture({ validate: async () => { throw new Error('adapter failed'); } });
  const input = { expectedRevision: await project.getRevision(), changes: [{ op: 'replace' as const, id: 'index.ts', content: 'bad' }] };
  await expect(project.applyTurn(input)).rejects.toMatchObject({ code: 'VALIDATION' });
  const controller = new AbortController(); controller.abort();
  await expect(project.applyTurn(input, { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  const timeout = await openFileTreeProject({ root, stateDir, policy: { allows: () => true }, validator: { validate: () => new Promise(() => {}) } }, { limits: { validationTimeoutMs: 5 } });
  await expect(timeout.applyTurn(input)).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(await fs.readFile(join(root, 'index.ts'), 'utf8')).toBe('before');
});
test('UTF-8 bytes, turn count and aggregate size limits refuse before a write', async () => {
  const { root, stateDir } = await fixture();
  const project = await openFileTreeProject({ root, stateDir, policy: { allows: () => true } },
    { limits: { maxFileBytes: 6, maxTreeBytes: 8, maxChanges: 1 } });
  const expectedRevision = await project.getRevision();
  for (const changes of [
    [{ op: 'replace' as const, id: 'index.ts', content: 'éééé' }],
    [{ op: 'create' as const, relativePath: 'a.ts', content: 'abc' }],
    [{ op: 'delete' as const, id: 'index.ts' }, { op: 'create' as const, relativePath: 'a.ts', content: 'x' }],
  ]) await expect(project.applyTurn({ expectedRevision, changes })).rejects.toMatchObject({ code: 'LIMIT' });
  expect(await fs.readFile(join(root, 'index.ts'), 'utf8')).toBe('before');
});
