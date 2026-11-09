/** EXTRACT-S6 L1b part 2: the per-load invocation binding wired by a second host with its OWN
 * beforeSave hook id (not the first host's), through the public `./host/node` entry only. Proves
 * the entry object reaches the plugin untouched (every host payload field), extend writes merge
 * under returned keys, reads/writes are invocation-only, one declared filter, and one storage per
 * load (two concurrent invocations never see each other's entry). */
import { describe, expect, it } from 'vitest';
import { createPluginInvocationBinding } from '../../node/index.js';
import type { ContentEntryDraft, HookContext } from '../../index.js';

const HOOK = 'record.preCommit';
const ctx: HookContext = { pluginId: 'acme', workspaceId: 'w-2' };
const entryWith = (extra: Record<string, unknown>) =>
  ({ workspaceId: 'w-2', ext: {}, ...extra }) as unknown as Readonly<ContentEntryDraft>;

describe('createPluginInvocationBinding (second host)', () => {
  it('accepts only the host-supplied hook id, once, when declared', () => {
    const binding = createPluginInvocationBinding({ pluginId: 'acme', declaredHooks: [HOOK], beforeSaveHook: HOOK }, {});
    expect(binding.capturedFilter()).toBeNull();
    expect(() => binding.coreDeps.attachFilter('content.entry.beforeSave', () => ({}))).toThrow(
      "plugin 'acme' attempted to attach undeclared hook 'content.entry.beforeSave'",
    );
    binding.coreDeps.attachFilter(HOOK, () => ({}));
    expect(() => binding.coreDeps.attachFilter(HOOK, () => ({}))).toThrow(
      "plugin 'acme' attempted to attach more than one beforeSave filter",
    );
    const undeclared = createPluginInvocationBinding({ pluginId: 'acme', declaredHooks: [], beforeSaveHook: HOOK }, {});
    expect(() => undeclared.coreDeps.attachFilter(HOOK, () => ({}))).toThrow("attempted to attach undeclared hook 'record.preCommit'");
  });

  it('passes the host entry through untouched and merges extend writes under returned keys', async () => {
    const binding = createPluginInvocationBinding({ pluginId: 'acme', declaredHooks: [HOOK], beforeSaveHook: HOOK }, {});
    const seen: unknown[] = [];
    binding.coreDeps.attachFilter(HOOK, () => {
      seen.push(binding.coreDeps.getCurrentEntry());
      binding.coreDeps.writeExtField('score', 1);
      binding.coreDeps.writeExtField('label', 'x');
      return { score: 2 };
    });
    const entry = entryWith({ sku: 'A-1', rows: [1, 2], title: 'T' });
    const patch = await binding.capturedFilter()!(entry, ctx);
    expect(seen[0]).toBe(entry);
    expect(seen[0]).toEqual({ workspaceId: 'w-2', ext: {}, sku: 'A-1', rows: [1, 2], title: 'T' });
    expect(patch).toEqual({ score: 2, label: 'x' });
    expect(() => binding.coreDeps.getCurrentEntry()).toThrow("plugin 'acme' called content.read outside a beforeSave hook");
    expect(() => binding.coreDeps.writeExtField('a', 1)).toThrow("plugin 'acme' called content.extend outside a beforeSave hook");
  });

  it('isolates concurrent invocations and separate loads', async () => {
    const binding = createPluginInvocationBinding({ pluginId: 'acme', declaredHooks: [HOOK], beforeSaveHook: HOOK }, {});
    binding.coreDeps.attachFilter(HOOK, async () => {
      const before = binding.coreDeps.getCurrentEntry() as unknown as { sku: string };
      await new Promise((resolve) => setTimeout(resolve, 5));
      binding.coreDeps.writeExtField('sku', before.sku);
      return {};
    });
    const run = binding.capturedFilter()!;
    const [a, b] = await Promise.all([run(entryWith({ sku: 'a' }), ctx), run(entryWith({ sku: 'b' }), ctx)]);
    expect([a, b]).toEqual([{ sku: 'a' }, { sku: 'b' }]);
    const other = createPluginInvocationBinding({ pluginId: 'other', declaredHooks: [HOOK], beforeSaveHook: HOOK }, {});
    expect(other.capturedFilter()).toBeNull();
  });

  it('passes a non-object return through even after extend', async () => {
    const binding = createPluginInvocationBinding({ pluginId: 'acme', declaredHooks: [HOOK], beforeSaveHook: HOOK }, {});
    binding.coreDeps.attachFilter(HOOK, (() => {
      binding.coreDeps.writeExtField('a', 1);
      return null;
    }) as never);
    expect(await binding.capturedFilter()!(entryWith({}), ctx)).toBeNull();
  });
});
