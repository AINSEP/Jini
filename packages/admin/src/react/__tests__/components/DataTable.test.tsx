import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, type DataTableColumn } from '../../components/DataTable.js';

interface Post {
  id: string;
  title: string;
  status: string;
}

const posts: Post[] = [
  { id: 'a', title: 'First', status: 'published' },
  { id: 'b', title: 'Second', status: 'draft' },
];

const columns: DataTableColumn<Post>[] = [
  { key: 'title', header: 'Title', cell: (p) => <a href={`/admin/posts/${p.id}`}>{p.title}</a> },
  { key: 'status', header: 'Status', cell: (p) => <span className={`status status-${p.status}`}>{p.status}</span> },
  { key: 'actions', headerLabel: 'Actions', cell: (p) => <button type="button">{`Actions for ${p.title}`}</button> },
];

function renderTable(props: Partial<Parameters<typeof DataTable<Post>>[0]> = {}) {
  return render(<DataTable rows={posts} columns={columns} rowKey={(p) => p.id} {...props} />);
}

describe('DataTable structure', () => {
  it('emits the scroll wrapper and list-table classes the host stylesheet targets', () => {
    const { container } = renderTable();
    const scroll = container.querySelector('.table-scroll');
    expect(scroll).not.toBeNull();
    // The wrapper is load-bearing, not decorative: its overflow is why a wide table scrolls
    // rather than breaking the page.
    expect(scroll?.querySelector('table')).toHaveClass('list-table');
  });

  it('renders one header cell per column, each a scoped col header', () => {
    renderTable();
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(3);
    expect(headers[0]).toHaveAttribute('scope', 'col');
    expect(headers[0]).toHaveTextContent('Title');
  });

  it('names a headerless actions column for assistive tech', () => {
    renderTable();
    const headers = screen.getAllByRole('columnheader');
    expect(headers[2]).toHaveTextContent('');
    expect(headers[2]).toHaveAccessibleName('Actions');
  });

  it('does not put an aria-label on a column that has a visible header', () => {
    render(
      <DataTable
        rows={posts}
        rowKey={(p) => p.id}
        columns={[{ key: 'title', header: 'Title', headerLabel: 'Ignored', cell: (p) => p.title }]}
      />,
    );
    expect(screen.getByRole('columnheader')).toHaveAccessibleName('Title');
  });

  it('renders one row per record with cells in column order', () => {
    renderTable();
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(rows).toHaveLength(2);
    const cells = within(rows[0] as HTMLElement).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('First');
    expect(cells[1]).toHaveTextContent('published');
  });

  it('passes the row and its index to every cell renderer', () => {
    const seen: Array<[string, number]> = [];
    render(
      <DataTable
        rows={posts}
        rowKey={(p) => p.id}
        columns={[{ key: 'k', header: '#', cell: (p, i) => { seen.push([p.id, i]); return i; } }]}
      />,
    );
    expect(seen).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});

describe('DataTable empty and loading', () => {
  it('renders the empty state instead of the table when there are no rows', () => {
    const { container } = renderTable({ rows: [], empty: <p>No posts yet</p> });
    expect(screen.getByText('No posts yet')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('.table-scroll')).toBeNull();
  });

  it('renders an empty tbody when there are no rows and no empty state was supplied', () => {
    renderTable({ rows: [] });
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.getAllByRole('row')).toHaveLength(1); // header only
  });

  it('shows loading instead of the table', () => {
    const { container } = renderTable({ loading: true, loadingContent: <p>Loading…</p> });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
  });

  it('prefers loading over empty, so a first fetch never flashes "nothing here"', () => {
    // The ordering bug this guards is the one every list screen gets wrong: rows is legitimately
    // [] while the request is still in flight.
    renderTable({ rows: [], loading: true, loadingContent: <p>Loading…</p>, empty: <p>No posts yet</p> });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('No posts yet')).toBeNull();
  });

  it('falls back to the table shell when loading is true but no loading content was given', () => {
    renderTable({ rows: [], loading: true, empty: <p>No posts yet</p> });
    expect(screen.queryByText('No posts yet')).toBeNull();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });
});

describe('DataTable optional parts', () => {
  it('omits caption and tfoot unless asked for', () => {
    const { container } = renderTable();
    expect(container.querySelector('caption')).toBeNull();
    expect(container.querySelector('tfoot')).toBeNull();
  });

  it('renders a caption and a footer when supplied', () => {
    const { container } = renderTable({
      caption: 'All posts',
      footer: (
        <tr>
          <td colSpan={3}>2 posts</td>
        </tr>
      ),
    });
    expect(container.querySelector('caption')).toHaveTextContent('All posts');
    expect(container.querySelector('tfoot')).toHaveTextContent('2 posts');
  });

  it('takes an accessible name for screens with more than one table', () => {
    renderTable({ label: 'Posts' });
    expect(screen.getByRole('table', { name: 'Posts' })).toBeInTheDocument();
  });

  it('applies per-row, per-column and container class overrides', () => {
    const { container } = render(
      <DataTable
        rows={posts}
        rowKey={(p) => p.id}
        className="dense"
        scrollClassName="bordered"
        rowClassName={(p) => (p.status === 'draft' ? 'is-draft' : undefined)}
        columns={[
          { key: 'title', header: 'Title', cell: (p) => p.title, headerClassName: 'wide' },
          { key: 'status', header: 'Status', cell: (p) => p.status, cellClassName: (p) => `cell-${p.status}` },
        ]}
      />,
    );
    expect(container.querySelector('.table-scroll')).toHaveClass('bordered');
    expect(container.querySelector('table')).toHaveClass('list-table', 'dense');
    expect(screen.getAllByRole('columnheader')[0]).toHaveClass('wide');

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).not.toHaveClass('is-draft');
    expect(rows[1]).toHaveClass('is-draft');
    expect(within(rows[1] as HTMLElement).getAllByRole('cell')[1]).toHaveClass('cell-draft');
  });

  it('accepts a static string cellClassName', () => {
    render(
      <DataTable
        rows={posts}
        rowKey={(p) => p.id}
        columns={[{ key: 'title', header: 'Title', cell: (p) => p.title, cellClassName: 'truncate' }]}
      />,
    );
    expect(screen.getAllByRole('cell')[0]).toHaveClass('truncate');
  });
});
