// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetCard, type AssetCardProps } from '../AssetCard.js';

const visibility = vi.hoisted(() => ({ inView: true }));
vi.mock('../../../../../react/hooks/useInView.js', () => ({
  useInView: () => ({ ref: { current: null }, inView: visibility.inView }),
}));

type Asset = { id: string };
function props(overrides: Partial<AssetCardProps<Asset>>, _options = {}): AssetCardProps<Asset> {
  return {
    asset: { id: 'one' }, index: 3, selected: false, title: 'One',
    renderThumbnail: vi.fn(() => <span>Thumbnail</span>),
    onToggle: vi.fn(), onRange: vi.fn(), onPreview: vi.fn(), ...overrides,
  };
}

describe('AssetCard L161 characterization', () => {
  beforeEach(() => { visibility.inView = true; });

  it.each([false, true])('keeps selection DOM attributes, label and checkmark consistent: %s', (selected) => {
    const { container } = render(<AssetCard {...props({ selected })} />);
    const button = screen.getByRole('button', { name: selected ? 'Deselect asset' : 'Select asset' });
    expect(container.querySelector('figure')).toHaveAttribute('data-asset-grid-id', 'one');
    expect(container.querySelector('figure')).toHaveAttribute('data-selected', String(selected));
    expect(button).toHaveAttribute('data-checked', String(selected));
    expect(button).toHaveAttribute('aria-pressed', String(selected));
    expect(button.querySelector('svg') !== null).toBe(selected);
  });

  it.each([
    { extra: false, remove: false }, { extra: true, remove: false },
    { extra: false, remove: true }, { extra: true, remove: true },
  ])('preserves the actions row for $extra extra / $remove remove', ({ extra, remove }) => {
    const onDeleteAsset = vi.fn<(id: string) => void>();
    const renderCardExtra = vi.fn((asset: Asset) => <span>Extra {asset.id}</span>);
    const { container } = render(<AssetCard {...props({
      renderCardExtra: extra ? renderCardExtra : undefined,
      onDeleteAsset: remove ? onDeleteAsset : undefined,
    })} />);
    const row = container.querySelector('.asset-grid-card-actions');
    expect(row !== null).toBe(extra || remove);
    expect(screen.queryByText('Extra one') !== null).toBe(extra);
    expect(screen.queryByRole('button', { name: 'Remove' }) !== null).toBe(remove);
    if (extra) expect(renderCardExtra).toHaveBeenCalledWith({ id: 'one' });
    if (remove) {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      expect(onDeleteAsset).toHaveBeenCalledTimes(1);
      expect(onDeleteAsset).toHaveBeenCalledWith('one');
    }
    if (remove && !extra) expect(row?.firstElementChild?.outerHTML).toBe('<span></span>');
  });

  it('keeps the actions row when the host extra renderer returns null', () => {
    const renderCardExtra = vi.fn(() => null);
    const { container } = render(<AssetCard {...props({ renderCardExtra })} />);
    expect(container.querySelector('.asset-grid-card-actions')).toBeEmptyDOMElement();
    expect(renderCardExtra).toHaveBeenCalledTimes(1);
    expect(renderCardExtra).toHaveBeenCalledWith({ id: 'one' });
  });

  it.each([
    { value: undefined, text: '' }, { value: null, text: '' }, { value: false, text: '' },
    { value: '', text: '' }, { value: 0, text: '0' }, { value: 'Placeholder', text: 'Placeholder' },
  ])('keeps the offscreen placeholder result $value', ({ value, text }) => {
    visibility.inView = false;
    const renderThumbnail = vi.fn(() => <span>Thumbnail</span>);
    const { container } = render(<AssetCard {...props({
      renderThumbnail,
      renderThumbnailPlaceholder: value === undefined ? undefined : () => value,
    })} />);
    expect(renderThumbnail).not.toHaveBeenCalled();
    expect(container.querySelector('.asset-grid-card-thumb-lazy')?.textContent).toBe(text);
  });

  it('renders the thumbnail, badges and subtitle when supplied', () => {
    render(<AssetCard {...props({ sourceLabel: 'Source', kindLabel: 'Kind', subtitle: 'Subtitle' })} />);
    for (const text of ['Thumbnail', 'Source', 'Kind', 'Subtitle']) expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('omits empty badges and subtitle', () => {
    const { container } = render(<AssetCard {...props({ sourceLabel: '', kindLabel: '', subtitle: '' })} />);
    expect(container.querySelector('.asset-grid-card-badge')).toBeNull();
    expect(container.querySelector('.asset-grid-card-subtitle')).toBeNull();
  });
});
