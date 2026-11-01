import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, SETTINGS_DIALOG_DICTIONARIES } from '../../../../i18n/index.js';
import { DEFAULT_ACCENT_COLOR } from '../../../../../utils/appearance.js';
import { AppearanceTab } from '../../../react/components/AppearanceTab.js';

describe('AppearanceTab', () => {
  it('names all swatches in French using only the shipped settings dictionaries', () => {
    render(
      <I18nProvider dictionaries={SETTINGS_DIALOG_DICTIONARIES} initialLocale="fr">
        <AppearanceTab theme="light" onThemeChange={() => {}} onAccentColorChange={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-label')))
      .toEqual(['Anthracite', 'Argile', 'Violet', 'Vert', 'Rouge', 'Ambre', 'Bleu canard', 'Rose']);
  });

  it('names every built-in swatch by its color and keeps hex codes in tooltips', () => {
    render(<AppearanceTab theme="light" onThemeChange={() => {}} onAccentColorChange={() => {}} />);
    for (const [name, hex] of [
      ['Charcoal', DEFAULT_ACCENT_COLOR], ['Clay', '#c96442'], ['Violet', '#7c3aed'],
      ['Green', '#059669'], ['Red', '#dc2626'], ['Amber', '#d97706'],
      ['Teal', '#0891b2'], ['Pink', '#db2777'],
    ] as const) {
      expect(screen.getByRole('radio', { name })).toHaveAttribute('title', hex);
    }
    expect(screen.getAllByRole('radio')).toHaveLength(8);
  });

  it('translates swatch name keys through the host dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Green: 'Vert', Charcoal: 'Anthracite' } }} initialLocale="fr">
        <AppearanceTab theme="light" onThemeChange={() => {}} onAccentColorChange={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByRole('radio', { name: 'Vert' })).toHaveAttribute('title', '#059669');
    expect(screen.getByRole('radio', { name: 'Anthracite' })).toHaveAttribute('title', DEFAULT_ACCENT_COLOR);
  });

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
    expect(screen.getByRole('radio', { name: 'Green' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Charcoal' }));
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
    expect(screen.getByRole('radio', { name: 'Charcoal' })).toHaveAttribute('aria-checked', 'true');
  });

  it('preserves a host override for the default swatch name', () => {
    render(<AppearanceTab theme="light" onThemeChange={() => {}} onAccentColorChange={() => {}} defaultAccentAriaLabel="Brand default" />);
    expect(screen.getByRole('radio', { name: 'Brand default' })).toHaveAttribute('title', DEFAULT_ACCENT_COLOR);
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
