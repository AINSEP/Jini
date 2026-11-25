import { describe, expect, it } from 'vitest';
import { consentTranslation } from '../consent-i18n.js';

/** Two hosts with different product names must each get their own name interpolated into every
 * locale's translated copy; nothing in the reusable dictionary may spell a product of Jini's own. */
describe('consentTranslation product copy', () => {
  it('binds each host\'s product name into the translated built-in-banner label', () => {
    expect(consentTranslation({ locale: 'de', productName: 'Acme' }).dictionary['Acme banner']).toBe('Acme-Banner');
    expect(consentTranslation({ locale: 'de', productName: 'Zeta' }).dictionary['Zeta banner']).toBe('Zeta-Banner');
    expect(consentTranslation({ locale: 'fr', productName: 'Acme' }).dictionary['Acme banner']).toBe('Bannière Acme');
    expect(consentTranslation({ locale: 'fr', productName: 'Zeta' }).dictionary['Zeta banner']).toBe('Bannière Zeta');
  });

  it('leaves no unbound token and no Jini product name in any locale it ships', () => {
    for (const locale of ['es', 'id', 'de', 'zh-CN', 'zh-TW', 'ru', 'ja', 'ko', 'fr', 'tr', 'th', 'hi', 'bn']) {
      const { dictionary } = consentTranslation({ locale, productName: 'Acme' });
      expect(JSON.stringify(dictionary), locale).not.toMatch(/\{productName\}|Jini banner/);
      if (dictionary['Acme banner']) expect(dictionary['Acme banner'], locale).toContain('Acme');
    }
  });

  it('keeps the English page copy and an empty dictionary for the source locale', () => {
    const translation = consentTranslation({ locale: 'en', productName: 'Acme' });
    expect(translation.t('Cookie Consent')).toBe('Cookie Consent');
    expect(translation.dictionary).toEqual({});
  });
});
