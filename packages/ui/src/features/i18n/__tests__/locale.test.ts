import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultDetectSystemLocale, detectInitialLocale, resolveSystemLocale } from '../locale.js';
import type { LocalePersistencePort } from '../locale.js';
import { resolveSystemLocale as resolveCoreSystemLocale } from '../../../core.js';

describe('defaultDetectSystemLocale', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves against navigator.languages when present', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR', 'en'], language: 'en' });
    expect(defaultDetectSystemLocale(['en', 'fr'])).toBe('fr');
  });

  it('falls back to navigator.language when navigator.languages is empty', () => {
    vi.stubGlobal('navigator', { languages: [], language: 'fr' });
    expect(defaultDetectSystemLocale(['en', 'fr'])).toBe('fr');
  });

  it('returns null when navigator is entirely unavailable (SSR-style)', () => {
    vi.stubGlobal('navigator', undefined);
    expect(defaultDetectSystemLocale(['en', 'fr'])).toBeNull();
  });
});

describe('resolveSystemLocale', () => {
  const supported = ['en', 'fr', 'zh-CN', 'zh-TW', 'pt-BR'];

  it('pt-PT uses the available Portuguese dictionary through the framework-free entry point', () => {
    expect(resolveCoreSystemLocale({ languages: ['pt-PT'], supportedLocales: supported }, {})).toBe('pt-BR');
  });

  it('returns an exact case-insensitive match', () => {
    expect(resolveSystemLocale({ languages: ['FR'], supportedLocales: supported })).toBe('fr');
    expect(resolveSystemLocale({ languages: ['pt-br'], supportedLocales: supported })).toBe('pt-BR');
  });

  it('resolves a bare base-language tag to the matching supported locale', () => {
    expect(resolveSystemLocale({ languages: ['en-GB'], supportedLocales: supported })).toBe('en');
  });

  it('resolves Chinese script/region signals to simplified vs traditional', () => {
    expect(resolveSystemLocale({ languages: ['zh-Hant'], supportedLocales: supported })).toBe('zh-TW');
    expect(resolveSystemLocale({ languages: ['zh-TW'], supportedLocales: supported })).toBe('zh-TW');
    expect(resolveSystemLocale({ languages: ['zh-HK'], supportedLocales: supported })).toBe('zh-TW');
    expect(resolveSystemLocale({ languages: ['zh'], supportedLocales: supported })).toBe('zh-CN');
    expect(resolveSystemLocale({ languages: ['zh-SG'], supportedLocales: supported })).toBe('zh-CN');
  });

  it('does not resolve the Chinese special-case to an unsupported candidate', () => {
    expect(resolveSystemLocale({ languages: ['zh-Hant'], supportedLocales: ['en', 'zh-CN'] })).toBe('zh-CN');
  });

  it('falls through a list of preferred languages in order', () => {
    expect(resolveSystemLocale({ languages: ['xx', 'de', 'fr'], supportedLocales: supported })).toBe('fr');
  });

  it('skips blank entries without throwing', () => {
    expect(resolveSystemLocale({ languages: ['', '  ', 'fr'], supportedLocales: supported })).toBe('fr');
  });

  it('returns null when nothing matches', () => {
    expect(resolveSystemLocale({ languages: ['xx', 'yy'], supportedLocales: supported })).toBeNull();
  });

  it('returns null for an empty language list', () => {
    expect(resolveSystemLocale({ languages: [], supportedLocales: supported })).toBeNull();
  });
});

describe('detectInitialLocale', () => {
  const supportedLocales = ['en', 'fr'];

  it('prefers a persisted locale when it is supported', () => {
    const persistence: LocalePersistencePort = {
      getStoredLocale: () => 'fr',
      setStoredLocale: vi.fn(),
    };
    const result = detectInitialLocale({
      supportedLocales,
      fallbackLocale: 'en',
      persistence,
      detectSystemLocale: () => 'en',
    });
    expect(result).toBe('fr');
  });

  it('ignores a persisted locale outside the supported set', () => {
    const persistence: LocalePersistencePort = {
      getStoredLocale: () => 'de',
      setStoredLocale: vi.fn(),
    };
    const result = detectInitialLocale({
      supportedLocales,
      fallbackLocale: 'en',
      persistence,
      detectSystemLocale: () => 'fr',
    });
    expect(result).toBe('fr');
  });

  it('falls back to system detection when there is no persisted locale', () => {
    const result = detectInitialLocale({
      supportedLocales,
      fallbackLocale: 'en',
      detectSystemLocale: () => 'fr',
    });
    expect(result).toBe('fr');
  });

  it('falls back to fallbackLocale when nothing resolves', () => {
    const result = detectInitialLocale({
      supportedLocales,
      fallbackLocale: 'en',
      detectSystemLocale: () => 'de',
    });
    expect(result).toBe('en');
  });

  it('uses defaultDetectSystemLocale when detectSystemLocale is omitted', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR'], language: 'fr' });
    try {
      const result = detectInitialLocale({ supportedLocales, fallbackLocale: 'en' });
      expect(result).toBe('fr');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns fallbackLocale outside a window context (SSR)', () => {
    const original = globalThis.window;
    // @ts-expect-error -- simulate an SSR environment for this one assertion
    delete globalThis.window;
    try {
      const result = detectInitialLocale({
        supportedLocales,
        fallbackLocale: 'en',
        detectSystemLocale: () => 'fr',
      });
      expect(result).toBe('en');
    } finally {
      globalThis.window = original;
    }
  });
});
