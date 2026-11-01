import { expect, it } from 'vitest';
import { SETTINGS_DIALOG_DICTIONARIES } from '../dictionaries/index.js';

it('ships translated folder chip copy with intact path/count tokens in every dictionary', () => {
  for (const [locale, dictionary] of Object.entries(SETTINGS_DIALOG_DICTIONARIES)) {
    for (const key of ['Folders ({count})', 'Copy folder path: {path}', 'Remove folder: {path}']) {
      const text = dictionary?.[key];
      expect(text, `${locale}: ${key}`).toBeTruthy();
      expect(text).toContain(key.includes('{count}') ? '{count}' : '{path}');
      if (locale !== 'en') expect(text).not.toBe(key);
    }
  }
});
