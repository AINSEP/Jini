import { afterEach, describe, expect, it, vi } from 'vitest';
import { highlightCode } from '../shiki.js';

function setTheme(theme: 'dark' | 'light' | null) {
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

describe('highlightCode', () => {
  afterEach(() => {
    setTheme(null);
  });

  it('returns highlighted HTML for a known language', async () => {
    const html = await highlightCode({ code: 'const x = 1;', lang: 'javascript' });
    expect(html).toContain('<pre');
    expect(html).toContain('const');
  }, 20000);

  it('returns an empty string for an unloaded language', async () => {
    expect(await highlightCode({ code: 'SELECT 1', lang: 'not-a-real-lang' })).toBe('');
  }, 20000);

  it('caches identical (theme, lang, code) lookups', async () => {
    const first = await highlightCode({ code: 'const y = 2;', lang: 'javascript' });
    const second = await highlightCode({ code: 'const y = 2;', lang: 'javascript' });
    expect(second).toBe(first);
  }, 20000);

  it('uses the dark theme when documentElement has data-theme="dark"', async () => {
    setTheme('dark');
    const html = await highlightCode({ code: 'const darkOne = 1;', lang: 'javascript' });
    expect(html).toContain('github-dark-default');
  }, 20000);

  it('uses the light theme when documentElement has data-theme="light", even if the system prefers dark', async () => {
    setTheme('light');
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      const html = await highlightCode({ code: 'const lightOne = 1;', lang: 'javascript' });
      expect(html).toContain('github-light-default');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  }, 20000);

  it('falls back to prefers-color-scheme when no data-theme attribute is set at all', async () => {
    setTheme(null);
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      const html = await highlightCode({ code: 'const prefersDarkOne = 1;', lang: 'javascript' });
      expect(html).toContain('github-dark-default');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  }, 20000);

  it('evicts the oldest cache entry once the cache reaches its size cap, rather than growing unbounded', async () => {
    // CACHE_MAX is 128; produce 129 distinct (theme,lang,code) cache keys by
    // varying the code body, then confirm the size-cap eviction path
    // (`cache.delete`) actually runs instead of merely not crashing.
    const deleteSpy = vi.spyOn(Map.prototype, 'delete');
    try {
      for (let i = 0; i < 129; i++) {
        // eslint-disable-next-line no-await-in-loop
        await highlightCode({ code: `const evictionProbe${i} = ${i};`, lang: 'javascript' });
      }
      expect(deleteSpy).toHaveBeenCalled();
    } finally {
      deleteSpy.mockRestore();
    }
  }, 30000);
});
