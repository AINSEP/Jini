import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MCP_CLIENTS } from '../../../constants.js';
import { ClientPicker } from '../../../react/components/ClientPicker.js';

describe('ClientPicker', () => {
  it('shows the selected client label and opens the list on click', async () => {
    render(<ClientPicker clients={MCP_CLIENTS} selectedClientId="claude" onSelect={() => {}} />);
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('calls onSelect and closes when an option is clicked', async () => {
    const onSelect = vi.fn();
    render(<ClientPicker clients={MCP_CLIENTS} selectedClientId="claude" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Codex' }));
    expect(onSelect).toHaveBeenCalledWith('codex');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on outside click', async () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <ClientPicker clients={MCP_CLIENTS} selectedClientId="claude" onSelect={() => {}} />
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    render(<ClientPicker clients={MCP_CLIENTS} selectedClientId="claude" onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders the methodLabel sub-label when supplied', () => {
    render(<ClientPicker clients={MCP_CLIENTS} selectedClientId="claude" onSelect={() => {}} methodLabel="Run a command" />);
    expect(screen.getByText('Run a command')).toBeInTheDocument();
  });

  it('renders a per-client methodLabels sub-label next to each dropdown item', async () => {
    render(
      <ClientPicker
        clients={MCP_CLIENTS}
        selectedClientId="claude"
        onSelect={() => {}}
        methodLabels={{ claude: 'CLI command', codex: 'TOML config' }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    const codexOption = screen.getByRole('option', { name: /Codex/ });
    expect(codexOption).toHaveTextContent('TOML config');
    const claudeOption = screen.getByRole('option', { name: /Claude Code/ });
    expect(claudeOption).toHaveTextContent('CLI command');
    // A client with no entry in methodLabels renders no sub-label at all.
    const cursorOption = screen.getByRole('option', { name: 'Cursor' });
    expect(cursorOption).toHaveTextContent('Cursor');
  });

  it('renders no per-item sub-labels when methodLabels is omitted', async () => {
    render(<ClientPicker clients={MCP_CLIENTS} selectedClientId="claude" onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    expect(screen.getByRole('option', { name: 'Codex' })).toBeInTheDocument();
  });

  it('renders an empty trigger title when clients is empty and the selected id matches nothing', () => {
    render(<ClientPicker clients={[]} selectedClientId="claude" onSelect={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent('');
  });
});
