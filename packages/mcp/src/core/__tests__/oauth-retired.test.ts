import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
function sources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry =>
    entry.name === '__tests__' ? [] : entry.isDirectory() ? sources(join(root, entry.name))
      : entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [join(root, entry.name)] : []);
}
test('the retired implementation is absent and protocol sources stay independent', () => {
  expect(existsSync(new URL('../oauth.ts', import.meta.url))).toBe(false);
  for (const file of sources(sourceRoot)) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/(?:from\s*|import\s*\()['"](?:@jini-ai\/oauth|[^'"\n]*core\/oauth|\.\/oauth\.js)['"]/);
  }
  for (const file of ['index.ts', 'core/index.ts']) {
    expect(readFileSync(join(sourceRoot, file), 'utf8'), file)
      .not.toMatch(/\b(?:PendingAuthCache|discoverAuthServer|registerClient|beginAuth|exchangeCodeForToken|generateCodeVerifier)\b/);
  }
});
