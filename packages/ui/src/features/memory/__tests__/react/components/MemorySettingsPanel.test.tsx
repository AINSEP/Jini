import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemorySettingsPanel, type MemorySettingsPanelProps } from '../../../react/components/MemorySettingsPanel.js';
import type { MemoryEntrySummary } from '../../../types.js';
import { I18nProvider, type useT } from '../../../../i18n/index.js';

const ENTRY: MemoryEntrySummary = { id: 'e1', name: 'Prefers tabs', description: 'd', type: 'feedback' };

function props(overrides: Partial<MemorySettingsPanelProps> = {}): MemorySettingsPanelProps {
  return {
    enabled: true,
    onToggleEnabled: vi.fn(),
    topTab: 'memories',
    onTopTabChange: vi.fn(),
    savedMemory: {
      entries: [ENTRY], filtered: [ENTRY], visibleExtractions: [], filter: 'all', onFilterChange: vi.fn(),
      unifiedMemoryCount: 1, onClearExtractions: vi.fn(), onRefreshExtractions: vi.fn(), isRefreshing: false,
      previewId: null, previewBody: null, nowClock: 0,
      onOpenPreview: vi.fn(), onStartEdit: vi.fn(), onDeleteEntry: vi.fn(), onDeleteExtraction: vi.fn(),
    },
    howItWorks: {
      enabled: true,
      hookFlags: { chatExtractionEnabled: true, profileEnabled: false, rewriteEnabled: false, verifyEnabled: false },
      onToggleHook: vi.fn(),
    },
    ...overrides,
  };
}

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('MemorySettingsPanel', () => {
  it('shows the saved-memory list on the Memories view with that tab selected', () => {
    render(<MemorySettingsPanel {...props()} />);
    expect(screen.getByRole('tab', { name: 'Memories' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'How it works' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Prefers tabs')).toBeInTheDocument();
    expect(screen.queryByText('Onboarding')).toBeNull();
  });

  it('shows the how-it-works body on the How view instead of the list', () => {
    render(<MemorySettingsPanel {...props({ topTab: 'how' })} />);
    expect(screen.getByRole('tab', { name: 'How it works' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'How it works' })).toHaveClass('active');
    expect(screen.getByText('Onboarding')).toBeInTheDocument();
    expect(screen.queryByText('Prefers tabs')).toBeNull();
  });

  it('asks the host to switch views from either segment', async () => {
    const onTopTabChange = vi.fn();
    render(<MemorySettingsPanel {...props({ onTopTabChange })} />);
    await userEvent.click(screen.getByRole('tab', { name: 'How it works' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Memories' }));
    expect(onTopTabChange.mock.calls).toEqual([['how'], ['memories']]);
  });

  it('reports the master switch flip with the next value', async () => {
    const onToggleEnabled = vi.fn();
    render(<MemorySettingsPanel {...props({ enabled: false, onToggleEnabled })} />);
    const toggle = screen.getByRole('checkbox', { name: 'Enable memory' });
    expect(toggle).not.toBeChecked();
    expect(toggle.closest('label')).toHaveAttribute('title', 'Off');
    await userEvent.click(toggle);
    expect(onToggleEnabled).toHaveBeenCalledWith(true);
  });

  it('disables add and advanced without handlers, and calls them when supplied', async () => {
    const { unmount } = render(<MemorySettingsPanel {...props()} />);
    expect(screen.getByRole('button', { name: 'Add memory' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Advanced' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Enable memory' }).closest('label')).toHaveAttribute('title', 'On');
    unmount();

    const onAdd = vi.fn();
    const onOpenAdvanced = vi.fn();
    render(<MemorySettingsPanel {...props({ onAdd, onOpenAdvanced })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add memory' }));
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onOpenAdvanced).toHaveBeenCalledTimes(1);
  });

  it('derives every control and body handle from the one panel handle', () => {
    const { container, rerender } = render(<MemorySettingsPanel {...props({ agentHandle: 'memory' })} />);
    expect(screen.getByRole('checkbox', { name: 'Enable memory' })).toHaveAttribute('data-agent-element', 'memory-enabled');
    expect(screen.getByRole('button', { name: 'Add memory' })).toHaveAttribute('data-agent-element', 'memory-add');
    expect(container.querySelector('[data-agent-element^="memory-saved"]')).not.toBeNull();
    rerender(<MemorySettingsPanel {...props({ agentHandle: 'memory', topTab: 'how' })} />);
    expect(container.querySelector('[data-agent-element^="memory-how"]')).not.toBeNull();
  });

  it('publishes no agent markup without a panel handle', () => {
    const { container } = render(<MemorySettingsPanel {...props({ topTab: 'how' })} />);
    expect(container.querySelector('[data-agent-element]')).toBeNull();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<MemorySettingsPanel {...props()} useTHook={useQuotingT} />);
    expect(screen.getByRole('tab', { name: '«Memories»' })).toBeInTheDocument();
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Memories: 'Souvenirs' } }} initialLocale="fr">
        <MemorySettingsPanel {...props()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Souvenirs' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Memories' })).toBeNull();
  });
});

it('the expanded memory section retains its layout', async () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../settings/dialog/styles/settings-dialog.css'), 'utf8');
  const onToggleEnabled = vi.fn();
  const { container } = render(<MemorySettingsPanel {...props({ onToggleEnabled, savedMemory: {
    ...props().savedMemory, previewId: 'e1', previewBody: 'Full saved text',
  } })} />);
  expect(screen.getByText('Full saved text')).toBeInTheDocument();
  for (const token of ['jini-ui-memory-settings-panel', 'jini-ui-library-content', 'jini-ui-settings-section-card', 'jini-ui-toggle-switch', 'jini-ui-toggle-slider']) {
    expect(container.querySelector(`.${token}`)).not.toBeNull();
    expect(css).toContain(`.${token}`);
  }
  expect(container.querySelector('.jini-ui-memory-panel-head-copy p')).toHaveClass('hint');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Enable memory' }));
  expect(onToggleEnabled).toHaveBeenCalledWith(false);
});
