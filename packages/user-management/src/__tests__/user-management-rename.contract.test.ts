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
    './react': 'browser',
    './react/testing': 'browser',
    './react/kit': 'browser',
    './react/members/members-i18n': 'browser',
    './admin': 'universal',
    './admin/react': 'browser',
    './admin/adapters/http': 'universal',
    './admin/adapters/memory': 'universal',
    './admin/conformance': 'universal',
    './member-login/oidc-login': 'node',
    './member-login/link-service': 'node',
    './members/auth-mail': 'universal',
    './members/access-resolver': 'node',
    './members/agent-tools': 'universal',
    './members/capability-card': 'universal',
    './members/consent-service': 'universal',
    './members/member-admin-writes': 'universal',
    './members/member-challenge': 'node',
    './members/member-challenge-request': 'node',
    './members/member-credentials': 'node',
    './members/member-sign-in': 'node',
    './members/member-validation': 'universal',
    './members/password-auth': 'node',
    './members/ports': 'universal',
    './members/repo.memory': 'universal',
    './members/subscriber-directory': 'universal',
    './members/trash-member': 'universal',
    './members/types': 'universal',
    './members/write-service': 'node',
    './newsletter/errors': 'universal',
    './newsletter/types': 'universal',
    './newsletter/ports': 'universal',
    './newsletter/campaign': 'universal',
    './newsletter/hooks': 'universal',
    './newsletter/lists': 'universal',
    './newsletter/campaign-write-service': 'universal',
    './newsletter/launch-gate': 'universal',
    './newsletter/repo.memory': 'universal',
    './newsletter/unsubscribe': 'node',
    './newsletter/send-pipeline': 'node',
    './newsletter/data-module-manifest': 'universal',
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
