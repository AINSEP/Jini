import { createElement } from 'react';
import { RowMenu } from '../../../react/index.js';
import type { AdminRedirect } from '../../../core/ports/redirects.js';
import { redirectRowMenuItems } from '../../rules.js';
import { HitCountCell } from '../components/HitCountCell.js';
import { useRedirectsOptions } from './RedirectsOptions.hooks.js';
import { useWiredRedirects } from './wired.hooks.js';
/** Table projections stay outside TSX; DOM/class/handle identities remain the original ones. */
export function useRedirectsPage(
  { useRedirectsHook = useWiredRedirects }: { useRedirectsHook?: typeof useWiredRedirects }, _optional = {},
) {
  const state = useRedirectsHook();
  const { renderMessage, headerActions } = useRedirectsOptions();
  const { t, onToggleStatus, onRequestDelete, rowMenuHandles, pendingDelete } = state;
  const columns = [
    { key: 'from', header: t('From'), cell: (rule: AdminRedirect) => rule.fromPattern },
    { key: 'to', header: t('To'), cell: (rule: AdminRedirect) => rule.toTarget },
    { key: 'type', header: t('Type'), cell: (rule: AdminRedirect) => rule.matchType },
    { key: 'code', header: t('Code'), cell: (rule: AdminRedirect) => rule.statusCode },
    { key: 'source', header: t('Source'), cell: (rule: AdminRedirect) => rule.source },
    // The host's shared serverLabel owns enum localization, including unknown-value passthrough.
    { key: 'status', header: t('Status'), cell: (rule: AdminRedirect) => createElement('span', { className: `status status-${rule.status}` }, t(rule.status, { serverLabel: rule.status })) },
    { key: 'hits', header: t('Hits'), cell: (rule: AdminRedirect, index: number) => createElement(HitCountCell, { t, redirectId: rule.id, ...(rowMenuHandles[index] ? { agentHandleBase: rowMenuHandles[index] } : {}) }) },
    { key: 'actions', header: t('More'), cell: (rule: AdminRedirect, index: number) => createElement(RowMenu, {
      triggerLabel: t('Actions for redirect rule from "{fromPattern}"', { fromPattern: rule.fromPattern }),
      agentHandle: `${rowMenuHandles[index]}-menu`,
      items: redirectRowMenuItems({ rule, handlers: { onToggleStatus, onRequestDelete } }, { t }),
    }) },
  ];
  return { ...state, columns, headerActions, cancelDelete: () => state.setPendingDelete(null),
    deleteBody: pendingDelete ? renderMessage({ key: 'deleteRedirectBody', vars: { fromPattern: pendingDelete.fromPattern } }) : null };
}
