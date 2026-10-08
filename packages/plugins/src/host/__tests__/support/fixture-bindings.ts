/** Narrow test host: existing Tovu ABI, admission policy and declaration-port answers.
 * This is not a production declaration grammar, executable importer or invocation owner. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { definePlugin, readDefinedPlugin, HOOK_CONTENT_ENTRY_BEFORE_SAVE, type BeforeSaveFilter, type ContentEntryDraft } from './fixture-sdk.js';
import type { CapabilityScopedSdkCoreDeps } from '../../capability-sdk.js';
import type { DeclarativeContentTypesPort, ManifestHostPorts, PluginSdkBinding, PluginTierPolicy, BeforeSaveFilter as HostFilter } from '../../ports.js';

export const pluginSdkBinding: PluginSdkBinding = {
  hookIds: [HOOK_CONTENT_ENTRY_BEFORE_SAVE], beforeSaveHook: HOOK_CONTENT_ENTRY_BEFORE_SAVE,
  hookSemantics: { [HOOK_CONTENT_ENTRY_BEFORE_SAVE]: 'shared' }, runtimeSdkVersion: '0.1.0',
  readDefinedPlugin: ({ moduleValue }) => readDefinedPlugin(moduleValue) as unknown as ReturnType<PluginSdkBinding['readDefinedPlugin']>,
  buildSdk: ({ sdk }) => sdk,
  definePlugin: (definition) => definePlugin(definition as unknown as Parameters<typeof definePlugin>[0]) as unknown as ReturnType<PluginSdkBinding['definePlugin']>,
};
const contentTypes: DeclarativeContentTypesPort = {
  parse: ({ value }) => ({ decls: Array.isArray(value) ? value : [], errors: [] }),
  validateManifest: ({ manifest }) => {
    const errors: Array<{ code: string; file: null; message: string }> = [];
    // Only the reserved-key and tier-1 port answers required by the copied manifest cases.
    if (Array.isArray(manifest.contentTypes) && manifest.contentTypes.some((decl) => decl.key === 'post')) {
      errors.push({ code: 'CONTENT_TYPE_DECL_INVALID', file: null, message: "content type key 'post' is reserved by core" });
    }
    if (manifest.tier === 'tier-1') {
      for (const surface of ['capabilities', 'hooks', 'fields']) {
        if (Array.isArray(manifest[surface]) && (manifest[surface] as unknown[]).length > 0) {
          errors.push({ code: 'TIER1_DECLARES_CODE_SURFACE', file: null, message: `a declarative (tier-1) plugin cannot declare '${surface}' — only code can use them` });
        }
      }
    }
    return { errors };
  },
  plan: async () => { throw new Error('content-type planning is outside this fixture'); },
  apply: async () => { throw new Error('content-type writes are outside this fixture'); },
};
export const manifestHost: ManifestHostPorts = {
  pluginSdkBinding, capabilityVocabulary: ['content.read', 'content.extend', 'hooks.attach'],
  declarativeContentTypes: contentTypes, coreOwnerName: 'Tovu core',
};
export const tierPolicy: PluginTierPolicy = {
  execution: 'in-process',
  allowLoad: ({ manifest }) => manifest.tier === 'tier-3',
  siteErrors: ({ manifestValue }) => (manifestValue as { tier?: unknown } | null)?.tier === 'tier-2' ? [{
    code: 'TIER_NOT_ALLOWED', file: 'tovu.plugin.json',
    message: 'A site-installed plugin cannot declare tier-2: tier-2 is for verified publishers and needs a sandbox that does not exist yet. Declare tier-3 (unverified publisher).',
  }] : [],
  checkInstall: ({ manifest }) => { if (manifest.tier !== 'tier-3') throw new Error('Local plugins must declare tier-3 (unverified publisher).'); },
};
/** Test-only invocation backing for the injected port: isolate the current filter's read/extend handles. */
export function createInvocationCoreDeps({ pluginId, declaredHooks }: { pluginId: string; declaredHooks: readonly string[] }) {
  const invocation = new AsyncLocalStorage<{ entry: Readonly<ContentEntryDraft>; writes: Record<string, string | number | boolean> }>();
  let captured: BeforeSaveFilter | null = null;
  const coreDeps: CapabilityScopedSdkCoreDeps = {
    getCurrentEntry() {
      const state = invocation.getStore();
      if (!state) throw new Error(`plugin '${pluginId}' called content.read outside a beforeSave hook`);
      return state.entry;
    },
    writeExtField(field, value) {
      const state = invocation.getStore();
      if (!state) throw new Error(`plugin '${pluginId}' called content.extend outside a beforeSave hook`);
      state.writes[field] = value;
    },
    attachFilter(hookName, filter) {
      if (hookName !== HOOK_CONTENT_ENTRY_BEFORE_SAVE || !declaredHooks.includes(hookName)) throw new Error(`plugin '${pluginId}' attempted to attach undeclared hook '${String(hookName)}'`);
      if (captured) throw new Error(`plugin '${pluginId}' attempted to attach more than one beforeSave filter`);
      captured = async (entry, ctx) => invocation.run({ entry, writes: {} }, async () => {
        const returned = await filter(entry, ctx);
        const { writes } = invocation.getStore()!;
        if (Object.keys(writes).length === 0 || typeof returned !== 'object' || returned === null || Array.isArray(returned)) return returned;
        return { ...writes, ...returned };
      });
    },
  };
  return { coreDeps, capturedFilter: () => captured as unknown as HostFilter | null };
}
