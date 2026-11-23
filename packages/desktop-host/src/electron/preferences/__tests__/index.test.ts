import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as preferences from '../index.js';

it('the ./electron/preferences entry exposes the preference mechanics and is published with desktop metadata', () => {
  expect(Object.keys(preferences).sort()).toEqual([
    'PREFERENCES_UNREADABLE', 'choiceOf', 'clampWholeNumber', 'persistedCheckbox', 'persistedRadioGroup',
    'positiveWholeNumber', 'readPreferenceSettings', 'readPreferenceValue', 'refreshCheckboxesByLabel',
    'refreshRadioGroup', 'registerPreferenceIpc', 'wholeNumberSteps', 'writePreferenceValue',
  ]);
  const manifest = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));
  const entry = 'electron/preferences/index';
  expect(manifest.exports['./electron/preferences']).toEqual({ types: `./dist/${entry}.d.ts`, import: `./dist/${entry}.js`, default: `./dist/${entry}.js` });
  expect(manifest.jini.entries['./electron/preferences']).toBe('desktop');
});
