import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar, useSidebar } from '../../components/Sidebar.js';
import { buildNav } from '../../../core/manifest/rules.js';
import type { AdminPanel } from '../../../core/manifest/types.js';

const panels: AdminPanel<null>[] = [
  { id: 'dashboard', render: null, nav: { label: 'Dashboard', icon: '<path d="M1 1" />' } },
  { id: 'posts', render: null, nav: { label: 'Posts', group: 'Content', order: 1 } },
  { id: 'media', render: null, nav: { label: 'Media', group: 'Content', order: 2 } },
  { id: 'billing', render: null, nav: { label: 'Billing', group: 'Content', order: 3, soon: true } },
];

const groups = buildNav(panels);

/** The full composition, as a host would write it. Individual tests compose less on purpose. */
function renderSidebar(
  overrides: {
    activeId?: string;
    base?: string;
    open?: boolean;
    railStorageKey?: string;
    onClose?: () => void;
    footer?: ReactNode;
  } = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const result = render(
    <Sidebar
      activeId={overrides.activeId ?? 'posts'}
      {...(overrides.base === undefined ? {} : { base: overrides.base })}
      open={overrides.open ?? false}
      {...(overrides.railStorageKey === undefined ? {} : { railStorageKey: overrides.railStorageKey })}
    >
      <Sidebar.MobileHeader onClose={onClose} />
      <Sidebar.Nav groups={groups} />
      <Sidebar.Footer>
        <Sidebar.RailToggle />
        {overrides.footer}
      </Sidebar.Footer>
    </Sidebar>,
  );
  return { ...result, onClose };
}

beforeEach(() => {
  localStorage.clear();
});

describe('Sidebar composition', () => {
  it('renders only the parts the host composed — nothing is mandatory', () => {
    render(
      <Sidebar activeId="posts">
        <Sidebar.Nav groups={groups} />
      </Sidebar>,
    );
    expect(screen.getByRole('link', { name: 'Posts' })).toBeInTheDocument();
    // No mobile header, no footer, no rail toggle — the host did not ask for them.
    expect(screen.queryByRole('button', { name: 'Close navigation' })).toBeNull();
    expect(screen.queryByRole('button', { name: /sidebar/i })).toBeNull();
    expect(document.querySelector('.cms-foot')).toBeNull();
  });

  it('lets the host order and interleave its own children', () => {
    render(
      <Sidebar activeId="posts">
        <div data-testid="workspace-switcher">Acme</div>
        <Sidebar.Nav groups={groups} />
      </Sidebar>,
    );
    const nav = screen.getByRole('navigation', { name: 'Admin' });
    expect(nav.children[0]).toHaveAttribute('data-testid', 'workspace-switcher');
  });

  it('throws a named error when a part is used outside a Sidebar', () => {
    // Runtime rather than compile-time, by design — see the component's file header.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Sidebar.Nav groups={groups} />)).toThrow(/must be rendered inside a <Sidebar>/);
    vi.restoreAllMocks();
  });

  it('exposes rail state and tooltip handlers to a host component via useSidebar', () => {
    function HostLogout() {
      const { collapsed, railTooltipProps } = useSidebar();
      return (
        <button type="button" className="cms-logout" data-collapsed={collapsed} {...railTooltipProps('Log out')}>
          Log out
        </button>
      );
    }
    render(
      <Sidebar activeId="posts">
        <Sidebar.Nav groups={groups} />
        <Sidebar.Footer>
          <Sidebar.RailToggle />
          <HostLogout />
        </Sidebar.Footer>
      </Sidebar>,
    );
    const logout = screen.getByRole('button', { name: 'Log out' });
    expect(logout).toHaveAttribute('data-collapsed', 'false');

    // A host's own button still gets rail tooltips — that behavior is not lost by the button not
    // being ours, which is the whole point of exporting the context.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(logout).toHaveAttribute('data-collapsed', 'true');
    fireEvent.mouseEnter(logout);
    expect(document.querySelector('.cms-tooltip-portal')?.textContent).toBe('Log out');
  });
});

describe('Sidebar.Nav', () => {
  it('renders the groups buildNav produced, ungrouped row first', () => {
    renderSidebar();
    expect(screen.getAllByText('Content')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Posts' })).toBeInTheDocument();
  });

  it('applies the admin base to each route path', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/admin/');
    expect(screen.getByRole('link', { name: 'Posts' })).toHaveAttribute('href', '/admin/posts');
  });

  it('honours a host-supplied base rather than hardcoding /admin', () => {
    renderSidebar({ base: '/manage' });
    expect(screen.getByRole('link', { name: 'Posts' })).toHaveAttribute('href', '/manage/posts');
  });

  it('marks the active item with aria-current', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Posts' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Media' })).not.toHaveAttribute('aria-current');
  });

  it('renders a `soon` item as a disabled non-link', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Billing/ })).toBeNull();
    const soon = screen.getByText('Billing').closest('.cms-item');
    expect(soon).toHaveAttribute('aria-disabled', 'true');
    expect(within(soon as HTMLElement).getByText('Soon')).toBeInTheDocument();
  });

  it('renders a `soon` + `soonPreviewable` item as a real link, badge kept', () => {
    // Own fixture rather than the shared `panels`/`groups` above: adding a second `soon` item to
    // the shared one would give the "override the soon badge text" test two "Coming soon" matches
    // for a `getByText` that expects one.
    const previewablePanels: AdminPanel<null>[] = [
      { id: 'posts', render: null, nav: { label: 'Posts' } },
      { id: 'deployment', render: null, nav: { label: 'Deployment', soon: true, soonPreviewable: true } },
    ];
    render(
      <Sidebar activeId="posts">
        <Sidebar.Nav groups={buildNav(previewablePanels)} />
      </Sidebar>,
    );
    const link = screen.getByRole('link', { name: /Deployment/ });
    expect(link).toHaveAttribute('href', '/admin/deployment');
    expect(link).not.toHaveAttribute('aria-disabled');
    expect(within(link).getByText('Soon')).toBeInTheDocument();
  });

  it('tolerates a nav entry with no icon', () => {
    // `AdminNavEntry.icon` is optional so a panel can be listed before anyone has drawn it one.
    expect(() => renderSidebar()).not.toThrow();
    expect(screen.getByRole('link', { name: 'Posts' })).toBeInTheDocument();
  });

  it('hands rendering to renderItem when supplied, with active/href/collapsed precomputed', () => {
    const seen: Array<{ id: string; active: boolean; href: string; collapsed: boolean }> = [];
    render(
      <Sidebar activeId="posts">
        <Sidebar.Nav
          groups={groups}
          renderItem={(item, ctx) => {
            seen.push({ id: item.id, ...ctx });
            return <span data-testid={`custom-${item.id}`}>{item.label}</span>;
          }}
        />
      </Sidebar>,
    );
    expect(screen.getByTestId('custom-posts')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(seen.find((s) => s.id === 'posts')).toEqual({
      id: 'posts',
      active: true,
      href: '/admin/posts',
      collapsed: false,
    });
  });

  it('lets the host override the soon badge text', () => {
    render(
      <Sidebar activeId="posts">
        <Sidebar.Nav groups={groups} soonLabel="Coming soon" />
      </Sidebar>,
    );
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.queryByText('Soon')).toBeNull();
  });
});

describe('Sidebar.MobileHeader', () => {
  it('adds is-open only while open, and focuses the close control on the open transition', () => {
    const onClose = vi.fn();
    const { rerender } = renderSidebar({ onClose });
    expect(screen.getByRole('navigation', { name: 'Admin' }).className).not.toContain('is-open');

    rerender(
      <Sidebar activeId="posts" open>
        <Sidebar.MobileHeader onClose={onClose} />
        <Sidebar.Nav groups={groups} />
      </Sidebar>,
    );
    expect(screen.getByRole('navigation', { name: 'Admin' }).className).toContain('is-open');
    const close = screen.getByRole('button', { name: 'Close navigation' });
    expect(close).toHaveFocus();

    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('takes an overridable title and close label', () => {
    render(
      <Sidebar activeId="posts">
        <Sidebar.MobileHeader onClose={vi.fn()} title="Sections" closeLabel="Dismiss menu" />
      </Sidebar>,
    );
    expect(screen.getByText('Sections')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss menu' })).toBeInTheDocument();
  });
});

describe('Sidebar rail', () => {
  it('toggles the rail class and reports state through aria-expanded', () => {
    renderSidebar();
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(screen.getByRole('navigation', { name: 'Admin' }).className).toContain('is-rail');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows a portaled tooltip on hover only once collapsed', () => {
    renderSidebar();
    const posts = screen.getByRole('link', { name: 'Posts' });

    fireEvent.mouseEnter(posts);
    expect(document.querySelector('.cms-tooltip-portal')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    fireEvent.mouseEnter(posts);
    expect(document.querySelector('.cms-tooltip-portal')?.textContent).toBe('Posts');

    fireEvent.mouseLeave(posts);
    expect(document.querySelector('.cms-tooltip-portal')).toBeNull();
  });

  it('drops a showing tooltip when the rail state changes underneath it', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Posts' }));
    expect(document.querySelector('.cms-tooltip-portal')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(document.querySelector('.cms-tooltip-portal')).toBeNull();
  });

  it('keeps the label in the DOM in rail mode, so items stay named links', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('link', { name: 'Posts' })).toBeInTheDocument();
  });

  it('persists under a host-supplied storage key', () => {
    renderSidebar({ railStorageKey: 'host-rail-key' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('host-rail-key')).toBe('1');
  });

  it('takes overridable toggle labels', () => {
    render(
      <Sidebar activeId="posts">
        <Sidebar.RailToggle expandLabel="Open rail" collapseLabel="Shrink rail" />
      </Sidebar>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Shrink rail' }));
    expect(screen.getByRole('button', { name: 'Open rail' })).toBeInTheDocument();
  });
});

describe('Sidebar root', () => {
  it('takes an overridable landmark label, id and className', () => {
    render(
      <Sidebar activeId="posts" label="Site admin" id="my-nav" className="tight">
        <Sidebar.Nav groups={groups} />
      </Sidebar>,
    );
    const nav = screen.getByRole('navigation', { name: 'Site admin' });
    expect(nav).toHaveAttribute('id', 'my-nav');
    expect(nav.className).toContain('tight');
    expect(nav.className).toContain('cms-nav');
  });
});
