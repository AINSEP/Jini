import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../button.js';
import { Card, CardFooter } from '../card.js';
import { ContentCard } from '../content-card.js';
import { DataTable } from '../data-table.js';
import { Check } from '../icons.js';
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableRow } from '../table.js';

describe('Button asChild', () => {
  it('renders the button styling onto the caller-supplied child element instead of a <button>', () => {
    render(<Button asChild variant="outline"><a href="/docs">Docs</a></Button>);
    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/docs');
    expect(link.className).toContain('inline-flex');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Card and Table slots', () => {
  it('renders a card footer that merges the caller class', () => {
    render(<Card><CardFooter className="extra">Actions</CardFooter></Card>);
    expect(screen.getByText('Actions')).toHaveClass('flex', 'items-center', 'extra');
  });

  it('renders the table footer and caption slots with their data-slot markers', () => {
    render(
      <Table>
        <TableCaption className="cap">Totals</TableCaption>
        <TableBody><TableRow><TableCell>1</TableCell></TableRow></TableBody>
        <TableFooter className="foot"><TableRow><TableCell>Sum</TableCell></TableRow></TableFooter>
      </Table>,
    );
    expect(screen.getByText('Totals')).toHaveAttribute('data-slot', 'table-caption');
    expect(screen.getByText('Totals')).toHaveClass('cap');
    const footer = screen.getByText('Sum').closest('tfoot');
    expect(footer).toHaveAttribute('data-slot', 'table-footer');
    expect(footer).toHaveClass('foot');
  });
});

describe('ContentCard', () => {
  it('renders a header for a description alone, without an empty title', () => {
    const { container } = render(<ContentCard description="Only a description" />);
    expect(screen.getByText('Only a description')).toBeInTheDocument();
    expect(container.querySelectorAll('h3')).toHaveLength(0);
  });
});

describe('DataTable keyboard row activation', () => {
  it('activates a clickable row with Enter or Space on the row itself, and ignores other keys and nested targets', () => {
    const onRowClick = vi.fn();
    const rows = [{ name: 'alpha' }];
    render(<DataTable columns={[{ key: 'name', label: 'Name' }]} rows={rows} onRowClick={onRowClick} />);
    const row = screen.getByRole('button', { name: 'alpha' });
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    fireEvent.keyDown(row, { key: 'a' });
    fireEvent.keyDown(screen.getByText('alpha'), { key: 'Enter' });
    expect(onRowClick.mock.calls).toEqual([[rows[0], 0], [rows[0], 0]]);
  });
});

describe('icon accessibility', () => {
  it('stays visible to assistive tech when the caller gives it a role or a title', () => {
    const { container: withRole } = render(<Check role="img" />);
    expect(withRole.querySelector('svg')).not.toHaveAttribute('aria-hidden');
    const { container: withTitle } = render(<Check title="Done" />);
    expect(withTitle.querySelector('svg')).not.toHaveAttribute('aria-hidden');
  });
});
