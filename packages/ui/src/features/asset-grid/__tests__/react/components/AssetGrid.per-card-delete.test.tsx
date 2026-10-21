import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssetGrid } from '../../../react/components/AssetGrid.js';
import { createFakeAssetGridDependencies } from '../../../dependencies.js';
import type { AssetGridSelectors } from '../../../types.js';

interface TestAsset { id: string; kind: string; title: string; capturedAt: number }

const NOW = Date.now();
const selectors: AssetGridSelectors<TestAsset> = {
  getKind: (a) => a.kind,
  getTimestamp: (a) => a.capturedAt,
  getTitle: (a) => a.title,
};

function renderGrid(props: Partial<React.ComponentProps<typeof AssetGrid<TestAsset>>> = {}) {
  const dependencies = createFakeAssetGridDependencies<TestAsset>({
    assets: [{ id: 'a', kind: 'image', title: 'Sunset photo', capturedAt: NOW }],
    matchesQuery: () => true,
  });
  return render(<AssetGrid<TestAsset> selectors={selectors} dependencies={dependencies} renderThumbnail={() => <div />} searchDebounceMs={0} {...props} />);
}

describe('AssetGrid per-card delete', () => {
  it('offers no per-card Remove control when the host cannot delete a single asset', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('keeps the card and shows a non-Error rejection by its string form', async () => {
    const onDeleteAsset = vi.fn().mockRejectedValue('quota exceeded');
    renderGrid({ onDeleteAsset });
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('quota exceeded'));
    expect(onDeleteAsset).toHaveBeenCalledWith('a');
    expect(screen.getByText('Sunset photo')).toBeInTheDocument();
  });
});
