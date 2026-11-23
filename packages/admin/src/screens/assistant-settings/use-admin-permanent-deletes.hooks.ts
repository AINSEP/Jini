import { useAssistantOwnerGrant, type OwnerGrantDependencies, type SiteGrantPort } from "./use-assistant-owner-grant.hooks.js";

/** One deletable operation the host offers; `adminPath` is its canonical admin screen, if any. */
export interface PermanentDeleteTool { id: string; label: string; group: string; adminPath?: string | null | undefined }
export interface PermanentDeletesSettings { enabled: boolean; canEdit: boolean; allowedToolIds: string[] }
/** The host's product policy for the grant: which tools exist, how they group, and the consent copy. */
export interface PermanentDeletesPolicy {
  namespace: string; key: readonly string[]; tools: readonly PermanentDeleteTool[]; groupLabels: readonly string[];
  title: string; dangers: readonly string[]; confirmLabel: string; failure: string;
}
export type PermanentDeletesController = ReturnType<typeof useAdminPermanentDeletes>;
/** The host's wired controller hook, as `AdminPermanentDeletes` calls it. */
export type UseAdminPermanentDeletesHook = (required: { t: (key: string) => string }, optional?: Record<string, never>) => PermanentDeletesController;

/** Checkbox changes autosave one complete selection through the same owner-grant ceremony.
 * Turning off preserves the selection; no checked tool grants anything while off.
 * @param required - Site API port, the host's policy and owner-grant bindings, and optional translation port.
 * @returns The master/checklist controller; failed writes keep server truth and expose API errors.
 * @example useAdminPermanentDeletes({ port, ...policy, ...ownerGrantDependencies });
 * @complexity O(n) time/space per selection over the host's tool list, one audited request. */
export function useAdminPermanentDeletes(required: OwnerGrantDependencies & PermanentDeletesPolicy & {
  port: SiteGrantPort<PermanentDeletesSettings>; t?: (key: string) => string;
}, _optional = {}) {
  const state = useAssistantOwnerGrant({ ...required, failure: required.t?.(required.failure) ?? required.failure });
  const selected = state.settings?.allowedToolIds ?? [];
  const saveSelection = async ({ allowedToolIds }: { allowedToolIds: string[] }, _options: Record<string, never> = {}) => {
    if (!state.settings?.enabled) return;
    await state.save({ settings: { enabled: true, allowedToolIds } });
  };
  return { ...state, dangers: required.dangers,
    groups: required.groupLabels.map(label => ({ label, tools: required.tools.filter(tool => tool.group === label) })),
    setEnabled: async ({ enabled }: { enabled: boolean }, _options = {}) => {
      if (enabled === state.settings?.enabled) return;
      await state.save({ settings: { enabled, allowedToolIds: [...selected] } });
    },
    setTool: ({ toolId, checked }: { toolId: string; checked: boolean }, _options = {}) => saveSelection({ allowedToolIds: checked ? [...new Set([...selected, toolId])] : selected.filter(id => id !== toolId) }),
    selectAll: (_input: Record<string, never>, _options = {}) => saveSelection({ allowedToolIds: required.tools.map(tool => tool.id) }),
    selectNone: (_input: Record<string, never>, _options = {}) => saveSelection({ allowedToolIds: [] }),
  };
}
