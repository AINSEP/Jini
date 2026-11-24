import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionSources(filename);
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [filename] : [];
  });
}

test('publishes user management from its canonical folder and preserves runtime entries', () => {
  expect(manifest.name).toBe('@jini-ai/user-management');
  expect(manifest.repository.directory).toBe('packages/user-management');
  expect(manifest.jini).toMatchObject({ domain: 'capability', kind: 'user-management' });
  expect(manifest.jini.entries).toEqual({
    '.': 'universal',
    './session-bootstrap': 'universal',
    './server': 'node',
    './admin-http/auth': 'node',
    './react': 'browser',
    './react/testing': 'browser',
    './react/kit': 'browser',
    './admin': 'universal',
    './admin/react': 'browser',
    './admin/adapters/http': 'universal',
    './admin/adapters/memory': 'universal',
    './admin/conformance': 'universal',
    './identity/boot-session-token': 'node',
    './identity/builtin-role-grants': 'universal',
    './identity/permission-grants': 'universal',
    './identity/role-manage-permission': 'universal',
    './identity/user-manage-permission': 'universal',
    './identity/site-key-permission': 'universal',
    './identity/api-key-types': 'universal',
    './identity/api-key-secret': 'node',
    './identity/api-key-service': 'node',
    './identity/owner-reset-env': 'universal',
    './identity/repo.memory': 'universal',
    './identity/user-purge-types': 'universal',
    './identity/username-change-ports': 'universal',
    './identity/delete-user-service': 'universal',
    './react/auth/owner-mfa-api': 'browser',
    './react/auth/owner-passkey-api': 'browser',
    './react/auth/owner-recovery-api': 'browser',
    './react/auth/local-owner-signin': 'browser',
  });
  expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(manifest.jini.entries).sort());
  for (const [entry, value] of Object.entries(manifest.exports)) {
    const paths = value as { import: string; types: string; default: string };
    expect(paths.types, entry).toBe(paths.import.replace(/\.js$/, '.d.ts'));
    expect(paths.default, entry).toBe(paths.import);
    const stem = paths.import.replace('./dist/', './src/').replace(/\.js$/, '');
    // A React entry that renders JSX (kit.tsx) has a .tsx source; every other entry is plain .ts.
    expect(existsSync(join(packageRoot, `${stem}.ts`)) || existsSync(join(packageRoot, `${stem}.tsx`)), entry).toBe(true);
  }
  expect(existsSync(new URL('../../../identity/package.json', import.meta.url))).toBe(false);
});

test('keeps production sources independent of application code and the retired package name', () => {
  const files = productionSources(join(packageRoot, 'src'));
  expect(files.length).toBeGreaterThan(0);
  for (const filename of files) {
    const source = readFileSync(filename, 'utf8');
    expect(source, filename).not.toContain('@jini-ai/' + 'identity');
  }
});
