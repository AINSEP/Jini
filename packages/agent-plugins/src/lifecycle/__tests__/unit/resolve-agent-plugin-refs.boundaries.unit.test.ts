/** Boundary cases of `resolve-agent-plugin-refs.ts` over a hand-built installed-package layout. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { forceRemove } from '../fixtures/force-remove.js';
import { isInstalledDigestPresent, listInstalledPlugins, resolveAgentPluginRefs } from '../test-support.js';

const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await forceRemove(root); });

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'jini-resolve-refs-')));
  roots.push(root);
  return root;
}
/** Writes one installed revision directly: `<root>/<localId>/package/sha256/<digest>/…`. */
async function installed(root: string, localId: string, digest: string, files: Record<string, string>): Promise<void> {
  const packageRoot = path.join(root, localId, 'package', 'sha256', digest);
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(packageRoot, relative)), { recursive: true });
    await writeFile(path.join(packageRoot, relative), content);
  }
}
const manifest = (name: string) => JSON.stringify({ $schema: SCHEMA, name });

describe('isInstalledDigestPresent', () => {
  it('is false for a name outside the digest grammar', async () => {
    const root = await workspace();
    await mkdir(path.join(root, 'not-a-digest'));
    expect(await isInstalledDigestPresent(root, 'not-a-digest')).toBe(false);
  });
  it('is true for an existing digest directory', async () => {
    const root = await workspace();
    await mkdir(path.join(root, DIGEST_A));
    expect(await isInstalledDigestPresent(root, DIGEST_A)).toBe(true);
  });
  it('is false for a regular file at the digest path', async () => {
    const root = await workspace();
    await writeFile(path.join(root, DIGEST_A), '');
    expect(await isInstalledDigestPresent(root, DIGEST_A)).toBe(false);
  });
  it('is false for a missing digest directory', async () => {
    expect(await isInstalledDigestPresent(await workspace(), DIGEST_A)).toBe(false);
  });
});

describe('listInstalledPlugins', () => {
  it('excludes a revision whose manifest name differs from its folder', async () => {
    const root = await workspace();
    await installed(root, 'folder-name', DIGEST_A, { 'plugin.json': manifest('other-name') });
    expect(await listInstalledPlugins(root)).toEqual([]);
  });
  it('isolates a revision without a readable manifest and keeps the others', async () => {
    const root = await workspace();
    await installed(root, 'my-plugin', DIGEST_A, { 'notes.txt': '' });
    await installed(root, 'my-plugin', DIGEST_B, { 'plugin.json': manifest('my-plugin') });
    expect((await listInstalledPlugins(root)).map(plugin => plugin.archiveDigest)).toEqual([DIGEST_B]);
  });
});

describe('resolveAgentPluginRefs inventory note', () => {
  it('appends the skill reader note when the supporting-file inventory is incomplete', async () => {
    const root = await workspace();
    const deep = `${Array.from({ length: 33 }, (_, index) => `d${index}`).join('/')}/deep.md`;
    await installed(root, 'my-plugin', DIGEST_A, { 'plugin.json': manifest('my-plugin'), 'skills/my-plugin/SKILL.md': '# Skill', [`skills/my-plugin/${deep}`]: 'deep' });
    const result = await resolveAgentPluginRefs(['my-plugin'], { root, packages: path.join(root, 'packages') }, 'inject');
    expect(result.ok && result.promptPrefix).toContain('files: []\nSupporting-file inventory is incomplete: traversal limit reached or a directory is unreadable.\n<</AGENT_PLUGIN>>');
  });
});
