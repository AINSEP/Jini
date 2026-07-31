import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { DEFAULT_ACCENT_COLOR } from '../../../../../utils/appearance.js';
import { AppearanceTab } from '../../../react/components/AppearanceTab.js';

describe('AppearanceTab', () => {
  it('marks the current theme active and calls onThemeChange when another is picked', async () => {
    const onThemeChange = vi.fn();
    render(<AppearanceTab theme="system" onThemeChange={onThemeChange} onAccentColorChange={() => {}} />);
    expect(screen.getByRole('button', { name: /System/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Dark/ }));
    expect(onThemeChange).toHaveBeenCalledWith('dark');
  });

  it('marks the matching accent swatch active and calls onAccentColorChange on click', async () => {
    const onAccentColorChange = vi.fn();
    render(<AppearanceTab theme="light" onThemeChange={() => {}} accentColor="#059669" onAccentColorChange={onAccentColorChange} />);
    expect(screen.getByRole('radio', { name: '#059669' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Default accent color' }));
    expect(onAccentColorChange).toHaveBeenCalledWith(DEFAULT_ACCENT_COLOR);
  });

  it('passes a host-supplied swatch through raw when it does not normalize to a valid #rrggbb', async () => {
    const onAccentColorChange = vi.fn();
    render(
      <AppearanceTab
        theme="light"
        onThemeChange={() => {}}
        onAccentColorChange={onAccentColorChange}
        accentSwatches={['not-a-color']}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'not-a-color' }));
    expect(onAccentColorChange).toHaveBeenCalledWith('not-a-color');
  });

  it('falls back to the default accent color when accentColor is invalid/missing', () => {
    render(<AppearanceTab theme="light" onThemeChange={() => {}} onAccentColorChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Default accent color' })).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onAccentColorChange with the raw value from the custom color picker', async () => {
    const onAccentColorChange = vi.fn();
    render(<AppearanceTab theme="light" onThemeChange={() => {}} onAccentColorChange={onAccentColorChange} />);
    const picker = screen.getByLabelText('Custom accent color') as HTMLInputElement;
    fireEvent.change(picker, { target: { value: '#123456' } });
    expect(onAccentColorChange).toHaveBeenCalledWith('#123456');
  });

  it('applies the live preview to document.documentElement by default', () => {
    render(<AppearanceTab theme="dark" onThemeChange={() => {}} accentColor="#dc2626" onAccentColorChange={() => {}} />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#dc2626');
  });

  it('does not touch the document when livePreview=false', () => {
    document.documentElement.removeAttribute('data-theme');
    render(<AppearanceTab theme="dark" onThemeChange={() => {}} onAccentColorChange={() => {}} livePreview={false} />);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { System: 'Système', Light: 'Clair', Dark: 'Sombre' } }} initialLocale="fr">
        <AppearanceTab theme="system" onThemeChange={() => {}} onAccentColorChange={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText('Système')).toBeInTheDocument();
    expect(screen.getByText('Clair')).toBeInTheDocument();
    expect(screen.getByText('Sombre')).toBeInTheDocument();
  });
});
