import { afterEach, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentPluginLayout } from '../../layout.js';
import { createSeedBundledModule } from '../../seed-bundled.js';
import { createInstallModule, type AgentPluginArchiveReaderPort } from '../../install.js';
import { createBundledDigestsModule } from '../../bundled-digests.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

/**
 * @file Bundled reseeding never deletes a same-name revision (open bug "reseeding prunes
 * operator/uploaded same-name copies", install.ts prune after every publish). The ledger digest of
 * the previous boot is NOT proof of unchanged bytes: an operator can edit that directory in place,
 * so seeding prunes nothing and the ledger only selects. Explicit installs keep pruning.
 */

const PLUGIN = 'keeper';
const temporaries: string[] = [];
afterEach(async () => { for (const dir of temporaries.splice(0)) await forceRemove(dir); });

async function tempDir(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'seed-preserve-')));
  temporaries.push(dir);
  return dir;
}

/** One bundled build's source tree: a fresh root holding `keeper/` at the given version. */
async function bundledSource(version: string): Promise<string> {
  const root = await tempDir();
  const skills = path.join(root, PLUGIN, 'skills', PLUGIN);
  await fs.mkdir(skills, { recursive: true });
  await fs.writeFile(path.join(root, PLUGIN, 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: PLUGIN, version }));
  await fs.writeFile(path.join(skills, 'SKILL.md'), `# Keeper ${version}\n`);
  return root;
}

async function workspaceFixture() {
  const layout = createAgentPluginLayout({ root: await tempDir() });
  const effective = { ...ports, layout, onEvent: () => undefined };
  const { seedBundledAgentPlugins } = createSeedBundledModule(effective);
  const { installAgentPlugin } = createInstallModule(effective);
  const digests = createBundledDigestsModule(effective);
  const workspace = layout.forWorkspace({ workspaceId: 'ws' });
  const packagesDir = workspace.pluginPackagesDir({ pluginId: PLUGIN });

  async function seed(sourceRoot: string): Promise<string> {
    const report = await seedBundledAgentPlugins({ layout, workspaceId: 'ws', sourceRoot });
    const [outcome] = report.outcomes;
    if (outcome?.status !== 'seeded') throw new Error(`seed failed: ${JSON.stringify(report)}`);
    expect(report.ledgerFailure).toBeUndefined();
    return outcome.archiveDigest;
  }

  /** An operator upload of the same plugin name with its own bytes (explicit install path). */
  async function upload(version: string, optional: { prune?: boolean } = {}): Promise<string> {
    const archive = Buffer.from(JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: PLUGIN, version }));
    const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
      yield { kind: 'file', entryPath: 'plugin.json', declaredSize: archive.length, executable: false, async *openReadStream() { yield archive; } };
    } };
    const installed = await installAgentPlugin(
      { archive, expectedSha256: createHash('sha256').update(archive).digest('hex'), archiveReader, layout, workspaceId: 'ws' },
      optional.prune === undefined ? {} : { pruneSupersededRevisions: optional.prune },
    );
    return installed.archiveDigest;
  }

  /** Edits a published (frozen read-only) revision in place, the way an operator with shell access can. */
  async function operatorEdit(digest: string, text: string): Promise<string> {
    const skillDir = path.join(packagesDir, digest, 'skills', PLUGIN);
    const file = path.join(skillDir, 'SKILL.md');
    await fs.chmod(skillDir, 0o755);
    await fs.chmod(file, 0o644);
    await fs.writeFile(file, text);
    return file;
  }

  const revisions = async () => (await fs.readdir(packagesDir)).sort();
  const ledgerDigest = async () => (await digests.readBundledAgentPluginDigests(workspace.root)).get(PLUGIN);
  async function selected(): Promise<readonly string[]> {
    const installed = (await revisions()).map(archiveDigest => ({ pluginId: PLUGIN, archiveDigest }));
    const ledger = await digests.readBundledAgentPluginDigests(workspace.root);
    return digests.preferBundledAgentPluginDigests(installed, ledger).map(item => item.archiveDigest);
  }

  return { seed, upload, operatorEdit, revisions, ledgerDigest, selected, packagesDir };
}

describe('bundled reseeding preserves every same-name revision', () => {
  test('an edited ledger-recorded revision, an upload and an older bundled revision survive two reseeds', async () => {
    const ws = await workspaceFixture();
    const uploaded = await ws.upload('0.9.0-operator');
    const olderBundled = await ws.seed(await bundledSource('1.0.0'));
    const previousBundled = await ws.seed(await bundledSource('1.1.0'));
    expect(await ws.ledgerDigest()).toBe(previousBundled);
    // The revision the ledger names, edited in place: its digest no longer describes its bytes.
    const edited = await ws.operatorEdit(previousBundled, '# Keeper, operator-tuned\n');

    const nextSource = await bundledSource('2.0.0');
    const current = await ws.seed(nextSource);
    expect(await ws.seed(nextSource)).toBe(current);

    expect(new Set([uploaded, olderBundled, previousBundled, current]).size).toBe(4);
    expect(await ws.revisions()).toEqual([uploaded, olderBundled, previousBundled, current].sort());
    expect(await fs.readFile(edited, 'utf8')).toBe('# Keeper, operator-tuned\n');
    expect(await ws.ledgerDigest()).toBe(current);
    expect(await ws.selected()).toEqual([current]);
  });

  test('a same-build reseed reinstalls pristine bytes and keeps the edited copy aside, unselected', async () => {
    const ws = await workspaceFixture();
    const source = await bundledSource('1.0.0');
    const bundled = await ws.seed(source);
    // Same build, same digest directory: its name alone no longer proves the shipped bytes.
    const edited = await ws.operatorEdit(bundled, '# Keeper, operator-tuned\n');

    expect(await ws.seed(source)).toBe(bundled);

    expect(await fs.readFile(edited, 'utf8')).toBe('# Keeper 1.0.0\n');
    const entries = await ws.revisions();
    const aside = entries.filter(name => name !== bundled);
    expect(entries).toContain(bundled);
    expect(aside).toHaveLength(1);
    expect(aside[0]).not.toMatch(/^[a-f0-9]{64}$/);
    expect(await fs.readFile(path.join(ws.packagesDir, aside[0]!, 'skills', PLUGIN, 'SKILL.md'), 'utf8')).toBe('# Keeper, operator-tuned\n');
    expect(await ws.selected()).toEqual([bundled]);
  });

  test('an upload installed after seeding survives the next reseed and stays unselected', async () => {
    const ws = await workspaceFixture();
    const source = await bundledSource('1.0.0');
    const bundled = await ws.seed(source);
    const uploaded = await ws.upload('1.0.0-custom');
    // The explicit upload pruned the bundled revision (unchanged default); the reseed restores it
    // beside the upload instead of deleting the upload.
    expect(await ws.revisions()).toEqual([uploaded]);
    expect(await ws.seed(source)).toBe(bundled);
    expect(await ws.revisions()).toEqual([bundled, uploaded].sort());
    expect(await ws.selected()).toEqual([bundled]);
  });

  test('explicit install keeps pruning every other revision unless the caller opts out', async () => {
    const ws = await workspaceFixture();
    const first = await ws.seed(await bundledSource('1.0.0'));
    const second = await ws.seed(await bundledSource('1.1.0'));
    const kept = await ws.upload('3.0.0', { prune: false });
    expect(await ws.revisions()).toEqual([first, second, kept].sort());
    const replacement = await ws.upload('4.0.0');
    expect(await ws.revisions()).toEqual([replacement]);
  });
});
