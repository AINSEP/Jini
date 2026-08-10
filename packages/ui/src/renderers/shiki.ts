/**
 * Syntax-highlighted code fragments for artifact rendering. Verbatim port of
 * `apps/web/src/runtime/shiki.ts` in the origin project — no product-specific
 * logic in the original. See `source-map.md`.
 */
import type { BundledLanguage, BundledTheme, HighlighterGeneric } from 'shiki/bundle/web';

let highlighterPromise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | null = null;

const cache = new Map<string, string>();
const CACHE_MAX = 128;

// The origin project's list also requested 'rust', 'go', 'swift', 'ruby', 'diff',
// 'toml', 'dockerfile' — this package's pinned `shiki` version's
// `bundle/web` (a deliberately size-trimmed, browser-focused subset) does
// not ship grammars for those, so they're dropped here rather than typed
// around with a cast that would fail at runtime. See `source-map.md`.
function getHighlighter(): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki/bundle/web').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['github-light-default', 'github-dark-default'],
        langs: [
          'javascript', 'typescript', 'tsx', 'jsx', 'html', 'css', 'json',
          'python', 'bash', 'shell', 'markdown', 'yaml', 'sql',
          'java', 'c', 'cpp', 'php', 'xml', 'graphql',
        ],
      }),
    );
  }
  return highlighterPromise;
}

function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  const dark = isDarkMode();
  const cacheKey = `${dark ? 'd' : 'l'}:${lang}:${code}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const highlighter = await getHighlighter();
  const loadedLangs = highlighter.getLoadedLanguages();
  if (!loadedLangs.includes(lang as BundledLanguage)) {
    return '';
  }

  const html = highlighter.codeToHtml(code, {
    lang: lang as BundledLanguage,
    theme: dark ? 'github-dark-default' : 'github-light-default',
  });

  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(cacheKey, html);
  return html;
}
