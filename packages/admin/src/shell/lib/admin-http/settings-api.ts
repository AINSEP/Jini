import type { SettingScope } from "@jini-ai/core/settings";
import { type SettingResolvedValue, shareSettingsEffectiveRead } from "../settings-effective-reads.js";
import type { SettingValueResponse } from "./settings-api.types.js";

const BLANK_NAMESPACE_MESSAGE = "Cannot read settings without a namespace. Pass the settings group to read, for example \"core.language\".";

/** What the host injects into {@link createSettingsApi}. */
export interface SettingsApiDeps {
  /** The host's `authenticatedAdminRequest`: it owns the base URL, authentication, retries and error decoding, so this client only names paths, methods and bodies. */
  authenticatedAdminRequest: <T>(required: { path: string; method: string; body?: unknown }) => Promise<T>;
  /** The workspace the paths are scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}

/** The admin API calls of the settings feature, bound to the host's injected collaborators.
 *  @example const settingsApi = createSettingsApi({ authenticatedAdminRequest, workspaceId }); */
export function createSettingsApi({ authenticatedAdminRequest, workspaceId }: SettingsApiDeps, _optional: Record<string, never> = {}) {
  return {
    // SPEC-007 Settings (core-only layered ledger) — Phase 6 UI.
    getSettingsEffective: ({ namespace }: { namespace: string }, options: { principalId?: string } = {}) => {
      // The server answers a blank namespace with a bare 400 that names no caller; refuse it here, where
      // the stack still points at whoever passed it. Rejected (not thrown) so `.catch` chains still work.
      if (namespace.trim() === "") return Promise.reject(new TypeError(BLANK_NAMESPACE_MESSAGE));
      const params = new URLSearchParams({ namespace });
      if (options.principalId) params.set("principalId", options.principalId);
      const path = `/workspaces/${workspaceId}/settings/effective?${params.toString()}`;
      return shareSettingsEffectiveRead({ namespace, path, port: {
        read: () => authenticatedAdminRequest<{ data: SettingResolvedValue[] }>({ method: "GET", path }),
      } }, {});
    },
    setSetting: (
      input: { namespace: string; key: string; scope: SettingScope; valueJson: unknown },
      options: { principalId?: string } = {}
    ) =>
      authenticatedAdminRequest<SettingValueResponse>({ method: "PUT", path: `/workspaces/${workspaceId}/settings/value`, body: { ...input, ...options } }),
  };
}
