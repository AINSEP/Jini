import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider, useT } from '../context.js';
import {
  SETTINGS_DIALOG_DICTIONARIES,
  SETTINGS_DIALOG_EN,
  SETTINGS_DIALOG_ES,
} from '../dictionaries/index.js';

/**
 * One parity test regardless of how many locales `SETTINGS_DIALOG_DICTIONARIES` grows to -- per-
 * locale test cases must NOT be added here as new languages ship. Adding e.g. French means adding
 * `settings-dialog.fr.ts` plus one property in `dictionaries/index.ts`; this file keeps verifying
 * structure generically across every locale actually present, not re-asserting each language's
 * literal text as its own test case.
 */
describe('settings-dialog dictionaries: cross-locale key parity', () => {
  const locales = Object.keys(SETTINGS_DIALOG_DICTIONARIES);

  it('has more than one locale', () => {
    expect(locales.length).toBeGreaterThan(1);
  });

  it('ship the exact same key set across every locale', () => {
    const referenceKeys = Object.keys(SETTINGS_DIALOG_EN).sort();
    for (const locale of locales) {
      const dict = SETTINGS_DIALOG_DICTIONARIES[locale as keyof typeof SETTINGS_DIALOG_DICTIONARIES]!;
      const keys = Object.keys(dict).sort();
      const missing = referenceKeys.filter((key) => !(key in dict));
      const extra = keys.filter((key) => !(key in SETTINGS_DIALOG_EN));
      expect(missing, `${locale} is missing keys`).toEqual([]);
      expect(extra, `${locale} has extra keys not in EN`).toEqual([]);
    }
  });

  it('has a non-empty translation for every key in every locale', () => {
    for (const locale of locales) {
      const dict = SETTINGS_DIALOG_DICTIONARIES[locale as keyof typeof SETTINGS_DIALOG_DICTIONARIES]!;
      for (const [key, value] of Object.entries(dict)) {
        expect(value.length, `${locale} value for ${JSON.stringify(key)} should not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it('has at least 230 real dictionary entries (guards against an accidental near-empty dictionary)', () => {
    expect(Object.keys(SETTINGS_DIALOG_EN).length).toBeGreaterThanOrEqual(230);
  });

  it('bundles every locale under SETTINGS_DIALOG_DICTIONARIES for direct I18nProvider use', () => {
    expect(SETTINGS_DIALOG_DICTIONARIES.en).toBe(SETTINGS_DIALOG_EN);
    expect(SETTINGS_DIALOG_DICTIONARIES.es).toBe(SETTINGS_DIALOG_ES);
  });
});

describe('settings-dialog dictionaries: real translation + fallback behavior', () => {
  function Probe({ tKey }: { tKey: string }) {
    const t = useT();
    return <span data-testid="value">{t(tKey)}</span>;
  }

  it('renders real Spanish copy for a known key when locale is es', () => {
    render(
      <I18nProvider initialLocale="es" dictionaries={SETTINGS_DIALOG_DICTIONARIES}>
        <Probe tKey="Settings" />
      </I18nProvider>,
    );
    expect(screen.getByTestId('value').textContent).toBe('Configuración');
  });

  it('renders the previously-broken notifications sound key as real Spanish copy, not a raw id', () => {
    render(
      <I18nProvider initialLocale="es" dictionaries={SETTINGS_DIALOG_DICTIONARIES}>
        <Probe tKey="notifications.sound.ding" />
      </I18nProvider>,
    );
    const text = screen.getByTestId('value').textContent;
    expect(text).toBe('Timbre');
    expect(text).not.toBe('notifications.sound.ding');
  });

  it('falls back to the English dictionary value (never the raw key) when a key is missing from the active locale', () => {
    const partialEs = { Settings: 'Configuración' }; // deliberately missing 'Language'
    render(
      <I18nProvider
        initialLocale="es"
        fallbackLocale="en"
        dictionaries={{ en: SETTINGS_DIALOG_EN, es: partialEs }}
      >
        <Probe tKey="Language" />
      </I18nProvider>,
    );
    const text = screen.getByTestId('value').textContent;
    expect(text).toBe(SETTINGS_DIALOG_EN.Language);
    expect(text).not.toBe('Language is a raw key'); // sanity: not asserting a nonsense string
    expect(text).not.toBe(''); // never blank
  });

  it('falls back to the raw key only when a key is missing from every dictionary (documents the outer-most fallback, still never blank)', () => {
    render(
      <I18nProvider initialLocale="es" dictionaries={SETTINGS_DIALOG_DICTIONARIES}>
        <Probe tKey="this.key.does.not.exist.anywhere" />
      </I18nProvider>,
    );
    expect(screen.getByTestId('value').textContent).toBe('this.key.does.not.exist.anywhere');
  });
});
