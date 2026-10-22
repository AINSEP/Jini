import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createSkillInstaller } from '../install-service.js';
import { createNodeSkillFilesystem } from '../node-filesystem.js';
import type { SkillFilesystemPort } from '../ports.js';

for (const failurePoint of ['partial write', 'rename'] as const) {
  test(`enable failure during ${failurePoint} removes temporary state and permits a retry`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skill-state-cleanup-'));
    try {
      const native = createNodeSkillFilesystem({});
      const directory = path.join(root, 'incident-response');
      const stateFileName = '.host-install.json';
      const statePath = path.join(directory, stateFileName);
      const source = { githubUrl: 'https://github.com/acme/skills', commit: 'a'.repeat(40) };
      const original = JSON.stringify({ enabled: true, source });
      await native.mkdir({ path: directory });
      await writeFile(statePath, original);
      const failure = new Error(`injected ${failurePoint} failure`);
      let failOnce = true;
      let sequence = 0;
      let notifications = 0;
      const filesystem: SkillFilesystemPort = {
        ...native,
        async writeFile(input) {
          if (failurePoint === 'partial write' && failOnce) {
            failOnce = false;
            // A filesystem can create a file before rejecting its write. Returning only an
            // error without creating partial bytes would miss the leaked-file regression.
            await native.writeFile({ ...input, bytes: input.bytes.subarray(0, 8) });
            throw failure;
          }
          await native.writeFile(input);
        },
        async rename(input) {
          if (failurePoint === 'rename' && failOnce) {
            failOnce = false;
            throw failure;
          }
          await native.rename(input);
        },
      };
      const api = createSkillInstaller({
        filesystem,
        layout: { resolve: () => ({ workspaceRoot: root, stagingRoot: path.join(root, 'staging'), stateFileName }) },
        ids: { next: () => `id-${++sequence}` },
        toolId: ({ name }) => `skill_${name.replace(/-/g, '_')}`,
        toolSourceLoader: { load: async () => [{
          id: 'skill_incident_response', skillName: 'incident-response',
          description: 'Respond to outages.', directory: 'incident-response',
        }] },
        archiveReader: { open: async () => { throw new Error('unexpected archive'); } },
        yamlReader: { read: () => { throw new Error('unexpected YAML'); } },
        fetch: async () => { throw new Error('unexpected fetch'); },
      }, { onChanged: () => { notifications++; } });
      const input = { workspaceId: 'workspace-local', toolId: 'skill_incident_response', enabled: false };

      await assert.rejects(api.setSkillEnabled(input), error => error === failure);
      assert.deepEqual(await readdir(directory), [stateFileName]);
      assert.equal(await readFile(statePath, 'utf8'), original);
      assert.equal(notifications, 0);

      // The rejected mutation must release its queue, leaving the original state available
      // for the next attempt and preserving provenance when the replacement finally lands.
      await api.setSkillEnabled(input);
      assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), { enabled: false, source });
      assert.deepEqual(await readdir(directory), [stateFileName]);
      assert.equal(notifications, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
