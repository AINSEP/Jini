import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.name === '__tests__' || /\.test\./.test(entry.name)) return [];
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx|css)$/.test(file) ? [file] : [];
  });
}

it('keeps admin product-neutral and reads component colors from the variable contract', () => {
  const sourceRoot = path.resolve(__dirname, '../../..');
  for (const file of sourceFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    if (path.relative(sourceRoot, file).startsWith(`themes${path.sep}`) && file.endsWith('.css')) {
      // Theme assets own values; consume the entire flat sheet so imports/nested rules cannot escape.
      const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
      const rules = [...source.matchAll(rulePattern)];
      expect(source.replace(rulePattern, '').trim(), file).toBe('');
      for (const [, selectors = '', body = ''] of rules) {
        for (const selector of selectors.split(',')) {
          expect([':root', '[data-admin-theme]', '[data-color-scheme]'], file).toContain(selector.trim());
        }
        for (const declaration of body.split(';').map((value) => value.trim()).filter(Boolean)) {
          expect(declaration, file).toMatch(/^--jini-[\w-]+\s*:\s*[^{}]+$/);
        }
      }
      continue;
    }
    if (/\.(?:tsx|css)$/.test(file)) expect(source, file).not.toMatch(/#[\da-f]{3,8}\b|(?:rgba?|hsla?|oklch)\(/i);
  }
});
