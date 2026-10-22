import assert from 'node:assert/strict';
import { test } from 'vitest';
import { repositoryTargetError, validateCommitTarget } from '../repository-target.js';

// Generalized from repository-target.unit.test.ts and commit-site.unit.test.ts.
test('generic repository segments reject separators, controls, dots and overlong names', () => {
  for (const value of ['', '.', '..', 'a/b', 'a\\b', 'a b', 'a\tb', 'a\0b', 'a\x1fb', 'a\x7fb', 'team\n', 'x'.repeat(101)]) {
    assert.equal(repositoryTargetError({ owner: value, repo: 'valid' }), `invalid owner '${value.slice(0, 60)}'`);
    assert.equal(repositoryTargetError({ owner: 'valid', repo: value }), `invalid repo '${value.slice(0, 100)}'`);
  }
  assert.equal(repositoryTargetError({ owner: 'x'.repeat(100), repo: 'r'.repeat(100) }), null);
  assert.equal(repositoryTargetError({ owner: 'team_name', repo: 'repo.v2' }), null);
});

test('host refusal wins and a host approval still runs generic validation', () => {
  const seen: unknown[] = [];
  const target = { owner: 'a/b', repo: 'repo' };
  assert.equal(repositoryTargetError(target, { validateTarget: input => { seen.push(input); return 'host refuses owner'; } }), 'host refuses owner');
  assert.deepEqual(seen, [target]);
  assert.equal(repositoryTargetError({ owner: 'team', repo: 'a/b' }, { validateTarget: () => null }), "invalid repo 'a/b'");
});

test('commit target preserves branch and message limits independently', () => {
  const input = { owner: 'group_name', repo: 'site', commitMessage: 'x' };
  for (const branch of ['not a branch', 'topic@{1}', 'topic\tname', 'topic\n', 'x'.repeat(251)]) {
    assert.equal(validateCommitTarget(input, { branch }), `invalid branch name '${branch.slice(0, 60)}'`);
  }
  assert.equal(validateCommitTarget(input, { branch: 'release/2' }), null);
  for (const commitMessage of ['', '   ', 'x'.repeat(501)]) assert.equal(validateCommitTarget({ ...input, commitMessage }), 'commitMessage must be 1-500 characters');
  assert.equal(validateCommitTarget({ ...input, commitMessage: 'x'.repeat(500) }), null);
});
