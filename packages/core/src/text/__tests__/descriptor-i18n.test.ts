import { describe, expect, it } from 'vitest';
import { parseDescriptorI18n } from '../descriptor-i18n.js';

const parse = (value: unknown) => parseDescriptorI18n({ value, at: 'plugin.i18n' });
const entries = (size: number) => Object.fromEntries(
  Array.from({ length: size }, (_, i) => [`Help text ${i}`, `Ayuda ${i}`]),
);
const locales = (size: number) => Object.fromEntries(
  Array.from({ length: size }, (_, i) => [`es-x0${String(i).padStart(2, '0')}`, { Open: 'Abrir' }]),
);

describe('descriptor translations', () => {
  it('preserves exact source text and distinguishes absent from empty dictionaries', () => {
    expect(parse(undefined)).toBeUndefined();
    expect(parse({})).toEqual({});
    expect(parse({ 'pt-BR': { ' Open ': ' Abrir ' }, es: { Open: 'Abrir', Close: 'Cerrar' } })).toEqual({
      'pt-BR': { ' Open ': ' Abrir ' }, es: { Open: 'Abrir', Close: 'Cerrar' },
    });
  });

  it('names the offending dictionary or locale and retains the first failure', () => {
    for (const input of [null, [], 'English']) {
      expect(parse(input)).toBe('plugin.i18n must map locales to translations');
    }
    expect(parse({ 'pt_BR': {}, es: [] })).toBe("plugin.i18n has an invalid locale 'pt_BR'");
    for (const input of [null, [], 'Abrir']) {
      expect(parse({ es: input })).toBe('plugin.i18n.es must map English text to its translation');
    }
  });

  it('accepts the locale and string count ceilings and refuses each first excess entry', () => {
    const maxLocales = locales(64);
    expect(parse(maxLocales)).toEqual(maxLocales);
    expect(parse(locales(65))).toBe('plugin.i18n must declare at most 64 locales');
    const maxEntries = entries(200);
    expect(parse({ es: maxEntries })).toEqual({ es: maxEntries });
    expect(parse({ es: entries(201) })).toBe('plugin.i18n.es must declare at most 200 strings');
  });

  it('rejects blank or oversized keys and blank, non-string or oversized translations', () => {
    const english = 'E'.repeat(500);
    const spanish = 'T'.repeat(2000);
    expect(parse({ es: { [english]: spanish } })).toEqual({ es: { [english]: spanish } });
    for (const source of [' \t', english + 'E']) {
      expect(parse({ es: { [source]: 'Texto' } })).toBe('plugin.i18n.es keys must be non-empty English text of at most 500 characters');
    }
    for (const translation of [' \t', 12, spanish + 'T']) {
      expect(parse({ es: { Text: translation } })).toBe('plugin.i18n.es translations must be non-empty strings of at most 2000 characters');
    }
  });
});
