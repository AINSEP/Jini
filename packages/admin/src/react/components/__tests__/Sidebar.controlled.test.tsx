import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Sidebar, type SidebarProps } from '../Sidebar.js';

/** Public props must reach the rail owner; controlled toggles must preserve the host preference. */
it('renders and toggles a controlled rail while leaving its persisted preference intact', () => {
  const key = 'sidebar-controlled-contract';
  localStorage.setItem(key, '1');
  const onRailCollapsedChange = vi.fn<(collapsed: boolean) => void>();
  const view = (railOverride: SidebarProps['railOverride']) => (
    <Sidebar activeId="records" railStorageKey={key} railOverride={railOverride}
      onRailCollapsedChange={onRailCollapsedChange}>
      <Sidebar.RailToggle />
    </Sidebar>
  );
  try {
    const { rerender } = render(view(false));
    expect(screen.getByRole('navigation')).not.toHaveClass('is-rail');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(onRailCollapsedChange.mock.calls).toEqual([[true]]);
    expect(screen.getByRole('navigation')).not.toHaveClass('is-rail');
    expect(localStorage.getItem(key)).toBe('1');
    rerender(view(true));
    expect(screen.getByRole('navigation')).toHaveClass('is-rail');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(onRailCollapsedChange.mock.calls).toEqual([[true], [false]]);
    expect(localStorage.getItem(key)).toBe('1');
    rerender(view(false));
    expect(screen.getByRole('navigation')).not.toHaveClass('is-rail');
    rerender(view(null));
    expect(screen.getByRole('navigation')).toHaveClass('is-rail');
    expect(localStorage.getItem(key)).toBe('1');
  } finally {
    localStorage.removeItem(key);
  }
});
