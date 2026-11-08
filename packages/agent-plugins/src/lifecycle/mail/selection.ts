import type { MailProviderSetting } from "@jini-ai/core/contracts/mail";
import type { MailProviderCatalog } from "./catalog.js";
export interface MailSelectionInput { pluginId: string; enabled: boolean; actor: string }
/** @agent-note The host owns settings authorization, revision errors and plugin activation. */
export interface MailSelectionPorts<Input extends MailSelectionInput, Written extends { enabled: boolean }> {
 ready(): Promise<void>; mailerReady: Promise<unknown>; invalidate(): void;
 loadCatalog(): Promise<MailProviderCatalog>;
 readSelection(): Promise<{ setting: MailProviderSetting; revisionSeq: number }>;
 writeSelection(required: { principalId: string; value: MailProviderSetting; expectedRevisionSeq?: number | undefined }): Promise<unknown>;
 installedProviderIds(input: Input): Promise<readonly string[]>;
 toggle(input: Input): Promise<Written>;
 isRevisionConflict(error: unknown): boolean;
}
/** Keep ownership snapshots across failed cleanup, with bounded revision retries. @complexity O(1) setup. */
export function createMailSelection<Input extends MailSelectionInput, Written extends { enabled: boolean }>(required: MailSelectionPorts<Input,Written>, _optional: Record<string,never> = {}) {
  /** Clear only this plugin's selected lanes through the settings owner; failures propagate.
   * Re-read live ownership too: a conflict retry cannot clear a newly enabled plugin's same id.
   * @complexity O(a + p) active adapters and provider ids, two lane checks and at most one settings write. */
  const clearPluginSelectionSnapshot = async ({ providerIds, principalId, pluginId }: { providerIds: ReadonlySet<string>; principalId: string; pluginId: string }): Promise<void> => {
    await required.ready();
    const catalog = await required.loadCatalog();
    const owned = new Set([...providerIds].filter(id => {
      const provider = catalog.registry.get({ id });
      return !provider || provider.pluginId === pluginId;
    }));
    const { setting, revisionSeq } = await required.readSelection();
    const value = {
      transactional: owned.has(setting.transactional ?? "") ? null : setting.transactional,
      bulk: owned.has(setting.bulk ?? "") ? null : setting.bulk,
    };
    if (value.transactional === setting.transactional && value.bulk === setting.bulk) return;
    // A provider chosen after this snapshot belongs to the newer writer, even in the other lane.
    await required.writeSelection({ principalId, value, expectedRevisionSeq: revisionSeq });
  };
  /** Re-read after contention so a newer unrelated lane is never overwritten. Three guarded
   * attempts bound work; failed ownership stays available to a subsequent disable retry.
   * @complexity At most three catalog/snapshot/write attempts; O(a + p) ownership checks each. */
  const clearPluginSelection = async (input: { providerIds: ReadonlySet<string>; principalId: string; pluginId: string }): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await clearPluginSelectionSnapshot(input); return; }
      catch (error) { if (!(required.isRevisionConflict(error)) || attempt === 2) throw error; }
    }
  };
  // Only failed cleanup retains ownership: executable contributions disappear after OFF.
  const pendingPluginSelections = new Map<string, ReadonlySet<string>>();
  /** Retain active ownership across an interrupted cleanup; after a restart, read only the
   * trusted inactive declaration when a selected provider no longer exists in the live catalog.
   * @complexity O(a) active adapters plus the conditional installed-declaration lookup. */
  const disabledProviderIds = async (input: Input): Promise<ReadonlySet<string>> => {
    const catalog = await required.loadCatalog();
    const providers = catalog.registry.list();
    const pending = [...pendingPluginSelections.get(input.pluginId) ?? []].filter(id => {
      const owner = catalog.registry.get({ id });
      return !owner || owner.pluginId === input.pluginId;
    });
    const ids = new Set([...pending, ...providers.filter(provider => provider.pluginId === input.pluginId).map(provider => provider.id)]);
    if (ids.size) return ids;
    await required.ready();
    const { setting } = await required.readSelection();
    const missing = Object.values(setting).some(id => id !== null && !catalog.registry.get({ id }));
    return missing ? new Set((await required.installedProviderIds(input)).filter(id => !catalog.registry.get({ id }))) : ids;
  };
  /** Bind the plugin toggle to this site's mail settings, using plugin ownership rather than ids.
   * @complexity O(a) loaded adapters; one lifecycle write and at most three guarded settings writes. */
  const setPluginEnabled = async (input: Input, _optional: object = {}) => {
    // MOVE: Capture ownership while the plugin is active; disabling removes its executable adapters.
    const providerIds = input.enabled ? new Set<string>() : await disabledProviderIds(input);
    const written = await required.toggle(input);
    try {
      if (!written.enabled && providerIds.size > 0) {
        pendingPluginSelections.set(input.pluginId, providerIds);
        await clearPluginSelection({ providerIds, principalId: input.actor, pluginId: input.pluginId });
      }
      pendingPluginSelections.delete(input.pluginId);
    } finally { required.invalidate(); }
    return written;
  };
  const selectProvider = async ({ id, principalId, expectedRevisionSeq }: { id: string; principalId: string; expectedRevisionSeq?: number }) => {
    await required.ready();
    // Finish the first-boot unconfigured write before persisting the owner's selection.
    await required.mailerReady;
    await required.writeSelection({ principalId, value: { transactional: id, bulk: id }, expectedRevisionSeq });
    // Only after the write succeeded: a switch must reach the very next send and status read.
    required.invalidate();
  };

return { setAgentPluginEnabled: setPluginEnabled, selectProvider };
}
