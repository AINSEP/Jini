import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createFakeMcpIntegrationsPort } from '../../../dependencies.js';
import { CodexInstallToggleButton } from '../../../react/components/CodexInstallToggleButton.js';

describe('CodexInstallToggleButton', () => {
  it('renders nothing until the status check resolves', () => {
    const port = createFakeMcpIntegrationsPort();
    const { container } = render(<CodexInstallToggleButton port={port} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a disabled button + hint when unavailable', async () => {
    const port = createFakeMcpIntegrationsPort({ codexStatus: { available: false, installed: false } });
    render(<CodexInstallToggleButton port={port} />);
    expect(await screen.findByRole('button', { name: 'One-click install' })).toBeDisabled();
    expect(screen.getByText('Not available for this daemon.')).toBeInTheDocument();
  });

  it('installs on click when not installed, then flips to Uninstall and shows a success hint', async () => {
    const port = createFakeMcpIntegrationsPort({ codexStatus: { available: true, installed: false } });
    render(<CodexInstallToggleButton port={port} />);
    const button = await screen.findByRole('button', { name: 'One-click install' });
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Uninstall' })).toBeInTheDocument());
    expect(screen.getByText('MCP server installed.')).toBeInTheDocument();
  });

  it('shows an uninstalled success hint after uninstalling', async () => {
    const port = createFakeMcpIntegrationsPort({ codexStatus: { available: true, installed: true } });
    render(<CodexInstallToggleButton port={port} />);
    const button = await screen.findByRole('button', { name: 'Uninstall' });
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: 'One-click install' })).toBeInTheDocument());
    expect(screen.getByText('MCP server uninstalled.')).toBeInTheDocument();
  });

  it('shows an error hint instead of a success hint when the toggle fails', async () => {
    const port = {
      fetchCodexInstallStatus: () => Promise.resolve({ available: true, installed: false }),
      installCodexMcp: () => Promise.reject(new Error('nope')),
    };
    render(<CodexInstallToggleButton port={port} />);
    const button = await screen.findByRole('button', { name: 'One-click install' });
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByText('Install failed: nope')).toBeInTheDocument());
    expect(screen.queryByText('MCP server installed.')).not.toBeInTheDocument();
  });
});
