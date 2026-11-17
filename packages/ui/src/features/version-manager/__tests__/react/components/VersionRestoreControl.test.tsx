import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import { VersionRestoreControl } from '../../../react/components/VersionRestoreControl.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('VersionRestoreControl', () => {
  it('renders the restore button, disabled when disabled is true', () => {
    render(<VersionRestoreControl disabled restoring={false} onRestore={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeDisabled();
  });

  it('shows a restoring label while restoring', () => {
    render(<VersionRestoreControl disabled={false} restoring onRestore={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Restoring…' })).toBeInTheDocument();
  });

  it('opens a confirm popover on click, and does not call onRestore yet', async () => {
    const onRestore = vi.fn();
    render(<VersionRestoreControl disabled={false} restoring={false} onRestore={onRestore} />);
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('cancel closes the popover without calling onRestore', async () => {
    const onRestore = vi.fn();
    render(<VersionRestoreControl disabled={false} restoring={false} onRestore={onRestore} />);
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('confirming calls onRestore and closes the popover', async () => {
    const onRestore = vi.fn();
    render(<VersionRestoreControl disabled={false} restoring={false} onRestore={onRestore} />);
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the confirm button is disabled while the toggle is disabled', async () => {
    const onRestore = vi.fn();
    const { rerender } = render(<VersionRestoreControl disabled={false} restoring={false} onRestore={onRestore} />);
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    rerender(<VersionRestoreControl disabled restoring={false} onRestore={onRestore} />);
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
  });

  it('closes on outside click and Escape', async () => {
    render(
      <div>
        <VersionRestoreControl disabled={false} restoring={false} onRestore={vi.fn()} />
        <button type="button">outside</button>
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    await userEvent.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders translated strings under I18nProvider', async () => {
    render(
      <I18nProvider
        dictionaries={{
          fr: {
            'Restore this version': 'Restaurer cette version',
            'Restore this version?': 'Restaurer cette version ?',
            Restore: 'Restaurer',
            Cancel: 'Annuler',
          },
        }}
        initialLocale="fr"
      >
        <VersionRestoreControl disabled={false} restoring={false} onRestore={vi.fn()} />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Restaurer cette version' }));
    expect(screen.getByText('Restaurer cette version ?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<VersionRestoreControl disabled={false} restoring={false} onRestore={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Restore this version»' })).toBeInTheDocument();
  });
});
