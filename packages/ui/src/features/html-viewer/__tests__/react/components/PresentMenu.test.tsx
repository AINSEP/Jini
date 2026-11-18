import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import { PresentMenu } from '../../../react/components/PresentMenu.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('PresentMenu', () => {
  it('is closed by default and can be disabled', () => {
    render(<PresentMenu disabled onPresentInline={vi.fn()} onPresentFullscreen={vi.fn()} onPresentInNewTab={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Present' })).toBeDisabled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on trigger click and lists the three present actions', async () => {
    render(<PresentMenu onPresentInline={vi.fn()} onPresentFullscreen={vi.fn()} onPresentInNewTab={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Present' }));
    expect(screen.getByRole('menuitem', { name: 'In this tab' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Fullscreen' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'New tab' })).toBeInTheDocument();
  });

  it('calls the matching callback and closes the menu on selection', async () => {
    const onPresentFullscreen = vi.fn();
    render(<PresentMenu onPresentInline={vi.fn()} onPresentFullscreen={onPresentFullscreen} onPresentInNewTab={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Present' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fullscreen' }));
    expect(onPresentFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('calls onPresentInline for "In this tab"', async () => {
    const onPresentInline = vi.fn();
    render(<PresentMenu onPresentInline={onPresentInline} onPresentFullscreen={vi.fn()} onPresentInNewTab={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Present' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'In this tab' }));
    expect(onPresentInline).toHaveBeenCalledTimes(1);
  });

  it('calls onPresentInNewTab for "New tab"', async () => {
    const onPresentInNewTab = vi.fn();
    render(<PresentMenu onPresentInline={vi.fn()} onPresentFullscreen={vi.fn()} onPresentInNewTab={onPresentInNewTab} />);
    await userEvent.click(screen.getByRole('button', { name: 'Present' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'New tab' }));
    expect(onPresentInNewTab).toHaveBeenCalledTimes(1);
  });

  it('closes on outside click', async () => {
    render(
      <div>
        <PresentMenu onPresentInline={vi.fn()} onPresentFullscreen={vi.fn()} onPresentInNewTab={vi.fn()} />
        <button type="button">outside</button>
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Present' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders translated strings under I18nProvider', async () => {
    render(
      <I18nProvider
        dictionaries={{ fr: { Present: 'Présenter', 'In this tab': 'Dans cet onglet', Fullscreen: 'Plein écran', 'New tab': 'Nouvel onglet' } }}
        initialLocale="fr"
      >
        <PresentMenu onPresentInline={vi.fn()} onPresentFullscreen={vi.fn()} onPresentInNewTab={vi.fn()} />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Présenter' }));
    expect(screen.getByRole('menuitem', { name: 'Dans cet onglet' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Plein écran' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Nouvel onglet' })).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<PresentMenu disabled={false} onPresentInline={vi.fn()} onPresentFullscreen={vi.fn()} onPresentInNewTab={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Present»' })).toBeInTheDocument();
  });
});
