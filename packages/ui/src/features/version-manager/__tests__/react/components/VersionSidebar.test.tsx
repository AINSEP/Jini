import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import type { VersionRecord } from '../../../types.js';
import { VersionSidebar, type VersionSidebarProps } from '../../../react/components/VersionSidebar.js';

function makeVersion(overrides: Partial<VersionRecord> & { id: string; version: number }): VersionRecord {
  return { createdAt: 0, current: false, source: 'ai', ...overrides };
}

function defaultProps(overrides: Partial<VersionSidebarProps<VersionRecord>> = {}): VersionSidebarProps<VersionRecord> {
  return {
    countLabel: '2 versions',
    search: '',
    onSearchChange: vi.fn(),
    showSearch: false,
    loading: false,
    versions: [],
    visibleVersions: [],
    selectedVersionId: null,
    onSelect: vi.fn(),
    onPrefetch: vi.fn(),
    formatDate: () => 'Jan 1',
    sourceLabel: () => 'AI generated',
    sourceClassName: () => 'ai',
    restoredFrom: () => null,
    ...overrides,
  };
}

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('VersionSidebar', () => {
  it('shows a loading skeleton while loading', () => {
    render(<VersionSidebar {...defaultProps({ loading: true })} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an empty state when there are no versions at all', () => {
    render(<VersionSidebar {...defaultProps({ versions: [], visibleVersions: [] })} />);
    expect(screen.getByText('No versions yet.')).toBeInTheDocument();
  });

  it('shows a no-results state when search excludes everything', () => {
    const v1 = makeVersion({ id: 'v1', version: 1 });
    render(<VersionSidebar {...defaultProps({ versions: [v1], visibleVersions: [], showSearch: true, search: 'zzz' })} />);
    expect(screen.getByText('No results for “zzz”.')).toBeInTheDocument();
  });

  it('does not render the search box when showSearch is false', () => {
    render(<VersionSidebar {...defaultProps({ showSearch: false })} />);
    expect(screen.queryByPlaceholderText('Search…')).not.toBeInTheDocument();
  });

  it('renders the search box and calls onSearchChange while typing', async () => {
    const onSearchChange = vi.fn();
    render(<VersionSidebar {...defaultProps({ showSearch: true, onSearchChange })} />);
    const input = screen.getByPlaceholderText('Search…');
    await userEvent.type(input, 'a');
    expect(onSearchChange).toHaveBeenCalled();
  });

  it('shows a clear button when search has text, and clears it on click', async () => {
    const onSearchChange = vi.fn();
    render(<VersionSidebar {...defaultProps({ showSearch: true, search: 'foo', onSearchChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('renders each version with its badges and calls onSelect/onPrefetch', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1, current: true, label: 'Homepage' });
    const v2 = makeVersion({ id: 'v2', version: 2, source: 'restore', restoreFromVersionId: 'v1' });
    const onSelect = vi.fn();
    const onPrefetch = vi.fn();
    render(
      <VersionSidebar
        {...defaultProps({
          versions: [v2, v1],
          visibleVersions: [v2, v1],
          selectedVersionId: 'v1',
          onSelect,
          onPrefetch,
          sourceLabel: (v) => (v.source === 'restore' ? 'Restored' : 'AI generated'),
          restoredFrom: (v) => (v.restoreFromVersionId ? v1 : null),
        })}
      />,
    );
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Homepage')).toBeInTheDocument();
    expect(screen.getByText('Restored from v1')).toBeInTheDocument();

    const item = screen.getByText('Homepage').closest('button')!;
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith('v1');
    await userEvent.hover(item);
    expect(onPrefetch).toHaveBeenCalledWith('v1');
  });

  it('falls back to "Version N" when a version has no prompt or label', () => {
    const v1 = makeVersion({ id: 'v1', version: 5 });
    render(<VersionSidebar {...defaultProps({ versions: [v1], visibleVersions: [v1] })} />);
    expect(screen.getAllByText('Version 5').length).toBeGreaterThan(0);
  });

  it('marks the item aria-selected when it matches selectedVersionId', () => {
    const v1 = makeVersion({ id: 'v1', version: 1 });
    render(<VersionSidebar {...defaultProps({ versions: [v1], visibleVersions: [v1], selectedVersionId: 'v1' })} />);
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  });

  it('renders translated strings under I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'Search…': 'Rechercher…', Clear: 'Effacer' } }} initialLocale="fr">
        <VersionSidebar {...defaultProps({ showSearch: true, search: 'x' })} />
      </I18nProvider>,
    );
    expect(screen.getByPlaceholderText('Rechercher…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<VersionSidebar {...defaultProps({ versions: [], visibleVersions: [] })} useTHook={useQuotingT} />);
    expect(screen.getByText('«No versions yet.»')).toBeInTheDocument();
  });
});
