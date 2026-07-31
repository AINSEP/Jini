import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n/index.js';
import { validateSourceDraft } from '@jini-ai/ui-core';
import { SourceConfigListView } from './SourceConfigListView.js';
import type { ComponentProps } from 'react';
import type { SourceConfigListCapabilities } from '../hooks/useSourceConfigList.js';
import type { SourceConfigItem, SourceFieldSpec } from '@jini-ai/ui-core';

const URL_FIELD: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url', required: true };
const FULL_CAPS: SourceConfigListCapabilities = { canRefresh: true, canSetTrust: true, canTest: true, canUpdate: true };

function baseProps(overrides: Partial<ComponentProps<typeof SourceConfigListView>> = {}) {
  const values = { url: '' };
  return {
    fieldSpecs: [URL_FIELD],
    sources: [] as SourceConfigItem[],
    loading: false,
    capabilities: FULL_CAPS,
    pendingKeys: new Set<string>(),
    testResults: {},
    addForm: {
      values,
      trust: undefined,
      validation: validateSourceDraft([URL_FIELD], values),
      submitAttempted: false,
      submitting: false,
      onFieldChange: vi.fn(),
      onTrustChange: vi.fn(),
      onSubmit: vi.fn(),
    },
    onRefresh: vi.fn(),
    onRemove: vi.fn(),
    onTrustChange: vi.fn(),
    onTest: vi.fn(),
    onUpdate: vi.fn(),
    ...overrides,
  };
}

describe('SourceConfigListView', () => {
  it('renders a title and subtitle when given', () => {
    render(<SourceConfigListView {...baseProps({ title: 'MCP servers', subtitle: 'Connect external tools.' })} />);
    expect(screen.getByRole('heading', { name: 'MCP servers' })).toBeInTheDocument();
    expect(screen.getByText('Connect external tools.')).toBeInTheDocument();
  });

  it('renders no head block when both title and subtitle are omitted', () => {
    render(<SourceConfigListView {...baseProps()} />);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders only the title when subtitle is omitted', () => {
    render(<SourceConfigListView {...baseProps({ title: 'MCP servers' })} />);
    expect(screen.getByRole('heading', { name: 'MCP servers' })).toBeInTheDocument();
    expect(screen.queryByText('Connect external tools.')).toBeNull();
  });

  it('renders only the subtitle when title is omitted', () => {
    render(<SourceConfigListView {...baseProps({ subtitle: 'Connect external tools.' })} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('Connect external tools.')).toBeInTheDocument();
  });

  it('always renders the add form', () => {
    render(<SourceConfigListView {...baseProps()} />);
    expect(screen.getByLabelText('URL', { exact: false })).toBeInTheDocument();
  });

  it('shows a loading indicator while loading, before the empty/list state', () => {
    render(<SourceConfigListView {...baseProps({ loading: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('shows the default empty message when there are no sources and not loading', () => {
    render(<SourceConfigListView {...baseProps()} />);
    expect(screen.getByText('No sources configured yet.')).toBeInTheDocument();
  });

  it('shows a custom empty message when given', () => {
    render(<SourceConfigListView {...baseProps({ emptyMessage: 'No MCP servers yet.' })} />);
    expect(screen.getByText('No MCP servers yet.')).toBeInTheDocument();
  });

  it('renders a load error banner with role="alert"', () => {
    render(<SourceConfigListView {...baseProps({ loadError: 'Failed to load sources.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load sources.');
  });

  it('renders one item card per source and wires per-item callbacks to the right id', async () => {
    const sources: SourceConfigItem[] = [
      { id: 'a', fields: { url: 'https://a.example' } },
      { id: 'b', fields: { url: 'https://b.example' } },
    ];
    const onRemove = vi.fn();
    render(<SourceConfigListView {...baseProps({ sources, onRemove })} />);
    expect(screen.getAllByTestId('source-config-item-card')).toHaveLength(2);
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    await userEvent.click(removeButtons[1]!);
    expect(onRemove).toHaveBeenCalledWith('b');
  });

  it('reflects per-item pending state from pendingKeys', () => {
    const sources: SourceConfigItem[] = [{ id: 'a', fields: { url: 'https://a.example' } }];
    const pendingKeys = new Set(['refresh:a']);
    render(<SourceConfigListView {...baseProps({ sources, pendingKeys })} />);
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeInTheDocument();
  });

  it('wires each item card action callback to the right source id: refresh, trust-change, and test', async () => {
    const sources: SourceConfigItem[] = [{ id: 'a', fields: { url: 'https://a.example' }, trust: 'restricted' }];
    const onRefresh = vi.fn();
    const onTrustChange = vi.fn();
    const onTest = vi.fn();
    render(
      <SourceConfigListView
        {...baseProps({
          sources,
          trustOptions: [
            { value: 'restricted', label: 'Restricted' },
            { value: 'trusted', label: 'Trusted' },
          ],
          onRefresh,
          onTrustChange,
          onTest,
        })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledWith('a');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Trust level for/ }), 'trusted');
    expect(onTrustChange).toHaveBeenCalledWith('a', 'trusted');

    await userEvent.click(screen.getByRole('button', { name: /^https:\/\/a\.example/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(onTest).toHaveBeenCalledWith('a');
  });

  describe('i18n — custom title/subtitle/emptyMessage/loadError copy', () => {
    it('translates custom title/subtitle under a matching dictionary', () => {
      render(
        <I18nProvider
          dictionaries={{ fr: { 'MCP servers': 'Serveurs MCP', 'Connect external tools.': 'Connecter des outils externes.' } }}
          initialLocale="fr"
        >
          <SourceConfigListView {...baseProps({ title: 'MCP servers', subtitle: 'Connect external tools.' })} />
        </I18nProvider>,
      );
      expect(screen.getByRole('heading', { name: 'Serveurs MCP' })).toBeInTheDocument();
      expect(screen.getByText('Connecter des outils externes.')).toBeInTheDocument();
    });

    it('translates a custom emptyMessage under a matching dictionary', () => {
      render(
        <I18nProvider dictionaries={{ fr: { 'No MCP servers yet.': 'Aucun serveur MCP.' } }} initialLocale="fr">
          <SourceConfigListView {...baseProps({ emptyMessage: 'No MCP servers yet.' })} />
        </I18nProvider>,
      );
      expect(screen.getByText('Aucun serveur MCP.')).toBeInTheDocument();
    });

    it('translates the loadError banner under a matching dictionary', () => {
      render(
        <I18nProvider dictionaries={{ fr: { 'Failed to load sources.': 'Échec du chargement des sources.' } }} initialLocale="fr">
          <SourceConfigListView {...baseProps({ loadError: 'Failed to load sources.' })} />
        </I18nProvider>,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Échec du chargement des sources.');
    });
  });
});
