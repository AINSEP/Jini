import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable } from '../../providers/native/data-table.js';

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role' },
];
const rows = [
  { name: 'Ada', role: 'Engineer' },
  { name: 'Grace', role: 'Admiral' },
];

describe('DataTable', () => {
  it('carries scoped base styles, semantic headers and a horizontal scroll container', () => {
    const { container } = render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByRole('table')).toHaveClass('jini-data-table');
    expect(container.querySelector('.jini-data-table-scroll')).toContainElement(screen.getByRole('table'));
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('scope', 'col');
  });

  it('right aligns numeric columns but leaves mixed text columns left aligned', () => {
    render(<DataTable columns={[{ key: 'count', label: 'Count' }, { key: 'code', label: 'Code' }]}
      rows={[{ count: 2, code: 'x' }, { count: '10', code: 3 }, { count: null }]} />);
    expect(screen.getByText('Count')).toHaveAttribute('data-numeric', 'true');
    expect(screen.getByText('Code')).toHaveAttribute('data-numeric', 'false');
    expect(screen.getByText('10')).toHaveAttribute('data-numeric', 'true');
  });

  it('shows an empty state spanning all columns', () => {
    render(<DataTable columns={columns} rows={[]} />);
    expect(screen.getByText('No results.')).toHaveAttribute('colspan', '2');
  });

  it('lets keyboard users activate a clickable row', async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows} onRowClick={onRowClick} />);
    const row = screen.getByText('Grace').closest('tr')!;
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith(rows[1], 1);
    await userEvent.keyboard(' ');
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it('renders column headers and row cells', () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Admiral')).toBeInTheDocument();
  });

  it('renders an empty cell for a missing field rather than "undefined"', () => {
    render(<DataTable columns={columns} rows={[{ name: 'Ada' }]} />);
    const cells = screen.getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('');
  });

  it('calls onRowClick with the row and index when a row is clicked', async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows} onRowClick={onRowClick} />);
    await userEvent.click(screen.getByText('Grace'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1], 1);
  });

  it('does not attach a click role when onRowClick is not provided', () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
