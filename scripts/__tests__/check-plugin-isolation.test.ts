import { describe, expect, it } from 'vitest';
import { assertPluginBundleIsolation, assertPluginPackageIsolation, type PluginIsolationManifest } from '../check-plugin-isolation.js';

const name = '@jini-ai/plugin-analytics-posthog';
const pluginIds = ['analytics-posthog', 'observability-sentry', 'payments-stripe', 'ui-ux-design'];
const docs = ['package/package.json', 'package/README.md', 'package/LICENSE', 'package/NOTICE'];
const ownPayload = 'package/plugins/analytics-posthog/0.7.0/server/index.mjs';
const check = (manifest: PluginIsolationManifest, packedPaths = [...docs, ownPayload]) =>
  assertPluginPackageIsolation({ manifest, packedPaths, pluginIds });

describe('plugin package installation isolation', () => {
  it.each(['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'])(
    'rejects a sibling in %s, even when optional peer metadata marks it optional', field => {
      const manifest = { name, [field]: { '@jini-ai/plugin-payments-stripe': '^0.7.0' },
        peerDependenciesMeta: { '@jini-ai/plugin-payments-stripe': { optional: true } } };
      expect(() => check(manifest)).toThrow(
        `${name}: forbidden plugin dependency @jini-ai/plugin-payments-stripe: ^0.7.0`);
    });

  it.each(['bundledDependencies', 'bundleDependencies'])('rejects undeclared bundled siblings in %s', field => {
    expect(() => check({ name, [field]: ['@jini-ai/plugin-observability-sentry'] })).toThrow('forbidden plugin dependency');
  });

  it.each(['npm:@jini-ai/plugin-payments-stripe@^0.7.0', 'workspace:@jini-ai/plugin-payments-stripe@*'])(
    'rejects an alias hiding a sibling: %s', specifier => {
      expect(() => check({ name, dependencies: { innocent: specifier } })).toThrow(`forbidden plugin dependency innocent: ${specifier}`);
    });

  it.each(['file:../innocent', 'link:../innocent', 'portal:../innocent', 'workspace:../innocent'])(
    'resolves local dependency identity rather than trusting its directory: %s', specifier => {
      expect(() => assertPluginPackageIsolation({ manifest: { name, devDependencies: { innocent: specifier } },
        packedPaths: [ownPayload], pluginIds }, {
        resolveLocalDependency: input => {
          expect(input).toEqual({ name: 'innocent', specifier });
          return '@jini-ai/plugin-payments-stripe';
        },
      })).toThrow('forbidden local plugin dependency innocent: @jini-ai/plugin-payments-stripe');
    });

  it('fails closed when local dependency identity cannot be resolved', () => {
    expect(() => check({ name, dependencies: { innocent: 'file:../innocent' } })).toThrow('unresolved local dependency innocent');
  });

  it('accepts contract dependencies and retained own licenses/browser assets', () => {
    expect(() => check({ name, devDependencies: { '@jini-ai/analytics': 'workspace:^' }, bundledDependencies: true }, [
      ...docs, ownPayload, 'package/plugins/analytics-posthog/0.7.0/server/posthog.js',
      'package/plugins/analytics-posthog/0.7.0/licenses/posthog-node/LICENSE',
    ])).not.toThrow();
  });

  it('accepts a locally resolved neutral contract', () => {
    expect(() => assertPluginPackageIsolation({ manifest: { name, devDependencies: { contract: 'file:../contract' } },
      packedPaths: [ownPayload], pluginIds }, { resolveLocalDependency: () => '@jini-ai/analytics' })).not.toThrow();
  });

  it.each(['@jini-ai/plugin-catalog', '@jini-ai/provider-plugins'])(
    'rejects a plugin dependency on the distribution/catalog workspace %s', dependency => {
      expect(() => check({ name, dependencies: { [dependency]: '^0.7.0' } })).toThrow('forbidden plugin dependency');
    });

  it.each(['plugins/payments-stripe/0.7.0/server/index.mjs', 'ui-ux-design/skills/design/SKILL.md',
    'plugins/analytics-posthog/0.7.0/server/plugins/payments-stripe/0.7.0/server/index.mjs',
    'plugins/analytics-posthog/0.7.0/server/plugins/future-plugin/1.0.0/server/index.mjs'])(
    'rejects sibling payloads despite the manifest allowlist: %s', path => {
      const manifest = { name, files: ['plugins/analytics-posthog'] };
      expect(() => check(manifest, [...docs, ownPayload, `package/${path}`]))
        .toThrow(`another plugin's payload in ${path}`);
    });

  it('rejects an unknown sibling ID, sources, maps and nested dependencies outside the chosen payload', () => {
    for (const path of ['plugins/future-plugin/1.0.0/server/index.mjs', 'src/index.ts', 'index.mjs.map', 'node_modules/vendor/index.js']) {
      expect(() => check({ name }, [ownPayload, path])).toThrow(`unexpected packed file ${path}`);
    }
  });

  it.each(['ui-ux-design/skills/design/SKILL.md', 'plugins/payments-stripe/0.7.0/server/index.mjs',
    'dist/vendor/future-plugin/jini.plugin.json', 'dist/content/future-agent/plugin.json',
    'plugins/future-plugin/1.0.0/server/index.mjs'])(
    'rejects plugin payloads published by a core package: %s', path => {
      expect(() => check({ name: '@jini-ai/agent-plugins' }, [...docs, `package/${path}`])).toThrow(path);
    });

  it('accepts core lifecycle implementation files without plugin assets', () => {
    expect(() => check({ name: '@jini-ai/agent-plugins' }, [...docs, 'package/dist/lifecycle/install.js'])).not.toThrow();
    expect(() => check({ name: '@jini-ai/plugin-ui-ux-design' }, [...docs, 'package/ui-ux-design/plugin.json'])).not.toThrow();
  });

  it('rejects provider assets bundled with the agent plugin', () => {
    expect(() => check({ name: '@jini-ai/plugin-ui-ux-design' }, [...docs, ownPayload])).toThrow("another plugin's payload");
  });

  it('keeps the catalog metadata-only and forbids even aliased plugin dependencies', () => {
    const catalog = { name: '@jini-ai/plugin-catalog' };
    expect(() => check(catalog, [...docs, 'package/catalog.json'])).not.toThrow();
    expect(() => check(catalog, [...docs, 'package/dist/index.js'])).toThrow('catalog must be metadata-only');
    expect(() => check({ ...catalog, optionalDependencies: { hidden: 'npm:@jini-ai/plugin-payments-stripe@0.7.0' } }, docs))
      .toThrow('forbidden plugin dependency hidden');
  });

  it('normalizes archive prefixes/separators and rejects traversal', () => {
    expect(() => check({ name }, ['./package/plugins/analytics-posthog/0.7.0/server/index.mjs', 'package/'])).not.toThrow();
    expect(() => check({ name }, ['package\\ui-ux-design\\plugin.json'])).toThrow("another plugin's payload");
    expect(() => check({ name }, ['package/plugins/analytics-posthog/../payments-stripe/index.mjs'])).toThrow('Invalid packed path');
  });
});

describe('plugin bundle input isolation', () => {
  const bundle = (inputs: readonly string[]) => assertPluginBundleIsolation({
    pluginId: 'analytics-posthog', packageRoot: '/repo/packages/provider-plugins', inputs,
  });
  it('accepts the selected source, reviewed neutral helpers, and dependencies', () => {
    expect(() => bundle(['src/analytics-posthog/index.ts', 'src/attribution.ts', 'src/telemetry-reporter.ts',
      'src/trim-trailing-slashes.ts', 'node_modules/posthog-node/index.js', '../analytics/src/index.ts'])).not.toThrow();
  });
  it.each(['src/payments-stripe/index.ts', '/repo/packages/provider-plugins/src/payments-stripe/webhook.ts',
    'src/analytics-posthog/../payments-stripe/index.ts', 'src\\payments-stripe\\index.ts', 'src/future-shared.ts',
    'node_modules/@jini-ai/plugin-payments-stripe/plugins/payments-stripe/0.7.0/server/index.mjs',
    '../plugin-payments-stripe/plugins/payments-stripe/0.7.0/server/index.mjs',
    '../agent-plugins/ui-ux-design/plugin.json'])(
    'rejects a transitive sibling or unreviewed source: %s', input => {
      expect(() => bundle(['src/analytics-posthog/index.ts', input])).toThrow(`forbidden bundled source ${input}`);
    });
});
