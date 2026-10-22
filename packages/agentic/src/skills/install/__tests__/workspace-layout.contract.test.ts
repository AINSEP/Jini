// PARITY: relocated behavior contract retains its original assertions.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'vitest';
import { createSkillLayout } from '../layout.js';
const required = { root: '/var/lib/skills', stagingRoot: '/var/lib/staging', workspaceDirectory: 'workspaces', stateFileName: '.installed.json' };
test('explicit layout implements the installer resolve contract with disjoint workspaces', () => {
  const layout = createSkillLayout(required);
  assert.deepEqual(layout.resolve({ workspaceId: 'WORKSPACE-LOCAL' }), { workspaceRoot: path.join(required.root, 'workspaces', 'workspace-local'), stagingRoot: path.resolve(required.stagingRoot), stateFileName: '.installed.json' });
  assert.notEqual(layout.resolve({ workspaceId: 'one' }).workspaceRoot, layout.resolve({ workspaceId: 'two' }).workspaceRoot);
});
test('rejects relative roots and every escaping workspace shape', () => {
  assert.throws(() => createSkillLayout({ ...required, root: 'relative' }), /absolute/);
  assert.throws(() => createSkillLayout({ ...required, stagingRoot: 'relative' }), /absolute/);
  const layout = createSkillLayout(required);
  for (const workspaceId of ['../escape', '..', '.', '', 'a/b', 'a\\b', 'a b', '-leading', 'trailing-', 'a--b', 'a_b', 'a'.repeat(65)]) assert.throws(() => layout.resolve({ workspaceId }), /workspace id/);
});
test('requires a safe directory and state filename without reserved bundle collisions', () => {
  for (const workspaceDirectory of ['', '..', '../outside']) assert.throws(() => createSkillLayout({ ...required, workspaceDirectory }));
  for (const stateFileName of ['', '..', 'a/b', 'a\\b', 'SKILL.md', 'references']) assert.throws(() => createSkillLayout({ ...required, stateFileName }));
});
