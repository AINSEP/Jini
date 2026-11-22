import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import { ZoomMenu } from '../../../react/components/ZoomMenu.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('ZoomMenu', () => {
  it('shows the current zoom on the trigger and no popover when closed', () => {
    render(
      <ZoomMenu zoom={100} levels={[50, 100, 150]} isOpen={false} onToggle={vi.fn()} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: '100%' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lists every level and marks the active one when open', () => {
    render(
      <ZoomMenu zoom={100} levels={[50, 100, 150]} isOpen onToggle={vi.fn()} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(screen.getByRole('menuitem', { name: '100%' })).toHaveClass('active');
    expect(screen.getByRole('menuitem', { name: '50%' })).not.toHaveClass('active');
  });

  it('calls onToggle on trigger click and onSelect on an item click', async () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    render(
      <ZoomMenu zoom={100} levels={[50, 100, 150]} isOpen onToggle={onToggle} onClose={vi.fn()} onSelect={onSelect} />,
    );
    await userEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('menuitem', { name: '150%' }));
    expect(onSelect).toHaveBeenCalledWith(150);
  });

  it('closes on Escape (via useDismissOnOutsideOrEscape)', async () => {
    const onClose = vi.fn();
    render(
      <ZoomMenu zoom={100} levels={[50, 100, 150]} isOpen onToggle={vi.fn()} onClose={onClose} onSelect={vi.fn()} />,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders translated strings under I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'Reset zoom': 'Réinitialiser le zoom' } }} initialLocale="fr">
        <ZoomMenu zoom={100} levels={[50, 100]} isOpen={false} onToggle={vi.fn()} onClose={vi.fn()} onSelect={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByTitle('Réinitialiser le zoom')).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook and hands dismissal to the injected hook', () => {
    const useDismissOnOutsideOrEscapeHook = vi.fn();
    render(
      <ZoomMenu zoom={100} levels={[50, 100, 150]} isOpen onToggle={vi.fn()} onClose={vi.fn()} onSelect={vi.fn()} useTHook={useQuotingT} useDismissOnOutsideOrEscapeHook={useDismissOnOutsideOrEscapeHook} />,
    );
    expect(screen.getByTitle('«Reset zoom»')).toBeInTheDocument();
    expect(useDismissOnOutsideOrEscapeHook).toHaveBeenCalled();
  });
});
