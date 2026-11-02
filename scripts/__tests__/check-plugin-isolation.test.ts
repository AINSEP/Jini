import { describe, expect, it } from 'vitest';
import {
  assertAgentPluginSubpathExports, assertPluginBundleIsolation, assertPluginPackageIsolation, type PluginIsolationManifest,
} from '../check-plugin-isolation.js';

const name = '@jini-ai/plugin-analytics-posthog';
const pluginIds = ['analytics-posthog', 'observability-sentry', 'payments-stripe', 'slide-design', 'ui-ux-design'];
const docs = ['package/package.json', 'package/README.md', 'package/LICENSE', 'package/NOTICE'];
const ownPayload = 'package/plugins/analytics-posthog/0.6.17/server/index.mjs';
const check = (manifest: PluginIsolationManifest, packedPaths = [...docs, ownPayload]) =>
  assertPluginPackageIsolation({ manifest, packedPaths, pluginIds });

describe('plugin package installation isolation', () => {
  it.each(['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'])(
    'rejects a sibling in %s, even when optional peer metadata marks it optional', field => {
      const manifest = { name, [field]: { '@jini-ai/plugin-payments-stripe': '^0.6.17' },
        peerDependenciesMeta: { '@jini-ai/plugin-payments-stripe': { optional: true } } };
      expect(() => check(manifest)).toThrow(
        `${name}: forbidden plugin dependency @jini-ai/plugin-payments-stripe: ^0.6.17`);
    });

  it.each(['bundledDependencies', 'bundleDependencies'])('rejects undeclared bundled siblings in %s', field => {
    expect(() => check({ name, [field]: ['@jini-ai/plugin-observability-sentry'] })).toThrow('forbidden plugin dependency');
  });

  it.each(['npm:@jini-ai/plugin-payments-stripe@^0.6.17', 'workspace:@jini-ai/plugin-payments-stripe@*'])(
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
      ...docs, ownPayload, 'package/plugins/analytics-posthog/0.6.17/server/posthog.js',
      'package/plugins/analytics-posthog/0.6.17/licenses/posthog-node/LICENSE',
    ])).not.toThrow();
  });

  it('accepts a locally resolved neutral contract', () => {
    expect(() => assertPluginPackageIsolation({ manifest: { name, devDependencies: { contract: 'file:../contract' } },
      packedPaths: [ownPayload], pluginIds }, { resolveLocalDependency: () => '@jini-ai/analytics' })).not.toThrow();
  });

  it.each(['@jini-ai/plugin-catalog', '@jini-ai/provider-plugins'])(
    'rejects a plugin dependency on the distribution/catalog workspace %s', dependency => {
      expect(() => check({ name, dependencies: { [dependency]: '^0.6.17' } })).toThrow('forbidden plugin dependency');
    });

  it.each(['plugins/payments-stripe/0.6.17/server/index.mjs', 'ui-ux-design/skills/design/SKILL.md',
    'plugins/analytics-posthog/0.6.17/server/plugins/payments-stripe/0.6.17/server/index.mjs',
    'plugins/analytics-posthog/0.6.17/server/plugins/future-plugin/1.0.0/server/index.mjs'])(
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

  it.each(['ui-ux-design/skills/design/SKILL.md', 'plugins/payments-stripe/0.6.17/server/index.mjs',
    'dist/vendor/future-plugin/jini.plugin.json', 'dist/content/future-agent/plugin.json',
    'plugins/future-plugin/1.0.0/server/index.mjs'])(
    'rejects plugin payloads published by a core package: %s', path => {
      expect(() => check({ name: '@jini-ai/core' }, [...docs, `package/${path}`])).toThrow(path);
    });

  it('the legacy ui-ux-design package ships only its own payload; a subpath-only plugin has no package', () => {
    expect(() => check({ name: '@jini-ai/plugin-ui-ux-design' }, [...docs, 'package/ui-ux-design/plugin.json'])).not.toThrow();
    expect(() => check({ name: '@jini-ai/plugin-ui-ux-design' }, [...docs, 'package/slide-design/plugin.json'])).toThrow("another plugin's payload");
    expect(() => check({ name: '@jini-ai/plugin-slide-design' }, [...docs, 'package/slide-design/skills/slide-design/SKILL.md']))
      .toThrow("another plugin's payload");
  });

  it('rejects provider assets bundled with the agent plugin', () => {
    expect(() => check({ name: '@jini-ai/plugin-ui-ux-design' }, [...docs, ownPayload])).toThrow("another plugin's payload");
  });

  describe('agent plugins ship as subpaths of @jini-ai/agent-plugins', () => {
    const rows = [
      { name: 'posthog', sourceDir: 'packages/agent-plugins/posthog' },
      { name: 'vercel', sourceDir: 'packages/agent-plugins/vercel' },
      { name: 'netlify', sourceDir: 'packages/agent-plugins/netlify' },
    ];
    const exports = {
      '.': './dist/index.js', './lifecycle': './dist/lifecycle/index.js',
      './posthog': './posthog/plugin.json', './posthog/*': './posthog/*',
      './vercel': './vercel/plugin.json', './vercel/*': './vercel/*',
      './netlify': './netlify/plugin.json', './netlify/*': './netlify/*',
    };
    const library = ['dist/index.js', 'dist/lifecycle/install.js', 'core/persistent-state.js', 'persistent-state.js'];
    const subpaths = (paths: readonly string[]) => assertPluginPackageIsolation({
      manifest: { name: '@jini-ai/agent-plugins', exports },
      packedPaths: [...docs, ...[...library, ...paths].map(file => `package/${file}`)], pluginIds,
    }, { agentPluginPackages: rows });
    const subpathExports = (manifestExports: Record<string, unknown>) => assertAgentPluginSubpathExports(
      { manifest: { name: '@jini-ai/agent-plugins', exports: manifestExports } }, { agentPluginPackages: rows });

    it('accepts every row folder next to the library files, including a face named like its provider family', () => {
      expect(() => subpaths(['posthog/plugin.json', 'posthog/skills/posthog/SKILL.md', 'vercel/plugin.json',
        'vercel/targets/vercel.mjs', 'netlify/plugin.json', 'netlify/mcp.json'])).not.toThrow();
    });

    it.each(['vercel/__tests__/vercel.test.mjs', 'vercel/targets/__tests__/fixture.mjs', 'vercel/lib/helper.test.mjs',
      'vercel/node_modules/x/index.js'])('refuses an unpublished file inside a subpath folder: %s', path => {
      expect(() => subpaths(['vercel/plugin.json', path])).toThrow(`unpublished file in ${path}`);
    });

    it.each(['vercel/netlify/plugin.json', 'vercel/plugins/payments-stripe/0.6.17/server/index.mjs', 'posthog/ui-ux-design/SKILL.md'])(
      'refuses a sibling plugin\'s payload nested in a subpath folder: %s', path => {
        expect(() => subpaths([path])).toThrow("another plugin's payload");
      });

    it.each(['dist/content/future-agent/plugin.json', 'extra/plugin.json', 'plugins/payments-stripe/0.6.17/server/index.mjs'])(
      'refuses a plugin payload outside every subpath folder: %s', path => {
        expect(() => subpaths([path])).toThrow(`core package publishes plugin payload ${path}`);
      });

    it('requires both exports of every row', () => {
      expect(() => subpathExports(exports)).not.toThrow();
      const partial: Record<string, unknown> = { ...exports };
      delete partial['./netlify/*'];
      expect(() => subpathExports(partial)).toThrow('export ./netlify/* must be ./netlify/*');
      expect(() => subpathExports({ ...exports, './vercel': './vercel/skills/vercel/SKILL.md' })).toThrow('export ./vercel must be ./vercel/plugin.json');
      expect(() => subpathExports({})).toThrow('export ./posthog must be ./posthog/plugin.json');
    });

    it('refuses an export that reaches into another plugin\'s folder', () => {
      expect(() => subpathExports({ ...exports, './deploy/*': './vercel/*' })).toThrow('export ./deploy/* reaches into vercel/');
      expect(() => subpathExports({ ...exports, './posthog-extra': './netlify/plugin.json' })).toThrow('reaches into netlify/');
    });

    it('a provider package may not carry an agent face', () => {
      expect(() => assertPluginPackageIsolation({ manifest: { name }, packedPaths: [...docs, ownPayload, 'package/posthog/plugin.json'], pluginIds },
        { agentPluginPackages: rows })).toThrow("another plugin's payload in posthog/plugin.json");
    });
  });

  it('keeps the catalog metadata-only and forbids even aliased plugin dependencies', () => {
    const catalog = { name: '@jini-ai/plugin-catalog' };
    expect(() => check(catalog, [...docs, 'package/catalog.json'])).not.toThrow();
    expect(() => check(catalog, [...docs, 'package/dist/index.js'])).toThrow('catalog must be metadata-only');
    expect(() => check({ ...catalog, optionalDependencies: { hidden: 'npm:@jini-ai/plugin-payments-stripe@0.6.17' } }, docs))
      .toThrow('forbidden plugin dependency hidden');
  });

  it('normalizes archive prefixes/separators and rejects traversal', () => {
    expect(() => check({ name }, ['./package/plugins/analytics-posthog/0.6.17/server/index.mjs', 'package/'])).not.toThrow();
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
    'node_modules/@jini-ai/plugin-payments-stripe/plugins/payments-stripe/0.6.17/server/index.mjs',
    '../plugin-payments-stripe/plugins/payments-stripe/0.6.17/server/index.mjs',
    '../agent-plugins/ui-ux-design/plugin.json', '../agent-plugins/slide-design/plugin.json'])(
    'rejects a transitive sibling or unreviewed source: %s', input => {
      expect(() => bundle(['src/analytics-posthog/index.ts', input])).toThrow(`forbidden bundled source ${input}`);
    });
});
