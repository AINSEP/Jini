import { ToolInputError } from "@jini-ai/core";
import type { VaultRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { SiteKeyReferences } from "@jini-ai/core/contracts/site/project-key-attachments";
import { attachedOnlyVault } from "./attached-vault.js";
import type { KeyAttachments, ProjectKeyTransaction } from "@jini-ai/core/contracts/site/project-key-attachments";
import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";

import type { ProviderKeyUsage } from "@jini-ai/core/contracts/site/plugins-host";
export const providerKeyId = ({ pluginId }: { pluginId: string }, _optional = {}) => `plugin-state:${pluginId}:provider.config`;

export const providerPluginOf = ({ keyId }: { keyId: string }, _optional = {}) => /^plugin-state:([a-z0-9-]+):provider\.config$/.exec(keyId)?.[1];
export const isSharedOAuthKey = ({ row }: { row: Pick<VaultRecord, 'kind' | 'meta'> }, _optional = {}) =>
  row.kind === 'api-connection' && row.meta.credentialFormat === 'oauth-token-set';
export interface ProjectKeyRow { keyId: string; name: string; kind: string; usedByThisSite: boolean; usedBy: readonly string[];
  /** Set for a key still saved only on a site; absent for a Shared Key. */
  siteName?: string; omittedCount?: number;
  /** Plain words: why this site key can't be used yet and what to do. A locked row is never approved. */
  locked?: string }
/** Marks a picker choice as a key still saved only on a site; never a Shared Keys row id. */
export const SITE_KEY_ID_PREFIX = "saved-on-site:";
/** Keys saved in site vaults on this install. Host-provided; deployed single sites have none. */
export interface SiteKeyChoice { keyId: string; name: string; kind: string; siteName: string; locked?: string; omittedCount?: number }
export interface SiteKeySource {
  list(required: Record<string, never>, optional?: Record<string, never>): Promise<SiteKeyChoice[]>;
  /** Metadata only: the row a permission check needs. Never opens the key. */
  find(required: { keyId: string }, optional?: Record<string, never>): Promise<VaultRecord | null>;
  /** After owner approval: move the secret into Shared Keys and return its Shared Keys id. */
  adopt(required: { keyId: string }, optional?: Record<string, never>): Promise<{ keyId: string }>;
}
export interface ProjectKeysPort {
  readonly site?: { readonly id: string; readonly name: string };
  list(required: { cards?: readonly PluginCredentialCard[] }, optional?: Record<string, never>): Promise<ProjectKeyRow[]>;
  /** Shared Keys plus keys saved on other sites. Opens every registered site's database: only for when the picker opens. */
  listChoices(required: { cards?: readonly PluginCredentialCard[] }, optional?: Record<string, never>): Promise<ProjectKeyRow[]>;
  listGranted(required: { cards?: readonly PluginCredentialCard[] }, optional?: Record<string, never>): Promise<ProjectKeyRow[]>;
  permissionFor(required: { keyId: string }, optional?: Record<string, never>): Promise<string>;
  use(required: { keyId: string; use: boolean }, optional?: Record<string, never>): Promise<{ keyId: string; usedByThisSite: boolean; usedBy: readonly string[]; appliesAt: "now" | "restart" | "failed"; message?: string }>;
  savedResult(required: { result: unknown }, optional?: Record<string, never>): Promise<unknown>;
}

function createProjectKeyUse({ siteId, siteName, siteKeys, transaction, bindOAuth, references, attachments, reapply, copy }: Parameters<typeof createProjectKeys>[0], { find, usage, isSiteKey }: { find: (input: { keyId: string }) => Promise<VaultRecord>; usage: (input: { keyId: string }) => Promise<Pick<ProjectKeyRow, 'keyId' | 'usedByThisSite' | 'usedBy'>>; isSiteKey: (input: { keyId: string }) => boolean }) {
  /** Shared attachment lifecycle for a submitted card or an explicit project-key choice.
   * Commit the reference before reapplying a provider; restart/failure status retains the reference.
   */
  const use: ProjectKeysPort["use"] = async (selected, _optional = {}) => {
    if (!siteId) throw new ToolInputError({ message: copy.missingSite });
    // Adoption runs after the card's approval and before the grant; a site key becomes a Shared Key here.
    let input = selected;
    if (selected.use && isSiteKey(selected)) {
      if (!siteKeys) throw new Error("Project key adoption has no site key source");
      input = { ...selected, ...(await siteKeys.adopt(selected)) };
    }
    await transaction({ run: async () => {
      const row = await find(input);
      if (input.use) {
        if (isSharedOAuthKey({ row })) {
          if (!bindOAuth) throw new ToolInputError({ message: copy.oauthBindingRequired });
          await bindOAuth(input);
        }
        // A failed owner commit can leave an inert reference, never an unauthorized secret copy.
        await references?.set({ credentialId: input.keyId });
        await attachments.attach({ siteId, keyId: input.keyId, siteName });
      } else await attachments.detach({ siteId, keyId: input.keyId });
    } });
    // References are portable-site metadata only; the owner grant remains the authority after revoke.
    const pluginId = providerPluginOf(input);
    const result = pluginId ? await reapply({ pluginId }) : "now";
    return { ...(await usage(input)), appliesAt: typeof result === "string" ? result : result.appliesAt,
      ...(input.use ? {} : { message: copy.revoked }),
      ...(typeof result === "string" ? {} : { message: `${result.reason} ${result.action}` }) };
  };
  return use;
}

function createProjectKeyListing({ vault, inventory, describeOAuth, owner: ownerScope }: Pick<Parameters<typeof createProjectKeys>[0], 'vault' | 'inventory' | 'describeOAuth' | 'owner'>, { granted, usage }: { granted: ReturnType<typeof attachedOnlyVault>; usage: (input: { keyId: string }) => Promise<Pick<ProjectKeyRow, 'keyId' | 'usedByThisSite' | 'usedBy'>> }) {
  async function listRows({ cards = [], owner = false }: { cards?: readonly PluginCredentialCard[]; owner?: boolean }) {
      const kinds = ["api-connection", "vendor", "custom", "source-control"] as const;
      const source = owner ? vault : granted;
      const rows = owner && inventory ? await inventory() : (await Promise.all(kinds.map(kind => source.list({ workspaceId: ownerScope.workspaceId, kind, ownerKey: ownerScope.ownerKey, principalId: null })))).flat();
      return Promise.all(rows.filter(row => row.kind !== "api-connection" || providerPluginOf({ keyId: row.id }) || isSharedOAuthKey({ row })).map(async row => {
        const pluginId = providerPluginOf({ keyId: row.id });
        const card = pluginId ? cards.find(card => card.saveKind === "provider-settings" && card.saveTarget === pluginId) : undefined;
        const oauthLabel = isSharedOAuthKey({ row }) ? await describeOAuth?.({ keyId: row.id }) : undefined;
        return { ...(await usage({ keyId: row.id })), name: oauthLabel ?? card?.label ?? row.label, kind: row.kind };
      }));
  }
  return listRows;
}
function createProjectKeySavedResult(vault: VaultRepoPort, usage: (input: { keyId: string }) => Promise<Pick<ProjectKeyRow, 'keyId' | 'usedByThisSite' | 'usedBy'>>, use: ProjectKeysPort['use'], owner: { workspaceId: string; ownerKey: string }): ProjectKeysPort['savedResult'] {
  return async ({ result }, _optional = {}) => {
      const identity = savedKeyIdentity({ result });
      if (!identity) return result;
      const { keyId, value } = identity;
      const row = await vault.find({ workspaceId: owner.workspaceId, id: keyId });
      if (!row) return result;
      // Provider ids also exist in site vaults; a site-only save must never attach its project sibling.
      if (value.store === "site" || value.scope === "site" || (value.credential as { scope?: string } | undefined)?.scope === "site") return result;
      const current = await usage({ keyId });
      return { ...value, ...(current.usedByThisSite ? current : await use({ keyId, use: true })) };
    };
}



export interface CreateProjectKeysRequired {
  vault: VaultRepoPort; attachments: KeyAttachments; siteId: string; siteName: string;
  /** Multi-site installs only: keys still saved only in a site vault, offered next to Shared Keys. */
  siteKeys?: SiteKeySource;
  providerUsage: (input: { pluginId: string }) => Promise<ProviderKeyUsage>;
  reapply: (input: { pluginId: string }) => Promise<"now" | "restart" | { appliesAt: "failed"; reason: string; action: string }>;
  transaction: ProjectKeyTransaction;
  inventory?: () => Promise<VaultRecord[]>;
  references?: SiteKeyReferences;
  /** Validates the consumer against the issuing identity, then saves its inert site binding. */
  bindOAuth?: (input: { keyId: string; use: boolean }) => Promise<void>;
  /** Selected-row account/connection label only; never returns an issuing client or tokens. */
  describeOAuth?: (input: { keyId: string }) => Promise<string>;
  owner: { workspaceId: string; ownerKey: string };
  attachedPolicy: Parameters<typeof attachedOnlyVault>[0]["policy"];
  permissionForRow: (required: { row: VaultRecord }) => string;
  copy: { missingSite: string; missingProjectKey: string; missingSiteKey: string; oauthBindingRequired: string; revoked: string };
}

/** Bounded project inventory; OAuth labels may project the selected sealed account identity.
 * Token payloads never enter the picker. A failed attachment propagates instead of reporting success.
 */
export function createProjectKeys(required: CreateProjectKeysRequired, _optional: Record<string, never> = {}): ProjectKeysPort {
  const { vault, attachments, siteId, siteName, providerUsage, inventory, describeOAuth, siteKeys, owner, attachedPolicy, permissionForRow, copy } = required;
  const find = async ({ keyId }: { keyId: string }) => {
    const row = await vault.find({ workspaceId: owner.workspaceId, id: keyId });
    if (!row) throw new ToolInputError({ message: copy.missingProjectKey });
    permissionForRow({ row });
    return row;
  };
  async function usage({ keyId }: { keyId: string }) {
    const users = await attachments.usersOf({ keyId });
    const pluginId = providerPluginOf({ keyId });
    const effective = pluginId ? await providerUsage({ pluginId }) : undefined;
    return { keyId, usedByThisSite: effective ? effective.store === "project" && effective.usedByThisSite : users.some(user => user.siteId === siteId), usedBy: users.map(user => user.siteName) };
  }
  const use = createProjectKeyUse(required, { find, usage, isSiteKey: input => isSiteKey(input) });
  const isSiteKey = ({ keyId }: { keyId: string }) => Boolean(siteKeys) && keyId.startsWith(SITE_KEY_ID_PREFIX);
  const granted = attachedOnlyVault({ vault, attachments, siteId, policy: attachedPolicy });
  const listRows = createProjectKeyListing({ vault, ...(inventory ? { inventory } : {}), ...(describeOAuth ? { describeOAuth } : {}), owner }, { granted, usage });
  return {
    site: { id: siteId, name: siteName },
    list: input => listRows({ ...input, owner: true }),
    listChoices: async input => [...await listRows({ ...input, owner: true }), ...(await siteKeys?.list({}) ?? []).map(row => ({ ...row, usedByThisSite: false, usedBy: [] }))],
    listGranted: async input => (await listRows(input)).map(row => ({ ...row, usedBy: [] })),
    permissionFor: async input => {
      if (!isSiteKey(input)) return permissionForRow({ row: await find(input) });
      if (!siteKeys) throw new Error("Project key lookup has no site key source");
      const row = await siteKeys.find(input);
      if (!row) throw new ToolInputError({ message: copy.missingSiteKey });
      return permissionForRow({ row });
    },
    use,
    savedResult: createProjectKeySavedResult(vault, usage, use, owner),
  };
}


/** Only successful, identifiable saves can acquire a project attachment. */
function savedKeyIdentity({ result }: { result: unknown }, _optional = {}): { keyId: string; value: Record<string, unknown> } | undefined {
  if (!result || typeof result !== "object") return undefined;
  const value = result as Record<string, unknown>;
  if (value.saved !== true && value.created !== true) return undefined;
  const credential = value.credential as { id?: string } | undefined;
  const keyId = value.keyId ?? credential?.id ?? value.credentialId;
  return typeof keyId === "string" ? { keyId, value } : undefined;
}
