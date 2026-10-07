import { expect, it } from 'vitest';
import { SETTINGS_DIALOG_DICTIONARIES } from '../dictionaries/index.js';
const notice = 'I removed what looked like a key from your message. If it was real, rotate it. Use the secure form to save it.';
const guidance = 'Use the secure form to save keys, tokens, passwords, and secrets. Chat answers are sent to the assistant.';
it('ships credential guidance and paste-removal translations for every shipped locale', () => {
  for (const [locale, localeDictionary] of Object.entries(SETTINGS_DIALOG_DICTIONARIES)) {
    expect(localeDictionary, locale).toBeDefined();
    const dictionary = localeDictionary!;
    for (const key of [notice, guidance]) {
      expect(typeof dictionary[key], locale).toBe('string');
      expect(dictionary[key]?.trim().length, locale).toBeGreaterThan(0);
      if (locale !== 'en') expect(dictionary[key], locale).not.toBe(key);
    }
    expect(typeof dictionary.Show, locale).toBe('string');
    expect(typeof dictionary.Hide, locale).toBe('string');
  }
  const spanishDictionary = SETTINGS_DIALOG_DICTIONARIES.es;
  expect(spanishDictionary).toBeDefined();
  expect(spanishDictionary![notice]).toBe('He eliminado de tu mensaje lo que parecía una clave. Si era real, cámbiala. Usa el formulario seguro para guardarla.');
});
