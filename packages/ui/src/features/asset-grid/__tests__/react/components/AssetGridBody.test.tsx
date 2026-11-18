// @vitest-environment jsdom
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssetGridBody } from '../../../react/components/AssetGridBody.js';
import { localDayKey } from '../../../rules.js';

interface TestAsset {
  id: string;
  day: string;
}

const today = localDayKey({ date: new Date() });
const assets: TestAsset[] = [
  { id: 'a', day: today },
  { id: 'b', day: today },
  { id: 'c', day: '2000-01-01' },
];

function renderCard(asset: TestAsset, index: number) {
  return (
    <div key={asset.id} data-testid={`card-${asset.id}`}>
      {asset.id}:{index}
    </div>
  );
}

describe('AssetGridBody', () => {
  it('grid mode renders one flat list in the original order with flat indices', () => {
    render(
      <AssetGridBody
        viewMode="grid"
        assets={assets}
        getDayKey={(a) => a.day}
        containerRef={createRef<HTMLDivElement>()}
        onMouseDown={vi.fn()}
        selecting={false}
        renderCard={renderCard}
      />,
    );
    expect(screen.getByTestId('card-a')).toHaveTextContent('a:0');
    expect(screen.getByTestId('card-b')).toHaveTextContent('b:1');
    expect(screen.getByTestId('card-c')).toHaveTextContent('c:2');
  });

  it('timeline mode groups by day (newest first) with a heading and count, preserving flat index', () => {
    render(
      <AssetGridBody
        viewMode="timeline"
        assets={assets}
        getDayKey={(a) => a.day}
        containerRef={createRef<HTMLDivElement>()}
        onMouseDown={vi.fn()}
        selecting={false}
        renderCard={renderCard}
      />,
    );
    expect(screen.getByText('Today')).toBeInTheDocument();
    // Today's group (2 items) renders before the older day's group.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Today');
    expect(screen.getByTestId('card-c')).toHaveTextContent('c:2');
    expect(screen.getByText('2')).toBeInTheDocument(); // today's group count
  });

  it('passes onMouseDown and data-selecting through to the root', () => {
    const onMouseDown = vi.fn();
    const { container } = render(
      <AssetGridBody
        viewMode="grid"
        assets={assets}
        getDayKey={(a) => a.day}
        containerRef={createRef<HTMLDivElement>()}
        onMouseDown={onMouseDown}
        selecting
        renderCard={renderCard}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-selecting', 'true');
  });

  it('also passes data-selecting through to the root in timeline mode', () => {
    const { container } = render(
      <AssetGridBody
        viewMode="timeline"
        assets={assets}
        getDayKey={(a) => a.day}
        containerRef={createRef<HTMLDivElement>()}
        onMouseDown={vi.fn()}
        selecting
        renderCard={renderCard}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-selecting', 'true');
  });
});
