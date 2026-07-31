import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { LanguageTab } from '../../../react/components/LanguageTab.js';

const locales = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

describe('LanguageTab', () => {
  it('marks the selected locale tile as checked and shows a checkmark', () => {
    render(<LanguageTab locales={locales} selectedLocale="fr" onSelectLocale={() => {}} />);
    const frTile = screen.getByRole('radio', { name: /Français/ });
    expect(frTile).toHaveAttribute('aria-checked', 'true');
    const enTile = screen.getByRole('radio', { name: /English/ });
    expect(enTile).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onSelectLocale with the clicked tile code', async () => {
    const onSelectLocale = vi.fn();
    render(<LanguageTab locales={locales} selectedLocale="en" onSelectLocale={onSelectLocale} />);
    await userEvent.click(screen.getByRole('radio', { name: /Français/ }));
    expect(onSelectLocale).toHaveBeenCalledWith('fr');
  });

  it('renders every supplied locale as a tile with its code', () => {
    render(<LanguageTab locales={locales} selectedLocale="en" onSelectLocale={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText('fr')).toBeInTheDocument();
  });

  it('renders translated aria-label when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Language: 'Langue' } }} initialLocale="fr">
        <LanguageTab locales={locales} selectedLocale="en" onSelectLocale={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Langue' })).toBeInTheDocument();
  });
});
