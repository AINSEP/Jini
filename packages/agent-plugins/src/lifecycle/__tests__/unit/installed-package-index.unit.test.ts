/** `createInstalledPackageIndex().indexInstalledRoot()` — reading one installed package's manifest and file tree. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentPluginInstallError } from '../../install-errors.js';
import { createInstalledPackageIndex } from '../../installed-package-index.js';
import type { AgentPluginLifecyclePorts } from '../../ports.js';
import { forceRemove } from '../fixtures/force-remove.js';
import { ports } from '../test-support.js';

const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const DIGEST = 'a'.repeat(64);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await forceRemove(root); });

async function packageRoot(files: Record<string, string> = {}): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'jini-package-index-')));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
  return root;
}
const manifest = (fields: Record<string, unknown> = {}) => JSON.stringify({ $schema: SCHEMA, name: 'my-plugin', ...fields });
const index = (root: string, host: AgentPluginLifecyclePorts = ports) => createInstalledPackageIndex({ ports: host }).indexInstalledRoot({ packageRoot: root, archiveDigest: DIGEST });

describe('indexInstalledRoot refusals', () => {
  it('reports MANIFEST_MISSING when plugin.json is absent', async () => {
    await expect(index(await packageRoot())).rejects.toMatchObject({ code: 'MANIFEST_MISSING', message: 'the archive does not contain a plugin.json at its root' });
  });

  it('propagates a plugin.json read fault other than a missing file', async () => {
    const root = await packageRoot();
    await mkdir(path.join(root, 'plugin.json'));
    await expect(index(root)).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('reports MANIFEST_INVALID with the parse error as cause for malformed JSON', async () => {
    const error = await index(await packageRoot({ 'plugin.json': '{' })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentPluginInstallError);
    expect(error).toMatchObject({ code: 'MANIFEST_INVALID', message: 'plugin.json is not valid JSON', cause: expect.any(SyntaxError) });
  });

  it('reports MANIFEST_INVALID with the validation errors for a manifest that fails the grammar', async () => {
    await expect(index(await packageRoot({ 'plugin.json': JSON.stringify({ $schema: SCHEMA }) })))
      .rejects.toMatchObject({ code: 'MANIFEST_INVALID', message: "plugin.json failed validation: plugin.json 'name' is required and must be a string" });
  });
});

describe('indexInstalledRoot results', () => {
  it('indexes every regular file sorted and every skill sorted by name', async () => {
    const root = await packageRoot({ 'plugin.json': manifest(), 'skills/zeta/SKILL.md': '#', 'skills/alpha/SKILL.md': '#', 'skills/alpha/notes.md': '' });
    const indexed = await index(root);
    expect(indexed.files).toEqual(['plugin.json', 'skills/alpha/SKILL.md', 'skills/alpha/notes.md', 'skills/zeta/SKILL.md']);
    expect(indexed.skills).toEqual([{ name: 'alpha', skillPath: 'skills/alpha/SKILL.md' }, { name: 'zeta', skillPath: 'skills/zeta/SKILL.md' }]);
  });

  it('skips an entry that is neither a directory nor a regular file', async () => {
    const root = await packageRoot({ 'plugin.json': manifest() });
    await symlink(path.join(root, 'plugin.json'), path.join(root, 'link.json'));
    expect((await index(root)).files).toEqual(['plugin.json']);
  });

  it('omits every optional manifest field the manifest does not declare', async () => {
    expect(await index(await packageRoot({ 'plugin.json': manifest() }))).toEqual({
      pluginId: 'my-plugin', id: 'unknown/my-plugin', provides: [], version: undefined,
      archiveDigest: DIGEST, packageRoot: expect.any(String), files: ['plugin.json'], skills: [],
    });
  });

  it('carries description, keywords, author and license through', async () => {
    const indexed = await index(await packageRoot({ 'plugin.json': manifest({ description: 'd', keywords: ['k'], author: 'a', license: 'MIT' }) }));
    expect(indexed).toMatchObject({ description: 'd', keywords: ['k'], author: 'a', license: 'MIT' });
  });

  it('trims and caps the host displayName and summary', async () => {
    const extensions = { [ports.extensionNamespace]: { displayName: `  ${'n'.repeat(70)}  `, summary: ` ${'s'.repeat(1300)} ` } };
    const indexed = await index(await packageRoot({ 'plugin.json': manifest({ extensions }) }));
    expect([indexed.displayName, indexed.summary]).toEqual(['n'.repeat(64), 's'.repeat(1200)]);
  });

  it('ignores a non-string or blank displayName and summary', async () => {
    const extensions = { [ports.extensionNamespace]: { displayName: 7, summary: '   ' } };
    const indexed = await index(await packageRoot({ 'plugin.json': manifest({ extensions }) }));
    expect(['displayName' in indexed, 'summary' in indexed]).toEqual([false, false]);
  });

  it('reports each manifest identity warning as an event', async () => {
    const events: string[] = [];
    await index(await packageRoot({ 'plugin.json': manifest() }), { ...ports, onEvent: ({ message }) => events.push(message) });
    expect(events).toEqual(["Plugin 'my-plugin' has no publisher-qualified id; using 'unknown/my-plugin'."]);
  });
});
