import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { assertJiniPackagePublicationAllowed, discoverJiniPackages, packAndRewrite } from '../lib/pack-jini-packages.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it.each(['ai-trace-langfuse', 'analytics-posthog', 'observability-opentelemetry',
  'observability-sentry', 'payments-stripe', 'ui-ux-design', 'fixture-provider', 'future-plugin'])('refuses the retired %s package before packing', id => {
  const name = `@jini-ai/plugin-${id}`;
  expect(() => assertJiniPackagePublicationAllowed({ name })).toThrow('standalone plugin packages are retired');
  // No valid cwd is supplied: rejection must precede even reading a package or spawning pnpm.
  expect(() => packAndRewrite(name, '/missing-plugin-package', '/missing-output', new Map())).toThrow('standalone plugin packages are retired');
});

it.each(['@jini-ai/agent-plugins', '@jini-ai/provider-plugins', '@jini-ai/plugin-catalog', '@jini-ai/plugins'])('accepts the owning distribution or library %s', name => {
  expect(() => assertJiniPackagePublicationAllowed({ name })).not.toThrow();
});

it('refuses a wrapper hidden behind an innocent workspace folder before either publisher can contact npm', () => {
  const root = mkdtempSync(join(tmpdir(), 'retired-plugin-package-')); roots.push(root);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  const directory = join(root, 'packages', 'innocent'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: '@jini-ai/plugin-future-plugin', version: '1.0.0' }));
  expect(() => discoverJiniPackages(root)).toThrow('standalone plugin packages are retired');
  expect(() => packAndRewrite('@jini-ai/agent-plugins', directory, '/missing-output', new Map())).toThrow('standalone plugin packages are retired');
});
