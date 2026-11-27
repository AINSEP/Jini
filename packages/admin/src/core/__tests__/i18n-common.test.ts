import { describe, expect, it } from 'vitest';
import { ADMIN_COMMON_I18N } from '../i18n-common.js';

/** The 21 locales the host's common dictionary shipped with when its generic entries moved here. */
const LOCALES = [
  'es', 'de', 'it', 'zh-CN', 'zh-TW', 'ar', 'fa', 'ru', 'ja', 'id', 'pt-BR',
  'ko', 'pl', 'hu', 'fr', 'uk', 'tr', 'th', 'hi', 'ur', 'bn',
];

const VERSION_CONFLICT_KEY =
  'Someone else changed this while you were editing. Your changes were not saved. Copy anything you want to keep, then reload to see their version.';

describe('ADMIN_COMMON_I18N', () => {
  it('ships exactly the original 21 locales', () => {
    expect(Object.keys(ADMIN_COMMON_I18N).sort()).toEqual([...LOCALES].sort());
  });

  it('gives every locale the same generic key set', () => {
    const spanishKeys = Object.keys(ADMIN_COMMON_I18N.es ?? {}).sort();
    expect(spanishKeys.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      expect(Object.keys(ADMIN_COMMON_I18N[locale] ?? {}).sort(), locale).toEqual(spanishKeys);
    }
  });

  it('pins three generic keys per locale to non-empty translations', () => {
    for (const locale of LOCALES) {
      for (const key of ['Save', 'Cancel', 'Delete']) {
        expect(ADMIN_COMMON_I18N[locale]?.[key], `${locale} ${key}`).toMatch(/\S/);
      }
    }
  });

  it('keeps the Spanish Save translation verbatim', () => {
    expect(ADMIN_COMMON_I18N.es?.Save).toBe('Guardar');
  });

  it('keeps "Built-in" and "Wrap: on" through assembly', () => {
    expect(ADMIN_COMMON_I18N.es?.['Built-in']).toBe('Integrado');
    expect(ADMIN_COMMON_I18N.es?.['Wrap: on']).toBe('Ajuste: activado');
    for (const locale of LOCALES) {
      expect(ADMIN_COMMON_I18N[locale]?.['Built-in'], locale).toMatch(/\S/);
      expect(ADMIN_COMMON_I18N[locale]?.['Wrap: on'], locale).toMatch(/\S/);
    }
  });

  it('keeps the version-conflict entry after the branded extra is split out', () => {
    expect(ADMIN_COMMON_I18N.es?.[VERSION_CONFLICT_KEY]).toBe(
      'Otra persona cambió esto mientras editabas. Tus cambios no se guardaron. Copia lo que quieras conservar y luego recarga para ver su versión.',
    );
    for (const locale of LOCALES) expect(ADMIN_COMMON_I18N[locale]?.[VERSION_CONFLICT_KEY], locale).toMatch(/\S/);
  });

  it('keeps the positional extras aligned around the removed branded entry', () => {
    // The entries either side of the removed one: an off-by-one in the split shifts these first.
    expect(ADMIN_COMMON_I18N.es?.['changed while you were deciding. Check the list again.']).toBe(
      'cambió mientras decidías. Revisa la lista de nuevo.',
    );
    expect(ADMIN_COMMON_I18N.es?.['Menu links follow:']).toBe('Enlaces de menú afectados:');
  });

  it('leaves the product-branded older-version entry with the host', () => {
    // Matched by its generic tail so this file never names the product itself.
    const branded = /^is on an older .+ and can't overwrite these yet\. Update it, then publish again\.$/;
    for (const locale of LOCALES) {
      expect(Object.keys(ADMIN_COMMON_I18N[locale] ?? {}).filter((key) => branded.test(key)), locale).toEqual([]);
    }
  });
});

it('keeps every assembled translation non-empty and preserves its named placeholders', () => {
  const tokens = (value: string) => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();
  for (const [locale, dict] of Object.entries(ADMIN_COMMON_I18N)) {
    for (const [key, value] of Object.entries(dict)) {
      expect(value.trim(), `${locale} / ${key}`).not.toBe('');
      expect(tokens(value), `${locale} / ${key}`).toEqual(tokens(key));
    }
  }
});
