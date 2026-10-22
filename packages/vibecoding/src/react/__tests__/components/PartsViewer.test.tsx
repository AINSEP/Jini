import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PartsViewer } from '../../components/PartsViewer.js';

describe('PartsViewer', () => {
  test('renders an empty state with no parts', () => {
    render(<PartsViewer parts={[]} />);

    expect(screen.getByText('No parts yet.')).toBeInTheDocument();
  });

  test('lists every part by label, falling back to id when unlabeled', () => {
    render(
      <PartsViewer
        parts={[
          { id: 'hero', label: 'Hero', kind: 'region' },
          { id: 'pricing' },
        ]}
      />,
    );

    expect(screen.getByText('Hero')).toBeInTheDocument();
    expect(screen.getByText('pricing')).toBeInTheDocument();
  });

  test('clicking a row calls onSelect with that part\'s id', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<PartsViewer parts={[{ id: 'hero', label: 'Hero' }]} onSelect={onSelect} />);

    await user.click(screen.getByText('Hero'));

    expect(onSelect).toHaveBeenCalledWith('hero');
  });

  test('shows a prompt to select a part when nothing is selected', () => {
    render(<PartsViewer parts={[{ id: 'hero' }]} />);

    expect(screen.getByText('Select a part to inspect its content.')).toBeInTheDocument();
  });

  test('shows a loading state while content is being fetched', () => {
    render(<PartsViewer parts={[{ id: 'hero' }]} selectedId="hero" contentLoading />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  test('renders the selected part\'s content once loaded', () => {
    render(<PartsViewer parts={[{ id: 'hero' }]} selectedId="hero" content="<h1>Hi</h1>" />);

    expect(screen.getByText('<h1>Hi</h1>')).toBeInTheDocument();
  });
});
