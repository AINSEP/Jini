import { describe, expect, it } from 'vitest';
import { PluginInvalidError } from '../../activation.js';
import { deferDeclaredContentTypePorts, enableDeclaredPlugin } from '../../declarative-enable.js';
import type { PluginManifest, PluginTier } from '../../manifest.js';
import type { DeclarativeContentTypesPort, DeclaredContentType, DeclaredContentTypePorts } from '../../ports.js';

const article: DeclaredContentType = { key: 'article', label: 'Article', fields: [] };

function manifest(tier: PluginTier, contentTypes: readonly unknown[] | null): PluginManifest {
  return { id: 'example', name: 'Example', version: '1.0.0', sdkRange: '^1', engine: 1, tier,
    capabilities: [], hooks: [], fields: [], integrity: {}, contentTypes };
}

/** A declaration port that records the order of everything the enable path asks of it. */
function harness({ decls = [article], conflicts = [], applyError }: {
  decls?: readonly DeclaredContentType[]; conflicts?: readonly string[]; applyError?: Error;
} = {}) {
  const log: string[] = [];
  const declarativeContentTypes: DeclarativeContentTypesPort = {
    validateManifest: () => ({ errors: [] }),
    parse: ({ value }) => { log.push(`parse:${JSON.stringify(value)}`); return { decls, errors: [] }; },
    plan: async ({ workspaceId, decls: planned }) => { log.push(`plan:${workspaceId}:${planned.length}`); return { conflicts, items: planned }; },
    apply: async ({ pluginId }) => { log.push(`apply:${pluginId}`); if (applyError) throw applyError; },
  };
  const ports: DeclaredContentTypePorts = { findByKey: async () => null, register: async () => ({ ok: true }) };
  const required = (tier: PluginTier) => ({
    declarativeContentTypes, pluginId: 'example', workspaceId: 'ws-1', manifest: manifest(tier, decls.length ? [{ key: 'article' }] : null),
    loadCode: async () => { log.push('load'); }, unloadCode: () => { log.push('unload'); },
  });
  return { log, ports, required };
}

describe('enableDeclaredPlugin', () => {
  it('a code plugin with no declarations is only loaded', async () => {
    const { log, required } = harness({ decls: [] });
    await enableDeclaredPlugin(required('tier-2'));
    expect(log).toEqual(['parse:null', 'load']);
  });

  it('a tier-1 plugin with no declarations does nothing at all', async () => {
    const { log, required } = harness({ decls: [] });
    await enableDeclaredPlugin(required('tier-1'));
    expect(log).toEqual(['parse:null']);
  });

  it('refuses a plugin that declares types when the site has no content-type store, before loading code', async () => {
    const { log, required } = harness();
    await expect(enableDeclaredPlugin(required('tier-2'))).rejects.toThrow(
      new PluginInvalidError("plugin 'example' declares content types, but this site cannot create them"));
    expect(log).toEqual(['parse:[{"key":"article"}]']);
  });

  it('plans, then loads code, then creates the types', async () => {
    const { log, ports, required } = harness();
    await enableDeclaredPlugin(required('tier-2'), { contentTypes: ports });
    expect(log).toEqual(['parse:[{"key":"article"}]', 'plan:ws-1:1', 'load', 'apply:example']);
  });

  it('a tier-1 plugin gets its declared types without any code being loaded', async () => {
    const { log, ports, required } = harness();
    await enableDeclaredPlugin(required('tier-1'), { contentTypes: ports });
    expect(log).toEqual(['parse:[{"key":"article"}]', 'plan:ws-1:1', 'apply:example']);
  });

  it('a conflict refuses the enable before the plugin code is imported', async () => {
    const { log, ports, required } = harness({ conflicts: ['article is owned by another plugin', 'page is a core type'] });
    const failure = await enableDeclaredPlugin(required('tier-2'), { contentTypes: ports }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PluginInvalidError);
    expect((failure as Error).message).toBe("plugin 'example' cannot be turned on: article is owned by another plugin; page is a core type");
    expect(log).not.toContain('load');
  });

  it('a type that fails to create unloads the code again and rethrows the original failure', async () => {
    const applyError = new Error('outbox unavailable');
    const { log, ports, required } = harness({ applyError });
    await expect(enableDeclaredPlugin(required('tier-2'), { contentTypes: ports })).rejects.toBe(applyError);
    expect(log).toEqual(['parse:[{"key":"article"}]', 'plan:ws-1:1', 'load', 'apply:example', 'unload']);
  });
});

describe('deferDeclaredContentTypePorts', () => {
  it('builds the real ports once, on first use, and forwards both operations to them', async () => {
    let builds = 0;
    const calls: unknown[] = [];
    const deferred = deferDeclaredContentTypePorts({ build: () => {
      builds += 1;
      return {
        findByKey: async (params) => { calls.push(['find', params]); return { key: params.key }; },
        register: async (input) => { calls.push(['register', input]); return { ok: true }; },
      };
    } });
    expect(builds).toBe(0);
    expect(await deferred.findByKey({ workspaceId: 'ws-1', key: 'article' })).toEqual({ key: 'article' });
    const input = { workspaceId: 'ws-1', key: 'article', label: 'Article', fields: [], actorId: 'plugin:example' };
    expect(await deferred.register(input)).toEqual({ ok: true });
    expect(builds).toBe(1);
    expect(calls).toEqual([['find', { workspaceId: 'ws-1', key: 'article' }], ['register', input]]);
  });
});
