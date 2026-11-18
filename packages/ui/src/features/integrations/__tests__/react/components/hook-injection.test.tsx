import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type TranslationDict, type useT } from '../../../../i18n/index.js';
import { MCP_CLIENTS } from '../../../constants.js';
import { createFakeMcpIntegrationsPort } from '../../../dependencies.js';
import { ClientPicker, defaultClientPickerHooks } from '../../../react/components/ClientPicker.js';
import { CodexInstallToggleButton } from '../../../react/components/CodexInstallToggleButton.js';
import { SnippetBlock } from '../../../react/components/SnippetBlock.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

const FR: TranslationDict = { Copy: 'Copier', 'One-click install': 'Installation en un clic' };

function inFrench(ui: React.ReactNode) {
  return <I18nProvider dictionaries={{ fr: FR }} initialLocale="fr">{ui}</I18nProvider>;
}

describe('SnippetBlock hooks', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<SnippetBlock snippet="hello" language="bash" useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: /«Copy»/ })).toBeInTheDocument();
  });

  it('renders the translated label from the real provider, not the key', () => {
    render(inFrench(<SnippetBlock snippet="hello" language="bash" />));
    expect(screen.getByRole('button', { name: /Copier/ })).toBeInTheDocument();
  });

  it('renders from the snippet-block state supplied through useSnippetBlockHook', () => {
    const onCopy = vi.fn(async () => {});
    render(
      <SnippetBlock
        snippet="hello"
        language="bash"
        useSnippetBlockHook={() => ({ copied: true, onCopy })}
        useTHook={useQuotingT}
      />,
    );
    expect(screen.getByRole('button', { name: /«Copied»/ })).toBeInTheDocument();
  });
});

describe('CodexInstallToggleButton hooks', () => {
  it('renders the translator supplied through useTHook once the status resolves', async () => {
    const port = createFakeMcpIntegrationsPort({ codexStatus: { available: true, installed: false } });
    render(<CodexInstallToggleButton port={port} useTHook={useQuotingT} />);
    expect(await screen.findByRole('button', { name: '«One-click install»' })).toBeInTheDocument();
  });

  it('renders the translated label from the real provider, not the key', async () => {
    const port = createFakeMcpIntegrationsPort({ codexStatus: { available: true, installed: false } });
    render(inFrench(<CodexInstallToggleButton port={port} />));
    expect(await screen.findByRole('button', { name: 'Installation en un clic' })).toBeInTheDocument();
  });
});

describe('ClientPicker hooks', () => {
  it('hands the close handler and open state to the injected dismiss hook', () => {
    const useFakeDismiss = vi.fn();
    render(
      <ClientPicker
        clients={MCP_CLIENTS}
        selectedClientId="claude"
        onSelect={vi.fn()}
        hooks={{ ...defaultClientPickerHooks, useDismissOnOutsideOrEscape: useFakeDismiss }}
      />,
    );
    expect(useFakeDismiss).toHaveBeenCalledWith({ onDismiss: expect.any(Function) }, expect.objectContaining({ enabled: false }));
  });

  it('renders the translator supplied through useTHook', () => {
    render(<ClientPicker clients={MCP_CLIENTS} selectedClientId="claude" onSelect={vi.fn()} hooks={{ ...defaultClientPickerHooks, useT: useQuotingT }} />);
    expect(screen.getByRole('button', { expanded: false }).textContent).toContain('«');
  });

  it('renders the translated fallback label from the real provider, not the key', () => {
    const [client] = MCP_CLIENTS;
    render(
      <I18nProvider dictionaries={{ fr: { [client!.label]: 'Client traduit' } }} initialLocale="fr">
        <ClientPicker clients={MCP_CLIENTS} selectedClientId={client!.id} onSelect={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { expanded: false }).textContent).toContain('Client traduit');
  });
});
