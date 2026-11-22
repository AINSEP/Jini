import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette.js';
import type { CommandPaletteItem, CommandPaletteResult } from '../../types.js';
import { I18nProvider, type useT } from '../../../i18n/index.js';

Element.prototype.scrollIntoView = vi.fn();

const SAMPLE_ITEMS: CommandPaletteItem[] = [
  { id: '1', name: 'File A', kind: 'file' },
  { id: '2', name: 'File B', kind: 'file' },
];

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('CommandPalette 4-pattern hook override test suite', () => {
  it('Pattern 1 — State 1: Empty results state via hook override', () => {
    const customHook = () => ({
      query: 'nonexistent',
      setQuery: vi.fn(),
      cursor: 0,
      results: [],
      selectResult: vi.fn(),
      setCursorTo: vi.fn(),
      handleKeyDown: vi.fn(),
    });

    render(
      <CommandPalette
        items={SAMPLE_ITEMS}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        useWiredCommandPalette={customHook as any}
      />,
    );

    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('Pattern 2 — State 2: Active query with results via hook override', () => {
    const results: CommandPaletteResult[] = [
      { item: SAMPLE_ITEMS[0]!, score: 10 },
    ];

    const customHook = () => ({
      query: 'File A',
      setQuery: vi.fn(),
      cursor: 0,
      results,
      selectResult: vi.fn(),
      setCursorTo: vi.fn(),
      handleKeyDown: vi.fn(),
    });

    render(
      <CommandPalette
        items={SAMPLE_ITEMS}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        useWiredCommandPalette={customHook as any}
      />,
    );

    expect(screen.getByText('File A')).toBeInTheDocument();
    expect(screen.queryByText('File B')).toBeNull();
  });

  it('Pattern 3 — State 3: Cursor active navigation state via hook override', () => {
    const mockSelectResult = vi.fn();
    const results: CommandPaletteResult[] = [
      { item: SAMPLE_ITEMS[0]!, score: 10 },
      { item: SAMPLE_ITEMS[1]!, score: 5 },
    ];

    const customHook = () => ({
      query: '',
      setQuery: vi.fn(),
      cursor: 1, // Cursor on second item
      results,
      selectResult: mockSelectResult,
      setCursorTo: vi.fn(),
      handleKeyDown: vi.fn(),
    });

    render(
      <CommandPalette
        items={SAMPLE_ITEMS}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        useWiredCommandPalette={customHook as any}
      />,
    );

    const rowB = screen.getByText('File B').closest('.jini-command-palette-row')!;
    expect(rowB).toHaveClass('jini-command-palette-row--active');
  });

  it('Pattern 4 — State 4: Dynamic search query transition walkthrough using React useState inside test harness', () => {
    function DynamicPaletteHarness() {
      const [query, setQuery] = useState('');
      const onSelect = vi.fn();
      const onClose = vi.fn();

      return (
        <CommandPalette
          items={SAMPLE_ITEMS}
          onSelect={onSelect}
          onClose={onClose}
        />
      );
    }

    render(<DynamicPaletteHarness />);

    const input = screen.getByRole('textbox');
    expect(screen.getByText('File A')).toBeInTheDocument();
    expect(screen.getByText('File B')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'File A' } });
    expect(screen.getByText('File A')).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<CommandPalette items={SAMPLE_ITEMS} onSelect={vi.fn()} onClose={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByPlaceholderText('«Search…»')).toBeInTheDocument();
  });

  it('renders the translated placeholder from the real provider, not the key', () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'Search…': 'Rechercher…' } }} initialLocale="fr">
        <CommandPalette items={SAMPLE_ITEMS} onSelect={vi.fn()} onClose={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByPlaceholderText('Rechercher…')).toBeInTheDocument();
  });
});
