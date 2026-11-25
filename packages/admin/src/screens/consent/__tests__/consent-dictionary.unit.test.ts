import { describe, expect, it } from 'vitest';
import { CONSENT_DICT, translate } from '../consent-dictionary.js';
import { consentTranslation } from '../consent-i18n.js';

/** @file The consent dictionary ships every key in all 21 admin locales across its locale modules,
 * and `consentTranslation` binds page copy and the field sections' block to one locale. */

const EXPECTED_LOCALES = ['ar', 'bn', 'de', 'es', 'fa', 'fr', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'uk', 'ur', 'zh-CN', 'zh-TW'];

describe('CONSENT_DICT', () => {
  it('covers the same 21 locales as the other admin dictionaries', () => {
    expect(Object.keys(CONSENT_DICT).sort()).toEqual(EXPECTED_LOCALES);
  });

  it('has the same non-empty keys in every locale', () => {
    const keys = Object.keys(CONSENT_DICT.es ?? {}).sort();
    for (const locale of EXPECTED_LOCALES) {
      expect(Object.keys(CONSENT_DICT[locale] ?? {}).sort(), locale).toEqual(keys);
      for (const [key, value] of Object.entries(CONSENT_DICT[locale] ?? {})) expect(value.trim(), `${locale} ${key}`).not.toBe('');
    }
  });

  it.each(EXPECTED_LOCALES)('translates the page title in %s', locale => {
    expect(translate({ locale, key: 'Cookie Consent' })).not.toBe('Cookie Consent');
  });
});

describe('consentTranslation', () => {
  it('translates page copy and hands the same locale block to the field sections', () => {
    const translation = consentTranslation({ locale: 'fr', productName: 'Acme' });
    expect(translation.t('Cookie Consent')).toBe('Consentement aux cookies');
    expect(translation.dictionary['Acme banner']).toBe('Bannière Acme');
  });

  it('falls through to English, with an empty dictionary, for a locale it does not ship', () => {
    const translation = consentTranslation({ locale: 'en', productName: 'Acme' });
    expect(translation.t('Cookie Consent')).toBe('Cookie Consent');
    expect(translation.dictionary).toEqual({});
  });
});
