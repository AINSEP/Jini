import { describe, expect, it } from 'vitest';
import { createSkillLayout } from '../layout.js';

/** L9 §4 layout.ts: workspace-directory and workspace-id segment grammar (anchors, separators,
 *  64/65 length) and the state-file-name refusals, each on its own. */
const base = { root: '/r', stagingRoot: '/s', workspaceDirectory: 'tenants', stateFileName: '.state.json' };

describe('createSkillLayout', () => {
  it.each(['a', 'a-b', 'a.b', 'a1-b2.c3'])('workspace directory %j accepted', (workspaceDirectory) => {
    expect(() => createSkillLayout({ ...base, workspaceDirectory })).not.toThrow();
  });
  it.each(['', 'A', 'a--b', 'a.', '-a', 'a_b', 'a/b', 'a b', 'a\n', '..'])('workspace directory %j refused', (workspaceDirectory) => {
    expect(() => createSkillLayout({ ...base, workspaceDirectory })).toThrow('Invalid workspace directory segment.');
  });
  it.each(['', 'a/b', 'a\\b', 'a\0', '.', '..', 'SKILL.md', 'README.md', 'LICENSE', 'references', 'scripts', 'assets'])('state file %j refused', (stateFileName) => {
    expect(() => createSkillLayout({ ...base, stateFileName })).toThrow('Invalid skill state file name.');
  });
  it('relative roots are refused', () => {
    expect(() => createSkillLayout({ ...base, root: 'r' })).toThrow('Skill roots must be absolute paths.');
    expect(() => createSkillLayout({ ...base, stagingRoot: 's' })).toThrow('Skill roots must be absolute paths.');
  });
});

describe('resolve', () => {
  const layout = createSkillLayout(base);
  it('lower-cases a valid id and joins under the workspace directory', () => {
    expect(layout.resolve({ workspaceId: 'WS-1.a' })).toEqual({ workspaceRoot: '/r/tenants/ws-1.a', stagingRoot: '/s', stateFileName: '.state.json' });
    expect(layout.resolve({ workspaceId: 'w'.repeat(64) }).workspaceRoot).toBe(`/r/tenants/${'w'.repeat(64)}`);
  });
  it.each(['w'.repeat(65), '', '../x', 'a/b', 'a--b', 'a.', 'a b', 'a\n'])('refuses id %j naming it', (workspaceId) => {
    expect(() => layout.resolve({ workspaceId })).toThrow(`resolve: '${workspaceId}' is not a valid workspace id`);
  });
});
