import { describe, expect, it } from 'vitest';
import { resolvePanels } from '../manifest/rules.js';
import type { AdminPanel } from '../manifest/types.js';

const panel = (id: string, extra: Partial<AdminPanel> = {}): AdminPanel => ({ id, description: `Manage ${id}.`, render: null, ...extra });
const panels = [panel('open'), panel('users', { permissions: ['users.read'] }), panel('both', { permissions: ['b.x'], anyOfPermissions: ['b.y'] })];
const ids = (list: readonly AdminPanel[]): string[] => list.map((p) => p.id);

/**
 * T10: pinned against the code as it was before the panel-access rules landed. `resolvePanels` is
 * shared by other callers and must keep applying all-of `permissions` and ignoring `anyOfPermissions`:
 * the shell's any-of handling lives in the shell model, not here.
 */
describe('resolvePanels with all-of permissions (unchanged by the panel-access rules)', () => {
  it('drops an all-of panel when no permissions argument is given (a missing argument means none held)', () => {
    expect(ids(resolvePanels({ panels }))).toEqual(['open']);
  });

  it('keeps an all-of panel whose permission is held, and ignores anyOfPermissions', () => {
    expect(ids(resolvePanels({ panels }, { permissions: ['users.read', 'b.x'] }))).toEqual(['open', 'users', 'both']);
  });

  it('keeps every all-of panel for the owner wildcard', () => {
    expect(ids(resolvePanels({ panels }, { permissions: ['*'] }))).toEqual(['open', 'users', 'both']);
  });
});
