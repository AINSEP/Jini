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
