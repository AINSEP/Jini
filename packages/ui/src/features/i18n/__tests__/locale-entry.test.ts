// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

// React-free hosts (a vanilla embed bundle) match locales without loading the root barrel,
// which also exports the React i18n context.
it('publishes locale matching as a universal @jini-ai/ui/i18n/locale subpath', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  expect(manifest.exports['./i18n/locale']).toEqual({
    types: './dist/features/i18n/locale.d.ts',
    import: './dist/features/i18n/locale.js',
    default: './dist/features/i18n/locale.js',
  });
  expect(manifest.jini.entries['./i18n/locale']).toBe('universal');
});

it('keeps the locale module free of React and of runtime imports', () => {
  const source = readFileSync(join(root, 'src/features/i18n/locale.ts'), 'utf8');
  const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gm)].map(([, typeOnly, from]) => ({ typeOnly: Boolean(typeOnly), from }));
  expect(imports).toEqual([{ typeOnly: true, from: './types.js' }]);
  expect(source).not.toMatch(/\breact\b['/]/);
});
