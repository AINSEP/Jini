import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { createFakeMediaProvidersPort } from '@jini-ai/ui-core';
import type { MediaProviderOption, MediaProvidersPort } from '@jini-ai/ui-core';
import { MediaProvidersTab } from '../../../react/components/MediaProvidersTab.js';

const CATALOG: readonly MediaProviderOption[] = [
  { id: 'alpha', label: 'Alpha Images', defaultBaseUrl: 'https://alpha.example.com' },
  { id: 'bravo', label: 'Bravo Video', models: ['bravo-fast', 'bravo-hq'] },
];

describe('MediaProvidersTab', () => {
  it('renders every catalog provider, configured ones first', async () => {
    const port = createFakeMediaProvidersPort({ providers: { bravo: { apiKeyConfigured: true, apiKeyTail: '9999' } } });
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    await screen.findByText('Bravo Video');
    const cards = screen.getAllByRole('textbox').length; // sanity: fields rendered
    expect(cards).toBeGreaterThan(0);

    const headings = screen.getAllByText(/Alpha Images|Bravo Video/).map((el) => el.textContent);
    expect(headings.indexOf('Bravo Video')).toBeLessThan(headings.indexOf('Alpha Images'));
  });

  it('shows a masked Saved badge for a marker-only entry', async () => {
    const port = createFakeMediaProvidersPort({ providers: { alpha: { apiKeyConfigured: true, apiKeyTail: '4242' } } });
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    expect(await screen.findByText('Saved (••••4242)')).toBeInTheDocument();
  });

  it('shows the empty-state hint when nothing is configured', async () => {
    const port = createFakeMediaProvidersPort();
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    expect(await screen.findByText('No media providers configured yet.')).toBeInTheDocument();
  });

  it('typing an API key marks the row unsaved and enables Save changes', async () => {
    const port = createFakeMediaProvidersPort();
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    await screen.findByText('No media providers configured yet.');

    const saveButton = screen.getByRole('button', { name: 'Save changes' });
    expect(saveButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Alpha Images API key'), 'sk-1');
    expect(await screen.findByText('Unsaved')).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
  });

  it('Save changes persists every edited provider and shows a saved notice', async () => {
    const port = createFakeMediaProvidersPort();
    const saveSpy = vi.spyOn(port, 'saveMediaProviders');
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    await screen.findByText('No media providers configured yet.');

    await userEvent.type(screen.getByLabelText('Alpha Images API key'), 'sk-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith({ alpha: { apiKey: 'sk-1' } }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
  });

  it('shows a save error and keeps the field editable when the save rejects', async () => {
    const port: MediaProvidersPort = {
      fetchMediaProviders: () => Promise.resolve({}),
      saveMediaProviders: () => Promise.reject(new Error('quota exceeded')),
    };
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    await screen.findByText('No media providers configured yet.');

    await userEvent.type(screen.getByLabelText('Alpha Images API key'), 'sk-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save media providers.');
    expect(screen.getByLabelText('Alpha Images API key')).toHaveValue('sk-1');
  });

  it('Clear removes a configured provider and disables itself once nothing is left to clear', async () => {
    const port = createFakeMediaProvidersPort({ providers: { alpha: { apiKeyConfigured: true, apiKeyTail: '1111' } } });
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    await screen.findByText('Saved (••••1111)');

    const clearButton = screen.getByRole('button', { name: 'Alpha Images Clear' });
    expect(clearButton).toBeEnabled();
    await userEvent.click(clearButton);

    await waitFor(() => expect(screen.queryByText('Saved (••••1111)')).not.toBeInTheDocument());
    expect(clearButton).toBeDisabled();
  });

  it('the Clear button starts disabled for an unconfigured provider', async () => {
    const port = createFakeMediaProvidersPort();
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    await screen.findByText('No media providers configured yet.');
    expect(screen.getByRole('button', { name: 'Alpha Images Clear' })).toBeDisabled();
  });

  it('toggles the API key field between masked and revealed', async () => {
    const port = createFakeMediaProvidersPort();
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    await screen.findByText('No media providers configured yet.');

    const input = screen.getByLabelText('Alpha Images API key');
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Alpha Images Show' }));
    expect(input).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Alpha Images Hide' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('shows a "uses X by default" hint only while the base URL is blank', async () => {
    const port = createFakeMediaProvidersPort();
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    await screen.findByText('No media providers configured yet.');

    expect(screen.getByText('Uses https://alpha.example.com by default.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Alpha Images Base URL'), 'https://typed.example.com');
    expect(screen.queryByText('Uses https://alpha.example.com by default.')).not.toBeInTheDocument();
  });

  it('typing a model updates that provider and marks it unsaved', async () => {
    const port = createFakeMediaProvidersPort();
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    await screen.findByText('No media providers configured yet.');

    await userEvent.type(screen.getByLabelText('Bravo Video Model'), 'bravo-hq');
    expect(screen.getByLabelText('Bravo Video Model')).toHaveValue('bravo-hq');
    expect(await screen.findByText('Unsaved')).toBeInTheDocument();
  });

  it('offers a model datalist only for a catalog entry that advertises models', async () => {
    const port = createFakeMediaProvidersPort();
    const { container } = render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    await screen.findByText('No media providers configured yet.');

    const bravoModelInput = screen.getByLabelText('Bravo Video Model');
    expect(bravoModelInput).toHaveAttribute('list');
    expect(container.querySelectorAll('option[value="bravo-fast"]')).toHaveLength(1);

    const alphaModelInput = screen.getByLabelText('Alpha Images Model');
    expect(alphaModelInput).not.toHaveAttribute('list');
  });

  it('shows an unreachable notice and preserves local edits instead of clearing the form', async () => {
    const port = createFakeMediaProvidersPort({ unreachable: true });
    render(
      <MediaProvidersTab
        port={port}
        catalog={CATALOG}
        initialProviders={{ alpha: { apiKey: 'from-local-cache' } }}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Showing local changes only.');
    expect(screen.getByLabelText('Alpha Images API key')).toHaveValue('from-local-cache');
  });

  it('Reload re-fetches from the daemon', async () => {
    const port = createFakeMediaProvidersPort();
    const fetchSpy = vi.spyOn(port, 'fetchMediaProviders');
    render(<MediaProvidersTab port={port} catalog={CATALOG} />);
    await screen.findByText('No media providers configured yet.');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('renders every custom label when a full labels override is supplied', async () => {
    const port = createFakeMediaProvidersPort({ providers: { alpha: { apiKeyConfigured: true, apiKeyTail: '5678' } } });
    render(
      <MediaProvidersTab
        port={port}
        catalog={CATALOG}
        labels={{
          title: 'Custom title',
          description: 'Custom description',
          reloadLabel: 'Custom reload',
          reloadingLabel: 'Custom reloading',
          unreachableLabel: 'Custom unreachable',
          emptyStateLabel: 'Custom empty',
          apiKeyLabel: 'Custom API key',
          apiKeyPlaceholder: 'Custom paste key',
          showKeyLabel: 'Custom show',
          hideKeyLabel: 'Custom hide',
          baseUrlLabel: 'Custom base URL',
          baseUrlPlaceholder: 'Custom base placeholder',
          baseUrlDefaultHintTemplate: 'Custom default is {url}',
          modelLabel: 'Custom model',
          modelPlaceholder: 'Custom model placeholder',
          savedWithMaskTemplate: 'Custom saved {mask}',
          unsavedLabel: 'Custom unsaved',
          clearLabel: 'Custom clear',
          saveChangesLabel: 'Custom save changes',
          savingLabel: 'Custom saving',
          savedNoticeLabel: 'Custom saved notice',
          saveErrorLabel: 'Custom save error',
        }}
      />,
    );
    expect(await screen.findByText('Custom title')).toBeInTheDocument();
    expect(screen.getByText('Custom description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom reload' })).toBeInTheDocument();
    expect(screen.getAllByText('Custom API key').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Custom base URL').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Custom model').length).toBeGreaterThan(0);
    expect(screen.getByText('Custom default is https://alpha.example.com')).toBeInTheDocument();
    expect(screen.getByText('Custom saved ••••5678')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alpha Images Custom clear' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alpha Images Custom show' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom save changes' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Bravo Video Custom API key'), 'sk-1');
    expect(await screen.findByText('Custom unsaved')).toBeInTheDocument();
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', async () => {
    const port = createFakeMediaProvidersPort();
    render(
      <I18nProvider dictionaries={{ fr: { 'Media providers': 'Fournisseurs de médias' } }} initialLocale="fr">
        <MediaProvidersTab port={port} catalog={CATALOG} />
      </I18nProvider>,
    );
    expect(await screen.findByText('Fournisseurs de médias')).toBeInTheDocument();
  });
});
