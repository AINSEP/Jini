import { expect, test } from 'vitest';
import { memoryText } from '../memory-i18n.js';

// English is the source copy, represented by the key itself rather than an en dictionary.
const english = [
  'Save note', 'Uninstall · keep memory', 'Uninstall and delete memory',
  'Save plugin note?', 'File', 'Note',
] as const;
const locales = [
  'es', 'id', 'de', 'zh-CN', 'zh-TW', 'pt-BR', 'ru', 'fa', 'ar', 'ja', 'ko',
  'pl', 'hu', 'fr', 'uk', 'tr', 'th', 'it', 'hi', 'ur', 'bn',
] as const;

test.each(locales)('%s translates every source label and distinguishes keeping from deleting memory', locale => {
  const translated = Object.fromEntries(english.map(key => [key, memoryText({ key, locale })]));
  for (const key of english) {
    const text = translated[key]!;
    expect(text.trim(), key).not.toBe('');
    expect(text, key).not.toBe(key);
  }
  expect(translated['Uninstall · keep memory']).not.toBe(translated['Uninstall and delete memory']);
});

test('preserves the source label for English, unknown locales and unknown keys', () => {
  for (const key of english) {
    expect(memoryText({ key })).toBe(key);
    expect(memoryText({ key, locale: 'en' })).toBe(key);
    expect(memoryText({ key, locale: 'zz-ZZ' })).toBe(key);
  }
  expect(memoryText({ key: 'Archived note', locale: 'es' })).toBe('Archived note');
});

test('Spanish and Chinese variants select the requested locale, not a generic translation', () => {
  expect(memoryText({ key: 'Save note', locale: 'es' })).toBe('Guardar nota');
  expect(memoryText({ key: 'Save note', locale: 'zh-CN' })).toBe('保存笔记');
  expect(memoryText({ key: 'Save note', locale: 'zh-TW' })).toBe('儲存筆記');
});

test('an unlisted key returns literal copy even when it is also a JavaScript object method name', () => {
  expect(memoryText({ key: 'constructor', locale: 'es' })).toBe('constructor');
  expect(memoryText({ key: 'toString', locale: 'constructor' })).toBe('toString');
});
