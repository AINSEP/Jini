import { describe, expect, it } from 'vitest';
import { resolveSystemLocale } from '../locale.js';

describe('resolveSystemLocale characterization', () => {
  const cases: {
    name: string;
    languages: readonly string[];
    supportedLocales: readonly string[];
    expected: string | null;
  }[] = [
    { name: 'skips empty and whitespace-only preferences', languages: ['', ' \t ', 'fr'], supportedLocales: ['fr'], expected: 'fr' },
    { name: 'trims preferences and preserves supported spelling', languages: [' Pt-bR '], supportedLocales: ['PT-br'], expected: 'PT-br' },
    { name: 'uses the first exact match ignoring case', languages: ['FR'], supportedLocales: ['fr', 'FR'], expected: 'fr' },
    { name: 'prefers an exact Chinese tag over the script fallback', languages: ['zh-hant'], supportedLocales: ['zh-TW', 'ZH-Hant'], expected: 'ZH-Hant' },
    { name: 'prefers an exact Chinese region over its traditional fallback', languages: ['zh-HK'], supportedLocales: ['zh-TW', 'zh-HK'], expected: 'zh-HK' },
    { name: 'maps Hant to traditional before the first base match', languages: ['zh-Hant'], supportedLocales: ['zh-CN', 'zh-TW'], expected: 'zh-TW' },
    { name: 'maps TW to traditional', languages: ['zh-tw-x-private'], supportedLocales: ['zh-CN', 'zh-TW'], expected: 'zh-TW' },
    { name: 'maps HK to traditional', languages: ['zh-HK'], supportedLocales: ['zh-CN', 'zh-TW'], expected: 'zh-TW' },
    { name: 'maps MO to traditional', languages: ['zh-MO'], supportedLocales: ['zh-CN', 'zh-TW'], expected: 'zh-TW' },
    { name: 'maps a bare Chinese tag to simplified before the first base match', languages: ['zh'], supportedLocales: ['zh-TW', 'zh-CN'], expected: 'zh-CN' },
    { name: 'maps Hans to simplified', languages: ['zh-Hans'], supportedLocales: ['zh-TW', 'zh-CN'], expected: 'zh-CN' },
    { name: 'maps an unrecognized Chinese subtag to simplified', languages: ['zh-SG'], supportedLocales: ['zh-TW', 'zh-CN'], expected: 'zh-CN' },
    { name: 'uses the second Chinese subtag when later subtags are present', languages: ['zh-Hans-TW'], supportedLocales: ['zh-TW', 'zh-CN'], expected: 'zh-CN' },
    { name: 'falls back to the first Chinese variant when traditional is unavailable', languages: ['zh-Hant'], supportedLocales: ['zh-Hans', 'zh-CN'], expected: 'zh-Hans' },
    { name: 'falls back to traditional when simplified is unavailable', languages: ['zh'], supportedLocales: ['zh-TW'], expected: 'zh-TW' },
    { name: 'requires canonical case for the Chinese special-case candidate', languages: ['zh-Hant'], supportedLocales: ['ZH-cn', 'zh-tw'], expected: 'ZH-cn' },
    { name: 'continues to the next preference when Chinese is unsupported', languages: ['zh-Hant', 'fr'], supportedLocales: ['fr'], expected: 'fr' },
    { name: 'falls back to a bare non-Chinese language', languages: ['en-GB'], supportedLocales: ['en'], expected: 'en' },
    { name: 'falls back to the first non-Chinese regional variant', languages: ['en-AU'], supportedLocales: ['EN-US', 'en-GB'], expected: 'EN-US' },
    { name: 'prefers an earlier base match over a later exact preference', languages: ['en-AU', 'fr'], supportedLocales: ['fr', 'en-US'], expected: 'en-US' },
    { name: 'continues past unsupported preferences', languages: ['xx', 'fr'], supportedLocales: ['en', 'fr'], expected: 'fr' },
    { name: 'does not return a falsy base match', languages: ['-x', 'fr'], supportedLocales: ['', 'fr'], expected: 'fr' },
    { name: 'returns null for no preferences', languages: [], supportedLocales: ['en'], expected: null },
    { name: 'returns null for no supported locales', languages: ['en', 'zh-Hant'], supportedLocales: [], expected: null },
    { name: 'returns null after exhausting unsupported preferences', languages: ['xx', 'yy'], supportedLocales: ['en'], expected: null },
    { name: 'returns null when every preference is blank', languages: ['', '  '], supportedLocales: [''], expected: null },
  ];

  it.each(cases)('$name', ({ languages, supportedLocales, expected }) => {
    expect(resolveSystemLocale(languages, supportedLocales)).toBe(expected);
  });
});
