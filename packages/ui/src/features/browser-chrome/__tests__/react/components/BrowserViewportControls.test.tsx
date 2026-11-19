import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BrowserViewportControls } from '../../../react/components/BrowserViewportControls.js';
import { I18nProvider } from '../../../../i18n/index.js';

describe('BrowserViewportControls', () => {
  it('shows the active preset label and opens a listbox of all presets on click', async () => {
    const user = userEvent.setup();
    render(<BrowserViewportControls viewport="desktop" onViewport={() => {}} />);

    expect(screen.getByText('Desktop')).not.toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();

    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).not.toBeNull();
    expect(screen.getByRole('option', { name: /Tablet/ })).not.toBeNull();
    expect(screen.getByRole('option', { name: /Mobile/ })).not.toBeNull();
  });

  it('calls onViewport and closes the menu when a preset is picked', async () => {
    const user = userEvent.setup();
    const onViewport = vi.fn();
    render(<BrowserViewportControls viewport="desktop" onViewport={onViewport} />);

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('option', { name: /Mobile/ }));

    expect(onViewport).toHaveBeenCalledWith('mobile');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<BrowserViewportControls viewport="desktop" onViewport={() => {}} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on an outside click', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <BrowserViewportControls viewport="desktop" onViewport={() => {}} />
        <button type="button">outside</button>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Use the full browser tab size' }));
    expect(screen.getByRole('listbox')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('disables the trigger when disabled', () => {
    render(<BrowserViewportControls viewport="desktop" onViewport={() => {}} disabled />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks the active preset as selected', async () => {
    const user = userEvent.setup();
    render(<BrowserViewportControls viewport="tablet" onViewport={() => {}} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('option', { name: /Tablet/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: /Desktop/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('falls back to the first custom preset when the current viewport id has no matching entry', async () => {
    const user = userEvent.setup();
    const presets = [
      { id: 'tablet' as const, label: 'Tab', title: 'Tab title', width: 820, height: 1180 },
      { id: 'mobile' as const, label: 'Phone', title: 'Phone title', width: 390, height: 844 },
    ];
    // 'desktop' isn't in this custom preset list, so activePreset must fall
    // back to presets[0] ('tablet') rather than finding nothing.
    render(<BrowserViewportControls viewport="desktop" onViewport={() => {}} presets={presets} />);
    expect(screen.getByText('Tab')).not.toBeNull();
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('option', { name: /Phone/ })).not.toBeNull();
  });

  it('renders nothing when given an empty custom presets list', () => {
    const { container } = render(<BrowserViewportControls viewport="desktop" onViewport={() => {}} presets={[]} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider dictionaries={{ fr: { Desktop: 'Bureau', Tablet: 'Tablette', Mobile: 'Mobile' } }} initialLocale="fr">
        <BrowserViewportControls viewport="desktop" onViewport={() => {}} />
      </I18nProvider>,
    );

    expect(screen.getByText('Bureau')).not.toBeNull();
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('option', { name: /Tablette/ })).not.toBeNull();
  });
});


it('uses injected viewport labels and dismissal', async () => {
  let dismiss = () => {};
  const useDismissOnOutsideOrEscapeHook = vi.fn(({ onDismiss }: { onDismiss: () => void }) => { dismiss = onDismiss; });
  render(<BrowserViewportControls viewport="desktop" onViewport={vi.fn()} useTHook={() => key => `injected:${key}`}
    useDismissOnOutsideOrEscapeHook={useDismissOnOutsideOrEscapeHook} />);
  await userEvent.click(screen.getByRole('button', { name: 'injected:Use the full browser tab size' }));
  expect(screen.getByRole('listbox', { name: 'injected:Viewport' })).toBeVisible();
  expect(screen.getByRole('option', { name: 'injected:Tablet' })).toBeVisible();
  expect(useDismissOnOutsideOrEscapeHook).toHaveBeenLastCalledWith({ onDismiss: expect.any(Function) }, { enabled: true, containerRef: expect.any(Object) });
  act(() => dismiss());
  expect(screen.queryByRole('listbox')).toBeNull();
});
