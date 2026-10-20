import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import type { SourceConfigPort } from '../../../../source-config-list/ports.js';
import type { SourceConfigItem, SourceFieldSpec } from '../../../../source-config-list/types.js';
import { ExternalMcpTab, type ExternalMcpTabProps } from '../ExternalMcpTab.js';

const fields: readonly SourceFieldSpec[] = [{ key: 'id', label: 'Server ID', kind: 'text', required: true }];

function createPort(
  { sources }: { sources: SourceConfigItem[] },
  overrides: Partial<SourceConfigPort> = {},
): SourceConfigPort {
  return {
    fetchSources: vi.fn(async () => sources),
    addSource: vi.fn(async () => ({ ok: false, message: 'Rejected by host.' })),
    removeSource: vi.fn(async () => false),
    ...overrides,
  };
}

describe('ExternalMcpTab characterization', () => {
  const footerCases: { name: string; props: Partial<ExternalMcpTabProps>; footer: string | null; path: string | null }[] = [
    { name: 'omitted status and path', props: {}, footer: null, path: null },
    { name: 'a path without a status', props: { configPath: '/config.json' }, footer: null, path: null },
    { name: 'an empty status with a path', props: { saveStatusLabel: '', configPath: '/config.json' }, footer: null, path: null },
    { name: 'a status without a path', props: { saveStatusLabel: 'Saved' }, footer: 'Saved', path: null },
    { name: 'a status with an empty path', props: { saveStatusLabel: 'Saved', configPath: '' }, footer: 'Saved', path: null },
    { name: 'a status and a path', props: { saveStatusLabel: 'Saved', configPath: '/config.json' }, footer: 'Saved', path: '/config.json' },
    { name: 'whitespace status and path', props: { saveStatusLabel: ' ', configPath: ' ' }, footer: ' ', path: ' ' },
  ];

  it.each(footerCases)('keeps the footer visibility for $name', async ({ props, footer, path }) => {
    const port = createPort({ sources: [] });
    const { container } = render(<ExternalMcpTab dependencies={{ port }} {...props} />);
    await screen.findByText('No MCP servers configured.');
    const pill = container.querySelector('.external-mcp-save-pill');
    const storedAt = container.querySelector('.external-mcp-stored-at');
    expect(container.querySelector('.external-mcp-footer') !== null).toBe(footer !== null);
    expect(pill?.textContent ?? null).toBe(footer);
    expect(storedAt !== null).toBe(path !== null);
    expect(storedAt?.querySelector('code')?.textContent ?? null).toBe(path);
  });

  it('translates the footer labels while keeping the path literal and escaped', async () => {
    const port = createPort({ sources: [] });
    const path = '<b>config</b>';
    const { container } = render(
      <I18nProvider initialLocale="es" syncDocumentAttributes={false} dictionaries={{ es: { Saved: 'Guardado', 'Stored at': 'En', [path]: 'Do not translate paths' } }}>
        <ExternalMcpTab dependencies={{ port }} saveStatusLabel="Saved" configPath={path} />
      </I18nProvider>,
    );
    await screen.findByText('No MCP servers configured.');
    expect(container.querySelector('.external-mcp-save-pill')).toHaveTextContent('Guardado');
    expect(container.querySelector('.external-mcp-stored-at')?.textContent).toBe(`En ${path}`);
    expect(container.querySelector('code')?.textContent).toBe(path);
    expect(container.querySelector('code b')).toBeNull();
  });

  it('updates and removes the entire footer when the host changes its status', async () => {
    const dependencies = { port: createPort({ sources: [] }) };
    const { container, rerender } = render(<ExternalMcpTab dependencies={dependencies} saveStatusLabel="Saving" configPath="/first" />);
    await screen.findByText('No MCP servers configured.');
    rerender(<ExternalMcpTab dependencies={dependencies} saveStatusLabel="Saved" configPath="/second" />);
    expect(container.querySelector('.external-mcp-save-pill')).toHaveTextContent('Saved');
    expect(container.querySelector('code')).toHaveTextContent('/second');
    rerender(<ExternalMcpTab dependencies={dependencies} configPath="/second" />);
    expect(container.querySelector('.external-mcp-footer')).toBeNull();
  });

  it('starts loading with the form collapsed, then displays the empty state without a banner', async () => {
    const dependencies = { port: createPort({ sources: [] }) };
    render(<ExternalMcpTab dependencies={dependencies} />);
    expect(screen.getByRole('heading', { name: 'External MCP servers' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.getByRole('button', { name: 'Add server' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('ID')).toBeNull();
    expect(screen.queryByText('No MCP servers configured.')).toBeNull();
    await screen.findByText('No MCP servers configured.');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the host connection banner while loading and replaces it with a fetch failure', async () => {
    let rejectFetch: (reason: Error) => void = () => { throw new Error('Fetch has not started.'); };
    const pending = new Promise<SourceConfigItem[]>((_resolve, reject) => { rejectFetch = reject; });
    const port = createPort({ sources: [] }, { fetchSources: () => pending });
    render(<ExternalMcpTab dependencies={{ port }} connectionError="Host offline" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Host offline');
    rejectFetch(new Error('Network down'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load sources.'));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText('Host offline')).toBeNull();
  });

  it('preserves a draft across toggles and appends a successful add without reloading', async () => {
    const user = userEvent.setup();
    const source: SourceConfigItem = { id: 'new', fields: { id: 'new' } };
    const addSource = vi.fn<SourceConfigPort['addSource']>().mockResolvedValue({ ok: true, source });
    const port = createPort({ sources: [] }, { addSource });
    render(<ExternalMcpTab dependencies={{ port }} fieldSpecs={fields} />);
    await screen.findByText('No MCP servers configured.');
    const toggle = screen.getByRole('button', { name: 'Add server' });
    await user.click(toggle);
    await user.type(screen.getByLabelText('Server ID', { exact: false }), 'new');
    await user.click(toggle);
    expect(screen.queryByLabelText('Server ID', { exact: false })).toBeNull();
    await user.click(toggle);
    expect(screen.getByLabelText('Server ID', { exact: false })).toHaveValue('new');
    await user.click(screen.getAllByRole('button', { name: 'Add server' })[1]!);
    expect(await screen.findByText('new')).toBeInTheDocument();
    expect(addSource).toHaveBeenCalledWith({ fields: { id: 'new' } });
    expect(port.fetchSources).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('No MCP servers configured.')).toBeNull();
  });

  it('keeps failed submissions visible and blocks invalid drafts before calling the host', async () => {
    const user = userEvent.setup();
    const port = createPort({ sources: [] });
    const { container } = render(<ExternalMcpTab dependencies={{ port }} fieldSpecs={fields} />);
    await screen.findByText('No MCP servers configured.');
    await user.click(screen.getByRole('button', { name: 'Add server' }));
    const form = container.querySelector('form')!;
    await user.click(within(form).getByRole('button', { name: 'Add server' }));
    expect(port.addSource).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Server ID', { exact: false }), 'rejected');
    await user.click(within(form).getByRole('button', { name: 'Add server' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rejected by host.');
    expect(screen.getByLabelText('Server ID', { exact: false })).toHaveValue('rejected');
    expect(screen.getAllByRole('button', { name: 'Add server' })[0]).toHaveAttribute('aria-expanded', 'true');
  });

  it.each([
    { name: 'the host message', result: { ok: false, message: 'Host refused this server.' }, error: 'Host refused this server.' },
    { name: 'the fallback message', result: { ok: false }, error: 'Failed to add source.' },
  ])('shows $name on rejection and removes it after a successful retry', async ({ result, error }) => {
    const user = userEvent.setup();
    const source: SourceConfigItem = { id: 'retry', fields: { id: 'retry' } };
    const addSource = vi.fn<SourceConfigPort['addSource']>()
      .mockResolvedValueOnce(result)
      .mockResolvedValueOnce({ ok: true, source });
    const port = createPort({ sources: [] }, { addSource });
    const { container } = render(<ExternalMcpTab dependencies={{ port }} fieldSpecs={fields} />);
    await screen.findByText('No MCP servers configured.');
    const toggle = screen.getByRole('button', { name: 'Add server' });
    await user.click(toggle);
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(screen.getByLabelText('Server ID', { exact: false }), 'retry');
    const form = within(container.querySelector('form')!);
    await user.click(form.getByRole('button', { name: 'Add server' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(error);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(form.getByRole('button', { name: 'Add server' }));
    expect(await screen.findByText('retry')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(toggle);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Server ID', { exact: false })).toHaveValue('');
    expect(addSource).toHaveBeenNthCalledWith(1, { fields: { id: 'retry' } });
    expect(addSource).toHaveBeenNthCalledWith(2, { fields: { id: 'retry' } });
  });

  it('keeps an empty host rejection message silent (reported, not fixed)', async () => {
    const user = userEvent.setup();
    const addSource = vi.fn<SourceConfigPort['addSource']>().mockResolvedValue({ ok: false, message: '' });
    const port = createPort({ sources: [] }, { addSource });
    const { container } = render(<ExternalMcpTab dependencies={{ port }} fieldSpecs={fields} />);
    await screen.findByText('No MCP servers configured.');
    const toggle = screen.getByRole('button', { name: 'Add server' });
    await user.click(toggle);
    await user.type(screen.getByLabelText('Server ID', { exact: false }), 'silent');
    await user.click(within(container.querySelector('form')!).getByRole('button', { name: 'Add server' }));
    await waitFor(() => expect(within(container.querySelector('form')!).getByRole('button', { name: 'Add server' })).toBeEnabled());
    expect(addSource).toHaveBeenCalledWith({ fields: { id: 'silent' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Server ID', { exact: false })).toHaveValue('silent');
    expect(screen.queryByTestId('source-config-item-card')).toBeNull();
  });
});
