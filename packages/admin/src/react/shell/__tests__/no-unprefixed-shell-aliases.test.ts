import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The admin shell's chrome classes moved to the `jini-admin-*` prefix, and the unprefixed aliases were
// dropped together with the host selectors that still used them. This guard keeps them from coming back
// as a class token in shell markup or as a selector in the packaged admin/ui stylesheets. Comments are
// stripped first, and the CSS container name `admin-content` (no leading dot) is not a class.
const ALIASES = ['boot-screen', 'admin-topbar', 'admin-topbar-toggle', 'admin-topbar-title', 'admin-main-col',
  'admin-content', 'admin-layout', 'skip-link', 'sidebar-backdrop'];
const NAME = `(${ALIASES.join('|')})`;
const CSS_SELECTOR = new RegExp(`(?<![-\\w])\\.${NAME}(?![-\\w])`, 'g');
// A quoted string whose whitespace-separated tokens include an alias: `className="x admin-layout"`, `"admin-layout"`.
const CLASS_TOKEN = new RegExp(`(["'\`])(?:[^"'\`\\n]*\\s)?${NAME}(?:\\s[^"'\`\\n]*)?\\1`, 'g');

// Resolved from the file path, not `new URL(...)`: under jsdom the global URL is not Node's, so fileURLToPath rejects it.
const packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../');
const ROOTS = [join(packagesDir, 'admin/src'), join(packagesDir, 'ui/src')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.(css|tsx?)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every `file: match` where an unprefixed shell alias appears outside a comment. */
export function findUnprefixedAliases(files: readonly { path: string; text: string }[]): string[] {
  return files.flatMap(({ path, text }) => {
    const pattern = path.endsWith('.css') ? CSS_SELECTOR : CLASS_TOKEN;
    return [...stripComments(text).matchAll(pattern)].map((match) => `${path}: ${match[0]}`);
  });
}

describe('admin shell class aliases', () => {
  it('finds no unprefixed shell alias in admin or ui source and stylesheets', () => {
    const files = ROOTS.flatMap(sourceFiles).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    expect(files.length).toBeGreaterThan(100);
    expect(findUnprefixedAliases(files)).toEqual([]);
  });

  it('flags an alias put back in markup or a selector, and ignores comments and the container name', () => {
    expect(findUnprefixedAliases([
      { path: 'a.tsx', text: '<div className="jini-admin-layout admin-layout">' },
      { path: 'b.ts', text: 'return ["admin-content"];' },
      { path: 'c.css', text: ':is(.jini-admin-content, .admin-content) a {}' },
      { path: 'd.css', text: '/* .admin-layout */ @container admin-content (max-width: 1px) {}' },
      { path: 'e.tsx', text: '// `.skip-link` in the host\nconst file = "admin-layout.pins.journey.ts";' },
    ])).toEqual(['a.tsx: "jini-admin-layout admin-layout"', 'b.ts: "admin-content"', 'c.css: .admin-content']);
  });
});
