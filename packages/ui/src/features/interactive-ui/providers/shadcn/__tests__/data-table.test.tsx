import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
