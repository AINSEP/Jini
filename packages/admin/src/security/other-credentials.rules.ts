import type { CredentialCategory, OtherCredentialSummary, OtherStoreId, OtherStoreLink } from './models.js';
import type { SecurityTranslator } from './messages.en.js';
import { OTHER_STORES } from './rules.js';
/** Host deep links per store (`security({ ui }, { otherStores })`); product routes stay in the host. */
export type OtherStoreLinks = Partial<Readonly<Record<OtherStoreId, OtherStoreLink>>>;
/** The message key and category for each store's placeholder heading. */
export const OTHER_STORE_INFO: Readonly<Record<OtherStoreId, { readonly label: string; readonly category: CredentialCategory }>> = {
  'site-assistant': { label: 'otherStoreSiteAssistant', category: 'ai' }, 'admin-byok': { label: 'otherStoreAdminByok', category: 'ai' },
  'media-provider': { label: 'otherStoreMedia', category: 'media' }, 'external-mcp': { label: 'otherStoreMcp', category: 'ai' },
};
/** Stores whose read settled with no row. A store still loading, or whose read failed, is not a
 * placeholder: "Not configured" would then state a fact nobody checked. */
export function otherStorePlaceholders({ rows, loaded }: { rows: readonly OtherCredentialSummary[]; loaded: Readonly<Record<string, boolean>> }, _optional: Record<string, never> = {}): readonly OtherStoreId[] {
  return OTHER_STORES.filter(store => loaded[store] === true && !rows.some(row => row.store === store));
}
/** A row's value fact: the masked hint when the server approved one, else an MCP env-name count in
 * whole-sentence plural forms, else plain "Configured". */
export function otherValueFact({ row, t }: { row: OtherCredentialSummary; t: SecurityTranslator }, _optional: Record<string, never> = {}): string {
  if (row.tokenHint) return `••••${row.tokenHint.last4}`;
  if (!row.envNames) return t('otherConfigured');
  const count = row.envNames.length;
  if (count === 0) return t('otherEnvNamesNone');
  return count === 1 ? t('otherEnvNamesOne') : t('otherEnvNamesMany', { count });
}
/** External MCP deletes the server itself; every other store deletes only the saved copy. */
export function otherRemoveBodyKey({ store }: { store: OtherStoreId }, _optional: Record<string, never> = {}): string {
  return store === 'external-mcp' ? 'otherRemoveBodyMcp' : 'otherRemoveBody';
}
