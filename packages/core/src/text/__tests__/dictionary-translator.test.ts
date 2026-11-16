import { describe, expect, it } from 'vitest';
import { createDictionaryTranslator } from '../dictionary-translator.js';
const common = { es: { Save: 'Guardar' } };
describe('injected dictionaries', () => {
  it('exposes the caller dictionary so untranslated copy cannot hide behind fallback', () => {
    const dictionary = { es: {} };
    const translate = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary: common });
    expect(translate({ locale: 'es', key: 'Save' })).toBe('Guardar');
    expect(translate.dictionary).toBe(dictionary);
    expect(translate.dictionary.es).toEqual({});
  });
  it('prefers feature copy', () => expect(createDictionaryTranslator({ featureDictionary: { es: { Save: 'Guardar todo' } } }, { commonDictionary: common })({ locale: 'es', key: 'Save' })).toBe('Guardar todo'));
  it('falls back to caller common copy', () => expect(createDictionaryTranslator({ featureDictionary: { es: {} } }, { commonDictionary: common })({ locale: 'es', key: 'Save' })).toBe('Guardar'));
  it('falls back to the source key', () => expect(createDictionaryTranslator({ featureDictionary: { es: {} } }, { commonDictionary: common })({ locale: 'es', key: 'unknown' })).toBe('unknown'));
  it('falls back for an unsupported locale', () => expect(createDictionaryTranslator({ featureDictionary: { es: { Save: 'Guardar' } } }, { commonDictionary: common })({ locale: 'xx', key: 'Save' })).toBe('Save'));
  it('needs no common dictionary', () => expect(createDictionaryTranslator({ featureDictionary: {} })({ locale: 'en', key: 'Save' })).toBe('Save'));
  it('does not translate through prototype properties', () => expect(createDictionaryTranslator({ featureDictionary: {} })({ locale: 'constructor', key: 'name' })).toBe('name'));
});
