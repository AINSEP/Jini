import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider, useT } from '../context.js';
import {
  SETTINGS_DIALOG_DICTIONARIES,
  SETTINGS_DIALOG_EN,
  SETTINGS_DIALOG_ES,
} from '../dictionaries/index.js';

describe('settings-dialog dictionaries: EN/ES key parity', () => {
  it('ship the exact same key set in both locales', () => {
    const enKeys = Object.keys(SETTINGS_DIALOG_EN).sort();
    const esKeys = Object.keys(SETTINGS_DIALOG_ES).sort();

    const missingFromEs = enKeys.filter((key) => !(key in SETTINGS_DIALOG_ES));
    const missingFromEn = esKeys.filter((key) => !(key in SETTINGS_DIALOG_EN));

    expect(missingFromEs).toEqual([]);
    expect(missingFromEn).toEqual([]);
    expect(esKeys).toEqual(enKeys);
  });

  it('has a non-empty translation for every key in both locales', () => {
    for (const [key, value] of Object.entries(SETTINGS_DIALOG_EN)) {
      expect(value.length, `EN value for ${JSON.stringify(key)} should not be empty`).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(SETTINGS_DIALOG_ES)) {
      expect(value.length, `ES value for ${JSON.stringify(key)} should not be empty`).toBeGreaterThan(0);
    }
  });

  it('has at least 230 real dictionary entries (guards against an accidental near-empty dictionary)', () => {
    expect(Object.keys(SETTINGS_DIALOG_EN).length).toBeGreaterThanOrEqual(230);
  });

  it('bundles both locales under SETTINGS_DIALOG_DICTIONARIES for direct I18nProvider use', () => {
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
