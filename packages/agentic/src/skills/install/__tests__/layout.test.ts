import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'vitest';
import { createSkillLayout } from '../layout.js';

// Workspace ID characterization generalized from the original layout suite.
test('explicit roots and host workspace folder replace site-root resolution', () => {
  const layout = createSkillLayout({ root: '/custom/skills', stagingRoot: '/custom/staging', workspaceDirectory: 'tenants', stateFileName: '.host-install.json' });
  assert.deepEqual(layout.resolve({ workspaceId: 'WORKSPACE-LOCAL' }), { workspaceRoot: path.join('/custom/skills', 'tenants', 'workspace-local'), stagingRoot: '/custom/staging', stateFileName: '.host-install.json' });
  assert.equal(layout.resolve({ workspaceId: 'one' }).stagingRoot, '/custom/staging');
});
for (const workspaceId of ['', '..', '../escape', 'a/b', 'a\\b', '.hidden', 'a--b', 'a..b', 'a-', '-a', 'a'.repeat(65)]) {
  test(`rejects unsafe workspace segment ${JSON.stringify(workspaceId)}`, () => {
    const layout = createSkillLayout({ root: '/custom/skills', stagingRoot: '/custom/staging', workspaceDirectory: 'tenants', stateFileName: '.host-install.json' });
    assert.throws(() => layout.resolve({ workspaceId }), /not a valid workspace id/);
  });
}
test('relative roots and unsafe workspace folder are rejected', () => {
  assert.throws(() => createSkillLayout({ root: 'relative', stagingRoot: '/tmp/staging', workspaceDirectory: 'tenants', stateFileName: '.host-install.json' }), /absolute/);
  assert.throws(() => createSkillLayout({ root: '/tmp/skills', stagingRoot: 'relative', workspaceDirectory: 'tenants', stateFileName: '.host-install.json' }), /absolute/);
  assert.throws(() => createSkillLayout({ root: '/tmp/skills', stagingRoot: '/tmp/staging', workspaceDirectory: '../tenants', stateFileName: '.host-install.json' }), /segment/);
});
