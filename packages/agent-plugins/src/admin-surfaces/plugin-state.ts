import { ADMIN_SURFACE_STATE_LIMITS, type AdminSurfaceState, type AdminSurfaceStateValue } from "./surface-capabilities.js";
import type { AdminSurfacePluginStatePersistence } from "./plugin-state-persistence.js";
import type { AgentPluginStateReader } from "../lifecycle/tools/capabilities.js";
import type { VaultMeta } from "@jini-ai/core/contracts/vault";


/**
 * @file A plugin's own settings ("state": which products are on, the chosen resource), one JSON
 * value per key, scoped to one workspace and one plugin. The admin-surface port writes it; the
 * plugin's tools and its form delivery only read it, so a setting a surface saves is what they honor.
 *
 * Why the api-connection vault rows: they already give per-workspace rows, revision-checked writes
 * and exclusion from the exportable settings ledger, so plugin state needs no new table or vault
 * kind (no migration). Values are not secret; Jini's surface session refuses a value that mentions
 * a token the call obtained, and this store re-checks the size and key caps itself so a host path
 * that skips the session cannot grow storage without bound.
 */

/** Keys one plugin may hold in one workspace; a new key past this is refused, existing keys still update. */
export const PLUGIN_STATE_MAX_KEYS = 128;
const KEY_PATTERN = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,${ADMIN_SURFACE_STATE_LIMITS.maxKeyLength - 1}}$`);
/** Plugin ids are lowercase hyphenated, so the `:` after one always ends it. */
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AgentPluginStateScope {
  readonly workspaceId: string;
  readonly pluginId: string;
}

export interface AgentPluginStateStore {
  /** Read-write view for the plugin's admin-surface handlers. */
  forPlugin(required: AgentPluginStateScope, optional?: Record<string, never>): AdminSurfaceState;
  /** Read-only view (`get` alone) for the plugin's tools and form delivery. */
  readerFor(required: AgentPluginStateScope, optional?: Record<string, never>): AgentPluginStateReader;
  /** Non-secret summary of the plugin's saved settings: each key with its vault revision, sorted by
   *  key, never a value. The Agent Plugin update journal records it as its settings snapshot, and that
   *  journal is a plaintext file on disk, so values must never reach it. */
  describe(required: AgentPluginStateScope, optional?: Record<string, never>): Promise<AgentPluginStateSummary>;
}

export interface AgentPluginStateSummary {
  readonly keys: readonly { readonly key: string; readonly revision: number }[];
}

const rowPrefix = (pluginId: string): string => `plugin-state:${pluginId}:`;

function checkedKey(key: unknown): string {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) throw new Error("A plugin setting key must be 1-128 letters, digits, '.', '_', ':' or '-'.");
  return key;
}

/** The value as stored: one JSON text, size-checked on that text. @complexity O(n) in its size. */
function checkedValue(value: AdminSurfaceStateValue): AdminSurfaceStateValue {
  const text = JSON.stringify(value);
  if (text === undefined || new TextEncoder().encode(text).byteLength > ADMIN_SURFACE_STATE_LIMITS.maxValueBytes) {
    throw new Error(`A plugin setting may be at most ${ADMIN_SURFACE_STATE_LIMITS.maxValueBytes} bytes of JSON.`);
  }
  return JSON.parse(text) as AdminSurfaceStateValue;
}


/**
 * Creates the workspace's plugin-state store over the api-connection vault.
 * @param required.vault - The workspace's api-connection vault (`createApiConnectionVault`).
 * @param required.workspaceId - The only workspace this store serves; any other scope is refused.
 * @complexity get/delete O(1) vault calls; set O(r) in the workspace's api-connection rows (one
 * summary listing); describe O(r log r).
 */
export function createAgentPluginStateStore(
  required: { readonly persistence: AdminSurfacePluginStatePersistence; readonly workspaceId: string; readonly messages: { readonly unavailable: string } },
  _optional: Record<string, never> = {},
): AgentPluginStateStore {
  const { vault, scope, format } = required.persistence;
  const isConflict = (error: unknown) => required.persistence.isConflict({ error });

  /** This scope's row prefix; a foreign workspace or malformed plugin id never reaches the vault. */
  function scopedPrefix(input: AgentPluginStateScope): string {
    if (input.workspaceId !== required.workspaceId || !PLUGIN_ID_PATTERN.test(input.pluginId)) throw new Error(required.messages.unavailable);
    return rowPrefix(input.pluginId);
  }

  /** The row id for this scope's key. */
  function rowId(input: AgentPluginStateScope, key: unknown): string {
    return `${scopedPrefix(input)}${checkedKey(key)}`;
  }

  /** Lists summaries only: `vault.list` opens no envelope, so no value is decrypted here.
   *  @complexity O(r log r) in the workspace's api-connection rows. */
  async function describe(input: AgentPluginStateScope): Promise<AgentPluginStateSummary> {
    const prefix = scopedPrefix(input);
    const keys = (await vault.list({ ...scope }))
      .filter((row) => row.id.startsWith(prefix))
      .map((row) => ({ key: row.id.slice(prefix.length), revision: row.revision }))
      // Row ids are unique per plugin, so no two keys compare equal.
      .sort((a, b) => (a.key < b.key ? -1 : 1));
    return { keys };
  }

  /** The existing row's revision comes from the summary listing, which opens no envelope: a row sealed
   *  under a key this machine no longer has (a lost or re-minted store key) can still be overwritten,
   *  so the user re-enters the setting instead of being stuck behind an error. */
  async function write(input: AgentPluginStateScope, key: string, value: AdminSurfaceStateValue): Promise<void> {
    const id = rowId(input, key);
    const stored = checkedValue(value);
    const rows = await vault.list({ ...scope });
    const existing = rows.find((row) => row.id === id);
    if (!existing && rows.filter((row) => row.id.startsWith(rowPrefix(input.pluginId))).length >= PLUGIN_STATE_MAX_KEYS) throw new Error(`A plugin may keep at most ${PLUGIN_STATE_MAX_KEYS} settings here. Remove one and retry.`);
    await vault.put({ ...scope, id, expectedRevision: existing?.revision ?? null, provider: null, label: `Plugin settings ${id}`,
      meta: { credentialFormat: format }, payload: { value: stored } as unknown as VaultMeta })
      .catch((error: unknown) => {
        if (isConflict(error)) throw new Error("This setting changed while it was being saved. Reload the plugin's settings and retry.", { cause: error });
        throw error;
      });
  }

  function readerFor(input: AgentPluginStateScope): AgentPluginStateReader {
    return {
      async get({ key }) {
        const found = await vault.get({ ...scope, id: rowId(input, key) });
        const value = (found?.payload as { value?: AdminSurfaceStateValue } | null | undefined)?.value;
        return value === undefined ? null : value;
      },
    };
  }

  return {
    readerFor,
    describe,
    forPlugin: (input) => ({
      ...readerFor(input),
      set: ({ key, value }) => write(input, key, value),
      async delete({ key }) {
        const id = rowId(input, key);
        const existing = await vault.get({ ...scope, id });
        if (existing) await vault.delete({ ...scope, id, expectedRevision: existing.summary.revision }).catch((error: unknown) => { if (!isConflict(error)) throw error; });
      },
    }),
  };
}

