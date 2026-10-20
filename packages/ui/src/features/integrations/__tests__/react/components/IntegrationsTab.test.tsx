import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { MCP_CLIENTS } from '../../../constants.js';
import { createFakeMcpIntegrationsPort } from '../../../dependencies.js';
import { IntegrationsTab } from '../../../react/components/IntegrationsTab.js';

describe('IntegrationsTab', () => {
  it('loads install info and renders a snippet containing the given serverName', async () => {
    const port = createFakeMcpIntegrationsPort();
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
    expect(screen.queryByText('open-design')).not.toBeInTheDocument();
  });

  it('switching clients updates the snippet and instruction', async () => {
    const port = createFakeMcpIntegrationsPort();
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    await waitFor(() => expect(screen.getByText('Run this command in your terminal.')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    await userEvent.click(screen.getByRole('option', { name: /Codex/ }));
    await waitFor(() => expect(screen.getByText('Paste this into ~/.codex/config.toml.')).toBeInTheDocument());
  });

  it('shows the Codex one-click install control only for the Codex client', async () => {
    const port = createFakeMcpIntegrationsPort({ codexStatus: { available: true, installed: false } });
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'One-click install' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    await userEvent.click(screen.getByRole('option', { name: /Codex/ }));
    expect(await screen.findByRole('button', { name: 'One-click install' })).toBeInTheDocument();
  });

  it('shows a build-hint warning when the CLI or Node prerequisite is missing', async () => {
    const port = createFakeMcpIntegrationsPort({
      info: {
        command: 'node',
        args: [],
        daemonUrl: '',
        platform: 'darwin',
        cliExists: false,
        nodeExists: true,
        buildHint: 'Run `pnpm build` first.',
      },
    });
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    expect(await screen.findByText('Run `pnpm build` first.')).toBeInTheDocument();
    expect(screen.getByText('Build the server first.')).toBeInTheDocument();
  });

  it('shows the Node-missing warning (not the CLI-missing one) when only Node is missing', async () => {
    const port = createFakeMcpIntegrationsPort({
      info: {
        command: 'node',
        args: [],
        daemonUrl: '',
        platform: 'darwin',
        cliExists: true,
        nodeExists: false,
        buildHint: null,
      },
    });
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    expect(await screen.findByText('Node.js was not found.')).toBeInTheDocument();
    expect(screen.queryByText('Build the server first.')).not.toBeInTheDocument();
  });

  it('defaults to an in-memory fake port when none is supplied', async () => {
    render(<IntegrationsTab serverName="acme-mcp" />);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
  });

  it('falls back to the first entry in clients when the active clientId is not one of them (still valid — just excluded from this host\'s list)', async () => {
    const port = createFakeMcpIntegrationsPort();
    const clientsWithoutClaude = MCP_CLIENTS.filter((c) => c.id !== 'claude');
    render(<IntegrationsTab serverName="acme-mcp" port={port} clients={clientsWithoutClaude} />);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
    // clientId state defaults to 'claude' (DEFAULT_MCP_CLIENT_ID), which
    // isn't in the host-supplied `clients` list — `client` falls back to
    // `clients[0]` (Codex here), gating the Codex-only install toggle on.
    expect(await screen.findByRole('button', { name: 'One-click install' })).toBeInTheDocument();
  });

  it('generates the snippet for the client it actually SHOWS, not the excluded stored id', async () => {
    // The half the fallback test above did not pin. The picker fell back to
    // `clients[0]` for display while `snippetForClient` still used the raw
    // stored `clientId` — so the page showed Codex and its one-click button
    // while printing `claude mcp add-json …` and telling the operator to run it,
    // for a client this host had deliberately excluded.
    const port = createFakeMcpIntegrationsPort();
    const clientsWithoutClaude = MCP_CLIENTS.filter((c) => c.id !== 'claude');
    render(<IntegrationsTab serverName="acme-mcp" port={port} clients={clientsWithoutClaude} />);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());

    expect(document.body.textContent).not.toMatch(/claude mcp add-json/);
  });

  it('disables the one-click deeplink install button when the CLI/Node prerequisite is missing', async () => {
    const port = createFakeMcpIntegrationsPort({
      info: {
        command: 'node',
        args: [],
        daemonUrl: '',
        platform: 'darwin',
        cliExists: false,
        nodeExists: true,
        buildHint: null,
      },
    });
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    await userEvent.click(screen.getByRole('option', { name: /Cursor/ }));
    // An <a> with no `href` has no accessible "link" role, which is itself
    // part of what's under test here — find it by text instead.
    const install = await screen.findByText('One-click install', { selector: 'a' });
    expect(install).toHaveAttribute('aria-disabled', 'true');
    expect(install).not.toHaveAttribute('href');
    // fireEvent.click returns false when the handler called preventDefault().
    expect(fireEvent.click(install)).toBe(false);
  });

  it('leaves the one-click deeplink install button enabled once the prerequisites are met', async () => {
    const port = createFakeMcpIntegrationsPort();
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    await userEvent.click(screen.getByRole('option', { name: /Cursor/ }));
    const install = await screen.findByRole('link', { name: 'One-click install' });
    expect(install).not.toHaveAttribute('aria-disabled');
    expect(install).toHaveAttribute('href', expect.stringContaining('cursor://'));
    // fireEvent.click returns true when nothing called preventDefault().
    expect(fireEvent.click(install)).toBe(true);
  });

  it('shows a method sub-label for the trigger and every dropdown item once install info has loaded', async () => {
    const port = createFakeMcpIntegrationsPort();
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
    expect(screen.getByText('CLI command')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    expect(screen.getByRole('option', { name: /Codex/ })).toHaveTextContent('TOML config');
  });

  it('surfaces a daemon fetch error inline', async () => {
    const port = { fetchInstallInfo: () => Promise.reject(new Error('daemon unreachable')) };
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    expect(await screen.findByText(/daemon unreachable/)).toBeInTheDocument();
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', async () => {
    const port = createFakeMcpIntegrationsPort();
    render(
      <I18nProvider dictionaries={{ fr: { Copy: 'Copier' } }} initialLocale="fr">
        <IntegrationsTab serverName="acme-mcp" port={port} />
      </I18nProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Copier' })).toBeInTheDocument();
  });

  it('renders the host-supplied capabilities title and lines instead of the defaults', async () => {
    const port = createFakeMcpIntegrationsPort();
    render(<IntegrationsTab serverName="acme-mcp" port={port} capabilitiesTitle="Acme can" capabilities={['Ship rockets', 'Land rockets']} />);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
    expect(screen.getByText('Acme can')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ship rockets', 'Land rockets']);
    expect(screen.queryByText('What this server can do')).not.toBeInTheDocument();
  });

  it('renders the default capabilities title and lines when the host supplies none', async () => {
    const port = createFakeMcpIntegrationsPort();
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    expect(screen.getByText('What this server can do')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Read your project files',
      'Pull context into the conversation',
      'Use default, safe tool permissions',
    ]);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
  });

  it('shows the loading placeholder and no method label before install info resolves', async () => {
    const port = createFakeMcpIntegrationsPort();
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    expect(screen.getByText('Loading install paths…')).toBeInTheDocument();
    expect(screen.queryByText('CLI command')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
  });

  it('shows the unresolved placeholder in the snippet block after a daemon fetch error', async () => {
    const port = { fetchInstallInfo: () => Promise.reject(new Error('daemon unreachable')) };
    render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    expect(await screen.findByText('Could not resolve install paths.')).toBeInTheDocument();
    expect(screen.getByText('Could not reach the daemon: daemon unreachable')).toHaveClass('jini-empty-card jini-empty-card-error');
  });

  it('derives the picker, Codex toggle, and deeplink agent handles from the one host base handle', async () => {
    const port = createFakeMcpIntegrationsPort();
    const { container } = render(<IntegrationsTab serverName="acme-mcp" port={port} agentHandle="integrations" />);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
    expect(container.querySelector('[data-agent-element="integrations-client-trigger"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    await userEvent.click(screen.getByRole('option', { name: /Codex/ }));
    expect(await screen.findByRole('button', { name: 'One-click install' })).toHaveAttribute('data-agent-element', 'integrations-codex-toggle');
    await userEvent.click(screen.getByRole('button', { name: /Codex/ }));
    await userEvent.click(screen.getByRole('option', { name: /Cursor/ }));
    const link = await screen.findByRole('link', { name: 'One-click install' });
    expect(link).toHaveAttribute('data-agent-element', 'integrations-one-click-install');
    expect(link).toHaveAttribute('data-agent-role', 'link');
    expect(link).toHaveAttribute('data-agent-label', 'One-click install');
  });

  it('publishes no agent handles anywhere when the host supplies no base handle', async () => {
    const port = createFakeMcpIntegrationsPort();
    const { container } = render(<IntegrationsTab serverName="acme-mcp" port={port} />);
    await waitFor(() => expect(screen.getByText(/acme-mcp/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    await userEvent.click(screen.getByRole('option', { name: /Cursor/ }));
    await screen.findByRole('link', { name: 'One-click install' });
    expect(container.querySelector('[data-agent-element]')).toBeNull();
  });

  it('renders no instruction, deeplink, or Codex toggle when the host supplies an empty clients list', async () => {
    const port = createFakeMcpIntegrationsPort();
    const { container } = render(<IntegrationsTab serverName="acme-mcp" port={port} clients={[]} />);
    await waitFor(() => expect(screen.queryByText('Loading install paths…')).not.toBeInTheDocument());
    expect(container.querySelector('.jini-mcp-instruction')).toBeNull();
    expect(container.querySelector('.jini-mcp-deeplink-row')).toBeNull();
    expect(container.querySelector('.jini-codex-install-row')).toBeNull();
  });
});
