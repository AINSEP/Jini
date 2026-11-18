import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import { VersionPromptPopover } from '../../../react/components/VersionPromptPopover.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('VersionPromptPopover', () => {
  it('is disabled and closed by default', () => {
    render(<VersionPromptPopover prompt="" disabled onCopy={vi.fn()} copied={false} />);
    expect(screen.getByRole('button', { name: 'Prompt' })).toBeDisabled();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('opens on click, showing the prompt text', async () => {
    render(<VersionPromptPopover prompt="make it blue" disabled={false} onCopy={vi.fn()} copied={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Prompt' }));
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(screen.getByText('make it blue')).toBeInTheDocument();
  });

  it('shows placeholder copy when there is no prompt', async () => {
    render(<VersionPromptPopover prompt="" disabled={false} onCopy={vi.fn()} copied={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Prompt' }));
    expect(screen.getByText('This version has no recorded prompt.')).toBeInTheDocument();
  });

  it('calls onCopy with the prompt text, and shows "Copied" when copied is true', async () => {
    const onCopy = vi.fn();
    const { rerender } = render(<VersionPromptPopover prompt="hello" disabled={false} onCopy={onCopy} copied={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Prompt' }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopy).toHaveBeenCalledWith('hello');

    rerender(<VersionPromptPopover prompt="hello" disabled={false} onCopy={onCopy} copied />);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('disables the copy button when there is no prompt', async () => {
    render(<VersionPromptPopover prompt="" disabled={false} onCopy={vi.fn()} copied={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Prompt' }));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('closes on outside click', async () => {
    render(
      <div>
        <VersionPromptPopover prompt="x" disabled={false} onCopy={vi.fn()} copied={false} />
        <button type="button">outside</button>
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Prompt' }));
    expect(screen.getByRole('region')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    render(<VersionPromptPopover prompt="x" disabled={false} onCopy={vi.fn()} copied={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Prompt' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('renders translated strings under I18nProvider', async () => {
    render(
      <I18nProvider dictionaries={{ fr: { Prompt: 'Invite', Copy: 'Copier' } }} initialLocale="fr">
        <VersionPromptPopover prompt="salut" disabled={false} onCopy={vi.fn()} copied={false} />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(screen.getByRole('button', { name: 'Copier' })).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<VersionPromptPopover prompt="hi" disabled={false} onCopy={vi.fn()} copied={false} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Prompt»' })).toBeInTheDocument();
  });
});
