import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Sidebar } from '../../components/Sidebar.js';
import { RowMenu } from '../../components/RowMenu/RowMenu.js';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.js';
import { DEFAULT_NAV_SECTIONS_STORAGE_KEY } from '../../hooks/use-nav-sections.js';
import { DEFAULT_SIDEBAR_RAIL_STORAGE_KEY } from '../../hooks/use-sidebar-rail.js';

beforeEach(() => { localStorage.clear(); });

it('keeps rail and section controls usable when access to browser storage is denied', () => {
  const deniedStorage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Storage denied', 'SecurityError');
  });
  try {
    render(<Sidebar activeId="records">
      <Sidebar.Nav collapsibleGroups={['Records']} groups={[{
        label: 'Records', items: [{ id: 'records', label: 'All records', href: '/records' }],
      }]} />
      <Sidebar.RailToggle />
    </Sidebar>);
    fireEvent.click(screen.getByRole('button', { name: 'Records' }));
    expect(screen.getByText('All records')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('navigation')).toHaveClass('is-rail');
    expect(screen.getByRole('link', { name: 'All records' })).toBeVisible();
  } finally {
    deniedStorage.mockRestore();
  }
});

it('keeps the host rail key and default while generating links under its mount', () => {
  const { container } = render(<Sidebar activeId="records" base="/console" railStorageKey="host-rail" railDefaultCollapsed>
    <Sidebar.Nav groups={[{ items: [{ id: 'records', label: 'Records', href: '/records' }] }]} />
    <Sidebar.RailToggle />
  </Sidebar>);
  expect(screen.getByRole('navigation')).toHaveClass('is-rail');
  expect(screen.getByRole('link', { name: 'Records' })).toHaveAttribute('href', '/console/records');
  fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
  expect(localStorage.getItem('host-rail')).toBe('0');
  expect(localStorage.getItem(DEFAULT_SIDEBAR_RAIL_STORAGE_KEY)).toBeNull();
  expect(container.querySelector('nav')).not.toHaveClass('is-rail');
});

it('reads and toggles a named section without losing a neighbouring stored preference', () => {
  localStorage.setItem(DEFAULT_NAV_SECTIONS_STORAGE_KEY, '{"Records":false,"People":false}');
  render(<Sidebar activeId="records">
    <Sidebar.Nav collapsibleGroups={['Records']} groups={[{
      label: 'Records', items: [{ id: 'records', label: 'All records', href: '/records' }],
    }]} />
  </Sidebar>);
  const toggle = screen.getByRole('button', { name: 'Records' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('All records')).not.toBeVisible();
  fireEvent.click(toggle);
  expect(screen.getByRole('link', { name: 'All records' })).toBeVisible();
  expect(JSON.parse(localStorage.getItem(DEFAULT_NAV_SECTIONS_STORAGE_KEY)!)).toEqual({ Records: true, People: false });
});

it('opens a real row menu, preserves tone precedence and selects exactly once', () => {
  const onSelect = vi.fn();
  render(<RowMenu triggerLabel="Record actions" items={[
    { key: 'disable', label: 'Disable', tone: 'warning', destructive: true, onSelect },
    { key: 'delete', label: 'Delete', destructive: true, onSelect: vi.fn() },
  ]} />);
  const trigger = screen.getByRole('button', { name: 'Record actions' });
  fireEvent.click(trigger);
  const disable = screen.getByRole('menuitem', { name: 'Disable' });
  expect(disable).toHaveClass('btn-warning');
  expect(disable).not.toHaveClass('btn-danger');
  expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass('btn-danger');
  fireEvent.click(disable);
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger).toHaveFocus();
});

it('publishes stable unique row handles even when item keys collide after slugifying', () => {
  render(<RowMenu agentHandle="record-7" triggerLabel="Record actions" items={[
    { key: 'Edit', label: 'Edit first', onSelect: vi.fn() },
    { key: 'edit', label: 'Edit second', onSelect: vi.fn() },
  ]} />);
  const trigger = screen.getByRole('button', { name: 'Record actions' });
  expect(trigger).toHaveAttribute('data-agent-element', 'record-7');
  fireEvent.click(trigger);
  expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('data-agent-element')))
    .toEqual(['record-7-item-edit', 'record-7-item-edit-2']);
  expect(screen.getByRole('menuitem', { name: 'Edit second' })).toHaveAttribute('data-agent-label', 'Edit second');
});

it('publishes dialog action handles and keeps human-only confirmation opt-in working', () => {
  const onConfirm = vi.fn();
  const props = { open: true, title: 'Delete record?', body: 'Permanent removal', confirmLabel: 'Delete',
    tone: 'danger' as const, onCancel: vi.fn(), onConfirm, agentHandle: 'delete-record' };
  const { rerender } = render(<ConfirmDialog {...props} />);
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('data-agent-element', 'delete-record-cancel');
  const confirm = screen.getByRole('button', { name: 'Delete' });
  expect(confirm).toHaveAttribute('data-agent-element', 'delete-record-confirm');
  expect(confirm).toHaveAttribute('data-agent-label', 'Delete — Delete record?; cannot be undone');
  rerender(<ConfirmDialog {...props} agentMayConfirm={false} />);
  expect(confirm).not.toHaveAttribute('data-agent-element');
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('data-agent-element', 'delete-record-cancel');
  fireEvent.click(confirm);
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(onConfirm).toHaveBeenCalledWith();
});
