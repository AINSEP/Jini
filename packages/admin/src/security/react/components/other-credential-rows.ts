import type { CredentialCategory, OtherCredentialSummary, OtherStoreId, OtherStoreLink } from '../../models.js';
import type { SecurityTranslator } from '../../messages.en.js';
import type { createOtherCredentialsController } from '../../controllers/other-credentials.controller.js';
import { filterOtherCredentials, otherWritePermission } from '../../rules.js';
import { OTHER_STORE_INFO, otherRemoveBodyKey, otherStorePlaceholders, otherValueFact, type OtherStoreLinks } from '../../other-credentials.rules.js';
type OtherController = ReturnType<typeof createOtherCredentialsController>;
type OtherSnapshot = ReturnType<OtherController['getSnapshot']>;
/** The tab's filter and grants, plus where a Remove request goes (the tab's shared confirm dialog). */
export interface OtherRowScope { readonly permissions: readonly string[]; readonly query: string; readonly category: CredentialCategory | 'all'; readonly onRemove: (row: OtherCredentialSummary) => void }
/** The live translator (a locale change relabels in place) and the host's per-store deep links. */
export interface OtherRowHost { readonly t: SecurityTranslator; readonly links: OtherStoreLinks }
/** Configured rows with their value fact, deep link and per-row pending and error state. Controller
 * messages are English keys, so they pass through `t` like every other label. */
export function otherCredentialItems({ snapshot: o, controller, scope, host }: { snapshot: OtherSnapshot | null; controller: OtherController | null; scope: OtherRowScope; host: OtherRowHost }, _optional: Record<string, never> = {}) {
  if (!o) return [];
  return filterOtherCredentials({ rows: o.rows, query: scope.query, category: scope.category }).map(row => {
    const key = `${row.store}:${row.id}`, error = o.rowErrors[key];
    return { key, row, title: row.label, fact: otherValueFact({ row, t: host.t }), link: host.links[row.store] ?? null, canWrite: scope.permissions.includes(otherWritePermission({ store: row.store })),
      pending: o.pending === key, error: error ? host.t(error) : null, token: o.drafts[key] ?? '',
      onToken({ value }: { value: string }) { controller?.setDraft({ key, token: value }); }, replace() { void controller?.replace({ row }); }, remove() { scope.onRemove(row); } };
  });
}
export type OtherCredentialItem = ReturnType<typeof otherCredentialItems>[number];
export interface OtherPlaceholderItem { readonly key: string; readonly store: OtherStoreId; readonly title: string; readonly note: string; readonly link?: OtherStoreLink }
/** A settled, empty store stays visible as "Not configured" with its deep link, filtered like a row. */
export function otherPlaceholderItems({ snapshot: o, scope, host }: { snapshot: OtherSnapshot | null; scope: Omit<OtherRowScope, 'onRemove'>; host: OtherRowHost }, _optional: Record<string, never> = {}): readonly OtherPlaceholderItem[] {
  if (!o) return [];
  const query = scope.query.trim().toLowerCase();
  return otherStorePlaceholders({ rows: o.rows, loaded: o.loaded }).map(store => {
    const link = host.links[store];
    return { key: store, store, title: host.t(OTHER_STORE_INFO[store].label), note: host.t('otherNotConfigured'), ...(link ? { link } : {}) };
  }).filter(item => (scope.category === 'all' || OTHER_STORE_INFO[item.store].category === scope.category) && item.title.toLowerCase().includes(query));
}
/** The removal consequence for one other store, translated. */
export function otherRemovalBody({ row, t }: { row: OtherCredentialSummary; t: SecurityTranslator }, _optional: Record<string, never> = {}): string {
  return t(otherRemoveBodyKey({ store: row.store }));
}
