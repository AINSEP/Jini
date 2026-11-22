/** L7: a package's CSS reads only the shared theme tokens or its own `--jini-<pkg>-*` namespace, and
 * never `@import`s another Jini package's CSS. The shared token list is names only (no values); until
 * core exports `JINI_THEME_TOKENS`, `scripts/injection-css-tokens.json` is its single source. */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { packageSourceFiles, type SourcePackage } from './package-sources.js';
import type { Finding } from './injection-debt.js';

const RULE = 'L7-css-tokens';

export function loadThemeTokens(required: { root: string }, _optional: Record<string, never> = {}): Set<string> {
  const path = join(required.root, 'scripts', 'injection-css-tokens.json');
  if (!existsSync(path)) return new Set();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { tokens?: string[] };
  return new Set(parsed.tokens ?? []);
}

/** Comments may mention var(--x) in prose; only live declarations count. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function cssFindings(required: { css: string; file: string; owner: string; tokens: ReadonlySet<string> }): Finding[] {
  const found: Finding[] = [];
  const css = stripComments(required.css);
  const own = `--jini-${required.owner}-`;
  const base = { rule: RULE, file: required.file };
  for (const match of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const name = match[1]!;
    if (required.tokens.has(name) || name.startsWith(own)) continue;
    found.push({ ...base, spec: name, kind: 'css-var', reason: `${required.owner} CSS reads ${name}: use a shared theme token or ${own}*` });
  }
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?["']?(@jini-ai\/[^"')\s]+)/g)) {
    found.push({ ...base, spec: match[1]!, kind: 'css-import', reason: `${required.owner} CSS imports ${match[1]!}: the host imports each package's CSS` });
  }
  return found;
}

export function cssTokenFindings(
  required: { root: string; packages: readonly SourcePackage[]; tokens: ReadonlySet<string> },
  _optional: Record<string, never> = {},
): Finding[] {
  return required.packages.flatMap(pkg => packageSourceFiles({ directory: pkg.directory })
    .filter(file => file.endsWith('.css'))
    .flatMap(filename => cssFindings({
      css: readFileSync(filename, 'utf8'),
      file: relative(required.root, filename).split('\\').join('/'),
      owner: pkg.manifest.name.slice('@jini-ai/'.length),
      tokens: required.tokens,
    })));
}
