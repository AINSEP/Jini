import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type DataTableProps } from '../data-table.js';

const columns = [{ key: 'name', label: 'Name' }];
const rows = [{ name: 'Zed' }, { name: 'Ada' }, { name: 'Grace' }];

describe('shadcn DataTable paging characterization', () => {
  it('shows all rows in source order when paging is omitted', () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Zed', 'Ada', 'Grace']);
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous page' })).not.toBeInTheDocument();
    expect(screen.queryByText(/of 3 rows/)).not.toBeInTheDocument();
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity])(
    'shows all rows without paging for pageSize=%s',
    (pageSize) => {
      render(<DataTable columns={columns} rows={rows} pageSize={pageSize} />);
      expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Zed', 'Ada', 'Grace']);
      expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Previous page' })).not.toBeInTheDocument();
      expect(screen.queryByText(/of 3 rows/)).not.toBeInTheDocument();
    },
  );

  it.each([
    { pageSize: 1, names: ['Zed'], range: '1–1 of 3 rows', lastPage: false },
    { pageSize: 2, names: ['Zed', 'Ada'], range: '1–2 of 3 rows', lastPage: false },
    { pageSize: 10, names: ['Zed', 'Ada', 'Grace'], range: '1–3 of 3 rows', lastPage: true },
  ])('limits the first page for pageSize=$pageSize', ({ pageSize, names, range, lastPage }) => {
    render(<DataTable columns={columns} rows={rows} pageSize={pageSize} />);
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(names);
    expect(screen.getByText(range)).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(lastPage);
  });

  it('shows a zero range and disables both controls for an empty paged table', () => {
    render(<DataTable columns={columns} rows={[]} pageSize={2} />);
    expect(screen.getByRole('cell', { name: 'No results.' })).toHaveAttribute('colspan', '1');
    expect(screen.getByText('0–0 of 0 rows')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('renders the empty state without controls when paging is omitted', () => {
    render(<DataTable columns={columns} rows={[]} />);
    expect(screen.getByRole('cell', { name: 'No results.' })).toHaveAttribute('colspan', '1');
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
    expect(screen.queryByText(/of 0 rows/)).not.toBeInTheDocument();
  });

  it('pages backwards and reports original row indexes on the last page', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn<NonNullable<DataTableProps['onRowClick']>>();
    render(<DataTable columns={columns} rows={rows} pageSize={2} onRowClick={onRowClick} />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Grace']);
    expect(screen.getByText('3–3 of 3 rows')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Grace' }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[2], 2);
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Zed', 'Ada']);
    expect(screen.getByText('1–2 of 3 rows')).toBeInTheDocument();
  });

  it('clamps shrinking and empty results while retaining the requested page for later growth', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DataTable columns={columns} rows={rows} pageSize={1} />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('cell')).toHaveTextContent('Grace');
    rerender(<DataTable columns={columns} rows={rows.slice(0, 1)} pageSize={1} />);
    expect(screen.getByRole('cell')).toHaveTextContent('Zed');
    expect(screen.getByText('1–1 of 1 rows')).toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={[]} pageSize={1} />);
    expect(screen.getByRole('cell')).toHaveTextContent('No results.');
    expect(screen.getByText('0–0 of 0 rows')).toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={rows} pageSize={1} />);
    expect(screen.getByRole('cell')).toHaveTextContent('Grace');
    expect(screen.getByText('3–3 of 3 rows')).toBeInTheDocument();
  });

  it('recalculates the slice when page size changes without resetting the requested page', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DataTable columns={columns} rows={rows} pageSize={1} />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('cell')).toHaveTextContent('Ada');
    rerender(<DataTable columns={columns} rows={rows} pageSize={2} />);
    expect(screen.getByRole('cell')).toHaveTextContent('Grace');
    expect(screen.getByText('3–3 of 3 rows')).toBeInTheDocument();
  });

  it('shows all rows when paging is disabled and restores the requested page when reenabled', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DataTable columns={columns} rows={rows} pageSize={1} />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('cell')).toHaveTextContent('Ada');
    rerender(<DataTable columns={columns} rows={rows} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['Zed', 'Ada', 'Grace']);
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={rows} pageSize={1} />);
    expect(screen.getByRole('cell')).toHaveTextContent('Ada');
    expect(screen.getByText('2–2 of 3 rows')).toBeInTheDocument();
  });
});
