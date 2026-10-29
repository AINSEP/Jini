import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContentCard } from '../content-card.js';
import { DataTable } from '../data-table.js';
import { Check, type IconProps } from '../icons.js';

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
    // `title` is not in React's SVG prop typings, but untyped (JS) callers and Lucide's own API pass it.
    const jsCallerProps = { title: 'Done' } as unknown as IconProps;
    const { container: withTitle } = render(<Check {...jsCallerProps} />);
    expect(withTitle.querySelector('svg')).not.toHaveAttribute('aria-hidden');
  });
});
