import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { bindKernelUserTrashAdapter } from '../identity/sql/kernel-user-trash-store.js';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
// Member and newsletter entries that reach node:crypto or the Argon2/session-token server barrel,
// and SQL repositories that load kysely (a universal entry must not reach the query builder).
const nodeEntries = new Set(['./server/sql', './identity/repo', './identity/repo.authentication', './identity/repo.authorization',
  './project-keys/sql/attachments', './member-login/unlink-identity', './member-login/oidc-request','./server', './member-login/oidc-login', './member-login/link-service', './members/access-resolver', './members/member-challenge',
  './members/member-challenge-request', './members/member-credentials', './members/member-sign-in', './members/password-auth', './newsletter/unsubscribe',
  './newsletter/send-pipeline', './members/write-service', './admin-http/auth', './identity/boot-session-token', './identity/api-key-secret', './identity/api-key-service']);

test('every published entry has matching runtime metadata and a source module', () => {
  expect(typeof bindKernelUserTrashAdapter).toBe('function');
  expect(manifest.jini.entries['./identity/sql/user-trash-adapter']).toBe('universal');
  expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(manifest.jini.entries).sort());
  for (const [entry, value] of Object.entries(manifest.exports)) {
    const paths = value as { types: string; import: string; default: string };
    expect(paths.types).toBe(paths.import.replace(/\.js$/, '.d.ts'));
    expect(paths.default).toBe(paths.import);
    const stem = paths.import.replace('./dist/', './src/').replace(/\.js$/, '');
    // A React entry that renders JSX (kit.tsx) has a .tsx source; every other entry is plain .ts.
    const source = existsSync(new URL(`../../${stem}.tsx`, import.meta.url)) ? `${stem}.tsx` : `${stem}.ts`;
    expect(readFileSync(new URL(`../../${source}`, import.meta.url), 'utf8').length, entry).toBeGreaterThan(0);
    expect(manifest.jini.entries[entry]).toBe((entry.startsWith('./react') || entry === './admin/react') ? 'browser' : nodeEntries.has(entry) ? 'node' : 'universal');
  }
});

test('React dependencies are optional peers and available to package development', () => {
  for (const name of ['react', 'react-dom', '@jini-ai/ui-kit']) {
    expect(manifest.peerDependencies[name], name).toBeTruthy();
    expect(manifest.peerDependenciesMeta[name], name).toEqual({ optional: true });
    expect(manifest.devDependencies[name], name).toBeTruthy();
    expect(manifest.dependencies?.[name], name).toBeUndefined();
  }
  expect(manifest.peerDependenciesMeta.argon2).toEqual({ optional: true });
  // The screens render through the injected kit (react/kit), so ui and admin are test-only host bindings: no peer, no optional-peer hint.
  for (const name of ['@jini-ai/ui', '@jini-ai/admin']) {
    expect(manifest.peerDependencies[name], name).toBeUndefined();
    expect(manifest.peerDependenciesMeta[name], name).toBeUndefined();
    expect(manifest.jini.optionalPeers[name], name).toBeUndefined();
    expect(manifest.devDependencies[name], name).toBeTruthy();
    expect(manifest.dependencies?.[name], name).toBeUndefined();
  }
  // No source file imports @jini-ai/agentic, so it is not declared in any dependency field.
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
    expect(manifest[field]?.['@jini-ai/agentic'], field).toBeUndefined();
  }
});
