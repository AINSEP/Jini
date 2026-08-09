import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../components/Sidebar.js';
import { buildNav } from '../../../core/manifest/rules.js';
import type { AdminPanel } from '../../../core/manifest/types.js';

/**
 * @file Collapsible nav sections (`SidebarNav`'s `collapsibleGroups`). The persistence mechanics
 * live in `hooks/use-nav-sections.test.tsx`; this file covers only what the component decides —
 * which heading becomes a control, what that control hides, and the rail-mode override.
 */

const panels: AdminPanel<null>[] = [
  { id: 'dashboard', render: null, nav: { label: 'Dashboard', icon: '<path d="M1 1" />' } },
  { id: 'posts', render: null, nav: { label: 'Posts', group: 'Content', order: 1 } },
  { id: 'users', render: null, nav: { label: 'Users', group: 'People', order: 1 } },
  { id: 'roles', render: null, nav: { label: 'Roles', group: 'People', order: 2 } },
];

const groups = buildNav(panels);

function renderNav(collapsibleGroups?: readonly string[], railStorageKey?: string) {
  return render(
    <Sidebar activeId="posts" open={false} {...(railStorageKey ? { railStorageKey } : {})}>
      <Sidebar.Nav groups={groups} {...(collapsibleGroups ? { collapsibleGroups } : {})} />
      <Sidebar.RailToggle />
    </Sidebar>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Sidebar collapsible sections', () => {
  it('leaves every heading a plain label when the host opts out (default)', () => {
    renderNav();
    // The additive guarantee: a host that never passes `collapsibleGroups` gets the old DOM, so
    // no existing product sprouts an accordion it did not ask for.
    expect(screen.queryByRole('button', { name: /People/i })).toBeNull();
    expect(screen.getByText('Users')).toBeVisible();
  });

  it('turns only the named group into a button, leaving the others alone', () => {
    renderNav(['People']);
    expect(screen.getByRole('button', { name: /People/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Content/i })).toBeNull();
  });

  it('starts open and hides the section items when pressed', () => {
    renderNav(['People']);
    const toggle = screen.getByRole('button', { name: /People/i });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Users')).toBeVisible();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // `hidden` removes the row from the accessibility tree, which is what `toBeVisible` reflects —
    // asserting on that rather than on absence from the DOM, since the panel stays mounted so
    // `aria-controls` keeps pointing at a real element.
    expect(screen.getByText('Users')).not.toBeVisible();
    // A different group must be untouched by its neighbour collapsing.
    expect(screen.getByText('Posts')).toBeVisible();
  });

  it('points aria-controls at the element that actually holds the items', () => {
    renderNav(['People']);
    const toggle = screen.getByRole('button', { name: /People/i });
    const panelId = toggle.getAttribute('aria-controls');

    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId as string);
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain('Users');
  });

  it('reopens on a second press', () => {
    renderNav(['People']);
    const toggle = screen.getByRole('button', { name: /People/i });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.getByText('Users')).toBeVisible();
  });

  it('force-expands in rail mode, so a closed section cannot strand its items', () => {
    // The failure this guards: collapsed to a rail, the heading renders as a 1px divider with no
    // visible label, so a closed section would be missing nav items with no control on screen to
    // restore them. The stored preference is deliberately ignored for rendering, not erased.
    localStorage.setItem('jini-admin-nav-sections', JSON.stringify({ People: false }));
    localStorage.setItem('rail-key', '1');

    renderNav(['People'], 'rail-key');

    expect(screen.queryByRole('button', { name: /People/i })).toBeNull();
    expect(screen.getByText('Users')).toBeVisible();
  });

  it('restores the closed state once the rail expands again', () => {
    localStorage.setItem('jini-admin-nav-sections', JSON.stringify({ People: false }));
    renderNav(['People'], 'rail-key-2');

    // Expanded rail (no stored '1'): the preference applies again, proving rail mode overrode the
    // rendering without discarding what the user chose.
    expect(screen.getByRole('button', { name: /People/i }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Users')).not.toBeVisible();
  });
});
