import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as install from '../index.js';

// This is the import surface promised by skills-install-extraction.md and the rewire ledger.
test('the skill installation barrel exposes layout, storage policy and live registration helpers', () => {
  for (const name of [
    'createSkillLayout', 'createSkillInstaller', 'createLiveSkillRegistration',
    'createSkillRefresher', 'createSkillRefreshMiddleware', 'decodeSkillBase64',
    'validateSkillPath', 'validateSkillMarkdown', 'validateSkillFiles',
    'readSkillArchive', 'fetchGitHubSkill', 'readSkillState',
  ]) {
    assert.equal(Object.hasOwn(install, name), true, name + ' must be available from skills/install');
    assert.equal(typeof Reflect.get(install, name), 'function', name + ' must be callable');
  }
});

