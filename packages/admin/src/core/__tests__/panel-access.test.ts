import { describe, expect, it } from 'vitest';
import type { AdminNavGroup } from '../manifest/rules.js';
import { isPanelAccessible, withoutInaccessiblePanels } from '../permissions/rules.js';

/** The built-in editor role's grants: copied as data from a host's panel-access table (T6). */
const EDITOR = ['content.read', 'content.write', 'content.publish', 'content.delete', 'media.read', 'media.upload', 'media.update', 'media.delete', 'theme.set'];
const USERS = { anyOfPermissions: ['user.manage', 'member.manage'] } as const;

const navIds = (groups: readonly AdminNavGroup[]): string[] => groups.flatMap((group) => group.items.map((item) => item.id));

describe('isPanelAccessible', () => {
  it('T1: any-of with one held permission is accessible; with none it is not', () => {
    expect(isPanelAccessible({ panel: USERS, permissions: ['member.manage'] })).toBe(true);
    expect(isPanelAccessible({ panel: USERS, permissions: ['user.manage'] })).toBe(true);
    expect(isPanelAccessible({ panel: USERS, permissions: EDITOR })).toBe(false);
  });

  it('T2: the owner wildcard satisfies any-of and all-of', () => {
    expect(isPanelAccessible({ panel: { anyOfPermissions: ['role.manage'] }, permissions: ['*'] })).toBe(true);
    expect(isPanelAccessible({ panel: { permissions: ['a.x', 'a.y'] }, permissions: ['*'] })).toBe(true);
  });

  it('T3: unknown permissions (undefined) show every panel, even one declaring both kinds', () => {
    const both = { permissions: ['b.x'], anyOfPermissions: ['b.y'] };
    expect(isPanelAccessible({ panel: both, permissions: undefined })).toBe(true);
    expect(isPanelAccessible({ panel: USERS, permissions: undefined })).toBe(true);
  });

  it('T4: empty permissions hide a panel that declares any-of (empty is not unknown)', () => {
    expect(isPanelAccessible({ panel: USERS, permissions: [] })).toBe(false);
    expect(isPanelAccessible({ panel: { permissions: ['a.x'] }, permissions: [] })).toBe(false);
  });

  it('a panel that declares nothing is accessible to everyone, including an empty grant list', () => {
    expect(isPanelAccessible({ panel: {}, permissions: [] })).toBe(true);
    expect(isPanelAccessible({ panel: { anyOfPermissions: [], permissions: [] }, permissions: [] })).toBe(true);
  });

  it('all-of requires every listed permission', () => {
    const panel = { permissions: ['l.x', 'l.y'] };
    expect(isPanelAccessible({ panel, permissions: ['l.x', 'l.y'] })).toBe(true);
    expect(isPanelAccessible({ panel, permissions: ['l.x'] })).toBe(false);
  });

  it('T5: when both are declared, both must pass and neither short-circuits the other', () => {
    const panel = { permissions: ['b.x'], anyOfPermissions: ['b.y', 'b.z'] };
    expect(isPanelAccessible({ panel, permissions: ['b.x', 'b.z'] })).toBe(true);
    expect(isPanelAccessible({ panel, permissions: ['b.x'] })).toBe(false); // all-of ok, any-of fails
    expect(isPanelAccessible({ panel, permissions: ['b.y'] })).toBe(false); // any-of ok, all-of fails
  });
});

describe('withoutInaccessiblePanels', () => {
  const panels = [
    { id: 'dashboard' }, { id: 'posts' }, { id: 'users', ...USERS }, { id: 'roles', anyOfPermissions: ['role.manage'] },
    { id: 'audit', permissions: ['audit.read', 'audit.export'] },
  ];
  const groups: readonly AdminNavGroup[] = [
    { items: [{ id: 'dashboard', href: '/', label: 'Overview' }] },
    { label: 'People', items: [{ id: 'users', href: '/users', label: 'Users' }, { id: 'roles', href: '/roles', label: 'Roles' }] },
    { label: 'Content', items: [{ id: 'posts', href: '/posts', label: 'Posts' }, { id: 'audit', href: '/audit', label: 'Audit' }] },
  ];

  it('T6: an editor loses the People rows and the all-of audit row; content stays', () => {
    const ids = navIds(withoutInaccessiblePanels({ groups, panels, permissions: EDITOR }));
    expect(ids).toEqual(['dashboard', 'posts']);
  });

  it('T6: the owner sees every row unchanged', () => {
    expect(withoutInaccessiblePanels({ groups, panels, permissions: ['*'] })).toEqual(groups);
  });

  it('T3: returns the identical groups object while permissions are unknown', () => {
    expect(withoutInaccessiblePanels({ groups, panels, permissions: undefined })).toBe(groups);
  });

  it('drops a group once every row in it is hidden and keeps the ungrouped top row first', () => {
    const filtered = withoutInaccessiblePanels({ groups, panels, permissions: EDITOR });
    expect(filtered.map((group) => group.label)).toEqual([undefined, 'Content']);
  });

  it('keeps a row whose id names no registered panel', () => {
    const orphan: readonly AdminNavGroup[] = [{ items: [{ id: 'not-a-panel', href: '/x', label: 'X' }] }];
    expect(navIds(withoutInaccessiblePanels({ groups: orphan, panels, permissions: [] }))).toEqual(['not-a-panel']);
  });
});
