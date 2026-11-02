import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/github) and split per plan v2 §5.1: the deploy workflow's
// `expected_sha` protocol, the Site key start commands and "no restore tool" are the host's and live
// in its overlay. Tovu's credential-card, source-control credential/tool-wiring, tool-discovery and
// deploy-ops registry tests stay with the host (they exercise Tovu's parsers, vault and catalog).
const root = path.resolve(import.meta.dirname, '..');

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

const readText = file => readFile(path.join(root, file), 'utf8');
const readJson = async file => JSON.parse(await readText(file));

test('every module a contribution file names ships, with the modules it imports', async () => {
  const files = await shippedFiles();
  const sourceControl = await readJson('tovu-source-control.json');
  const deployOps = await readJson('tovu-deploy-ops.json');
  const named = [...sourceControl.providers.map(provider => provider.module), ...deployOps.platforms.map(platform => platform.module)];
  assert.deepEqual(named, ['source-control/github.mjs', 'deploy-ops/github-actions.mjs']);
  for (const file of [...named, 'source-control/write-files.mjs', 'source-control/backup-push.mjs', 'source-control/commit-site.mjs', 'deployments/github.mjs']) {
    assert.ok(files.includes(file), file);
  }
});

test('the plugin adds no tool and no MCP server; it drives the host-served tools', async () => {
  assert.deepEqual((await readJson('mcp.json')).mcpServers, {});
  assert.match(await readText('skills/github/SKILL.md'), /This plugin ships no MCP server and adds no tool/);
});

test('the deploy workflow protocol is the host guidance, not the portable skill', async () => {
  const skill = await readText('skills/github/SKILL.md');
  assert.match(skill, /`deployment_ops_deploy`/);
  assert.match(skill, /platform\s+`github-actions`/);
  assert.match(skill, /the host guidance describes that workflow's own inputs and\s+refusals/);
  for (const file of (await shippedFiles()).filter(name => name.endsWith('.md'))) {
    assert.doesNotMatch(await readText(file), /expected_sha/, file);
  }
});

test('host-specific start commands and the restore promise moved out of the backup reference', async () => {
  const backup = await readText('skills/github/references/site-backup.md');
  assert.match(backup, /CREDENTIAL_UNREADABLE/);
  assert.match(backup, /Site key/);
  assert.doesNotMatch(backup, /npm run|Secrets → Site key/);
  assert.match(backup, /no restore tool unless the host guidance names one/);
});

test('the shipped prose is host-neutral and the publisher id and managed-files path are unchanged', async () => {
  const manifest = await readJson('plugin.json');
  assert.equal(manifest.extensions.tovu.id, 'tovu/github');
  assert.doesNotMatch(manifest.description, /\bTovu\b/);
  for (const file of (await shippedFiles()).filter(name => name.endsWith('.md'))) {
    assert.doesNotMatch(await readText(file), /\bTovu\b/, file);
  }
  // Frozen wire path (plan §4.3): persisted in users' repositories.
  assert.match(await readText('source-control/commit-site.mjs'), /const MANAGED_MANIFEST_PATH = "\.tovu\/managed-files\.json";/);
});
