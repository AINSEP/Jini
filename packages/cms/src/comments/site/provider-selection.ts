/** Site-scoped provider choice on the existing settings ledger; no comment data is moved. */
import type { CommentsSelectionStorePort, CommentsProviderRegistry } from '@jini-ai/core/contracts/site/comments-providers';
import { ToolInputError } from '@jini-ai/core';
import { observed } from "@jini-ai/core/errors/idioms";
import { ensureSettingDefinitions, set, type SettingsRepoPort } from '@jini-ai/core/settings';
import type { SetCommentsSettingsDeps, EnsureCommentsSettingDefinitionsDeps } from './settings.js';
import type { CommentRepoPort, CommentIngressPolicy } from '../ports.js';
import type { CommentWriteService } from '../write-service.js';
import { BUILTIN_COMMENTS_DEFINITION, createBuiltinCommentsProvider } from './builtin-provider.js';
import { getCommentsSettings } from './settings.js';

export const BUILTIN_COMMENTS_PROVIDER_ID = 'built-in';
const NAMESPACE = 'core.comments';
/** Boot is chained to the existing settings registration to preserve its single-transaction ordering. */
export async function ensureCommentsProviderDefinition({ deps, systemPrincipalId }: { deps: EnsureCommentsSettingDefinitionsDeps; systemPrincipalId: string }, _options = {}) {
  const clock = deps.clock;
  await ensureSettingDefinitions({ ...deps, clock: 'nowMs' in clock ? clock : { nowMs: () => Date.parse(clock.nowIso()) },
    principals: deps.createPrincipalLookup({ repo: deps.principals }) }, {
    namespace: NAMESPACE, systemPrincipalId,
    definitions: [{ key: 'provider', schema: { type: 'string' }, defaultValue: BUILTIN_COMMENTS_PROVIDER_ID }],
  });
}

/** Reads the actual workspace value and revision, bypassing effective-value caches for CAS.
 * Unset choices always fall back to built-in, including sites with historical rows. */
async function readSelection({ repo, siteId }: { repo: SettingsRepoPort; siteId: string }, _options = {}) {
  const definition = await repo.findActiveDefinition({ namespace: NAMESPACE, key: 'provider', workspaceId: null });
  const value = definition ? await repo.getWorkspaceValue({ workspaceId: siteId, settingId: definition.settingId }) : null;
  const providerId = value?.state === 'set' && typeof value.valueJson === 'string' ? value.valueJson : BUILTIN_COMMENTS_PROVIDER_ID;
  return { providerId: providerId === '' ? null : providerId, revision: value?.seq ?? 0 };
}

/** A revision CAS through the authorized settings chokepoint. The check guards `saveWorkspaceValue`, which
 * set() calls AFTER appendRevision has taken the ledger write lock (an advisory transaction lock on
 * Postgres, BEGIN IMMEDIATE on SQLite), so no other writer can commit between the comparison and the save;
 * a refusal rolls the appended revision back too (same pattern as `settings/form-delivery-write.ts`).
 * Checking when the transaction OPENED was not enough on Postgres: two confirmations both read revision N
 * under READ COMMITTED, then queued on the lock and both committed. Other methods keep their receiver.
 * @complexity O(1) ledger reads/writes; storage failures propagate and roll back. */
export function createCommentsSelectionStore(deps: SetCommentsSettingsDeps, _options = {}): CommentsSelectionStorePort {
  const clock = deps.clock;
  return {
    read: ({ siteId }, _optional = {}) => readSelection({ repo: deps.settingsRepo, siteId }),
    async compareAndSet(input, _optional = {}) {
      const repo = new Proxy(deps.settingsRepo, { get(target, key) {
        if (key === 'saveWorkspaceValue') return async (record: Parameters<SettingsRepoPort['saveWorkspaceValue']>[0]) => {
          const current = await readSelection({ repo: target, siteId: input.siteId });
          if (current.revision !== input.expectedRevision) throw new ToolInputError({ message: 'Comments provider changed; read it again.' });
          await target.saveWorkspaceValue(record);
        };
        const member = Reflect.get(target, key, target);
        return typeof member === 'function' ? member.bind(target) : member;
      } });
      await set({ deps: { repo, clock: 'nowMs' in clock ? clock : { nowMs: () => Date.parse(clock.nowIso()) }, ids: deps.ids,
        authorize: deps.authorize, principals: deps.createPrincipalLookup({ repo: deps.principals }) },
      input: { namespace: NAMESPACE, key: 'provider', scope: 'workspace', workspaceId: input.siteId,
        callerPrincipalId: input.actorPrincipalId, requiredPermissionOverride: 'comments.configure', value: input.providerId ?? '' } });
      return true;
    },
  };
}

/** Composes the built-in capability without touching plugin lifecycle or the existing data module. */
export function createCommentsCapability(required: {
  siteId: string; module: { commentRepo: CommentRepoPort; ingressPolicy: CommentIngressPolicy; writeService: CommentWriteService };
  commentsReady: Promise<void>; settingsReady: Promise<void>; settings: SetCommentsSettingsDeps;
  /** The runtime registry factory (`createCommentsProviderRegistry` from `@jini-ai/capability-providers/comments`),
   * injected so this package takes no dependency on the provider runtime. */
  createProviderRegistry: (required: { selections: CommentsSelectionStorePort }) => CommentsProviderRegistry;
}, _options = {}) {
  const store = createCommentsSelectionStore(required.settings);
  // Boot guard: a stored choice naming a provider that is not registered in this process (a vendor
  // plugin turned off or removed later) must not hide this site's stored comments or strand its queue,
  // so it reads as built-in. Nothing is rewritten: the CAS revision is the stored row's, and selecting
  // again records an explicit choice. An explicit disable (null) stays disabled.
  const selections: CommentsSelectionStorePort = { ...store, async read(input, _optional = {}) {
    const current = await store.read(input);
    return current.providerId !== null && !providers.has({ providerId: current.providerId })
      ? { ...current, providerId: BUILTIN_COMMENTS_PROVIDER_ID } : current;
  } };
  const providers = required.createProviderRegistry({ selections });
  const ready = Promise.all([required.commentsReady, required.settingsReady]).then(() => undefined);
  // Observed at once: nothing awaits it until the first comments request, and a boot rejection left
  // unobserved until then is an unhandled rejection. Only marks it handled; `resolve` still throws it.
  observed({ promise: ready });
  const builtin = createBuiltinCommentsProvider({ siteId: required.siteId, repo: required.module.commentRepo, ingress: required.module.ingressPolicy,
    writes: required.module.writeService, ready, getSettings: ({ siteId }) => getCommentsSettings({ settingsRepo: required.settings.settingsRepo }, { workspaceId: siteId }) });
  providers.register({ definition: BUILTIN_COMMENTS_DEFINITION, resolve: async ({ siteId }, _optional = {}) => {
    if (siteId !== required.siteId) return undefined;
    await ready;
    return builtin;
  } });
  const moderation = async (input: { workspaceId: string }, _options = {}) => {
    if (input.workspaceId !== required.siteId) throw new ToolInputError({ message: 'Comments site mismatch' });
    const active = await providers.active({ siteId: input.workspaceId });
    if (active.adapter?.kind !== 'stored') throw new ToolInputError({ message: 'No stored comments provider is active. Select built-in first.' });
    return active.adapter.moderation;
  };
  const writeService: CommentWriteService = {
    async applyModeration(input) {
      const port = await moderation(input);
      if (!['approve', 'mark_spam', 'trash', 'restore'].includes(input.action)) throw new ToolInputError({ message: 'Unsupported comments moderation action' });
      return port.apply({ ...input, siteId: input.workspaceId, action: input.action as 'approve' | 'mark_spam' | 'trash' | 'restore' });
    },
    // Purge only removes data and never publishes anything, so an owner can still erase a comment while
    // public comments are off or the provider is not built-in (the Trash screen's purge already can).
    async purge(input) {
      if (input.workspaceId !== required.siteId) throw new ToolInputError({ message: 'Comments site mismatch' });
      return builtin.moderation.purge({ ...input, siteId: input.workspaceId });
    },
  };
  return { providers, writeService };
}
