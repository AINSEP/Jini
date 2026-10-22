import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable } from '../data-table.js';

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role' },
];
const rows = [
  { name: 'Ada', role: 'Engineer' },
  { name: 'Grace', role: 'Admiral' },
];

describe('shadcn DataTable', () => {
  it('renders a scoped bordered frame and empty state', () => {
    const { container } = render(<DataTable columns={columns} rows={[]} />);
    expect(container.querySelector('.jini-data-table-frame')).toContainElement(screen.getByRole('table'));
    expect(screen.getByRole('table')).toHaveClass('jini-data-table');
    expect(screen.getByText('No results.')).toHaveAttribute('colspan', '2');
  });

  it('sorts numerically in both directions without mutating rows or changing callback indexes', async () => {
    const sourceRows = [{ name: 'Ten', count: '10' }, { name: 'Two', count: 2 }, { name: 'Missing' }];
    const onRowClick = vi.fn();
    render(<DataTable columns={[{ key: 'name', label: 'Name' }, { key: 'count', label: 'Count' }]}
      rows={sourceRows} onRowClick={onRowClick} />);
    const countHeader = screen.getByRole('columnheader', { name: /Count/ });
    expect(countHeader).toHaveAttribute('data-numeric', 'true');
    await userEvent.click(within(countHeader).getByRole('button'));
    expect(countHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getAllByRole('button').filter((node) => node.tagName === 'TR').map((node) => node.textContent))
      .toEqual(['Two2', 'Ten10', 'Missing']);
    await userEvent.click(screen.getByText('Two'));
    expect(onRowClick).toHaveBeenCalledWith(sourceRows[1], 1);
    await userEvent.click(within(countHeader).getByRole('button'));
    expect(countHeader).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getAllByRole('button').filter((node) => node.tagName === 'TR').map((node) => node.textContent))
      .toEqual(['Ten10', 'Two2', 'Missing']);
    expect(sourceRows.map((row) => row.name)).toEqual(['Ten', 'Two', 'Missing']);
  });

  it('sorts text through keyboard-operable headers and can disable sorting', async () => {
    const { rerender } = render(<DataTable columns={columns} rows={[rows[1]!, rows[0]!]} />);
    const button = screen.getByRole('button', { name: /Name/ });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Ada');
    rerender(<DataTable columns={columns} rows={rows} sortable={false} />);
    expect(screen.queryByRole('button', { name: /Name/ })).not.toBeInTheDocument();
  });

  it('paginates only when requested, resets on sort and clamps a shrinking result set', async () => {
    const sourceRows = [{ name: 'Zed' }, { name: 'Ada' }, { name: 'Grace' }];
    const onRowClick = vi.fn();
    const { rerender } = render(<DataTable columns={columns} rows={sourceRows} pageSize={2} onRowClick={onRowClick} />);
    expect(screen.getByText('1–2 of 3 rows')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('3–3 of 3 rows')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await userEvent.click(screen.getByText('Grace'));
    expect(onRowClick).toHaveBeenCalledWith(sourceRows[2], 2);
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(screen.getByText('1–2 of 3 rows')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    rerender(<DataTable columns={columns} rows={[sourceRows[1]!]} pageSize={2} />);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('1–1 of 1 rows')).toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={sourceRows} />);
    expect(screen.getByText('Zed')).toBeInTheDocument();
    expect(screen.getByText('Grace')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
  });

  it('renders column headers and row cells via the real shadcn table primitives', () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Admiral')).toBeInTheDocument();
  });

  it('calls onRowClick with the row and index when a row is clicked', async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows} onRowClick={onRowClick} />);
    await userEvent.click(screen.getByText('Grace'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1], 1);
  });

  it('carries the shadcn data-slot markers, proving this is the real primitive and not a plain table', () => {
    const { container } = render(<DataTable columns={columns} rows={rows} />);
    expect(container.querySelector('[data-slot="table"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="table-row"]')).not.toBeNull();
  });
});
