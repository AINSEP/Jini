import { useCallback, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import { useFetchQuery, useFetchMutation, useInvalidate } from '@jini-ai/ui/fetch-query';
import { buildAgentListHandles } from '@jini-ai/agentic';
import type { AdminRedirect, AdminRedirectsPort } from '../../../core/ports/redirects.js';
import { useController } from '../../../core/react/use-controller.js';
import { createRedirectsController } from '../../controllers/redirects.controller.js';
import type { RedirectsActions } from '../../controllers/redirects.controller.js';
import type { RedirectsTranslate } from '../../models.js';
import type { RedirectsEventsPort } from '../../ports.js';
import { KEYS, buildCreateRedirectPayload, nextRedirectStatus, firstWriteError, isAnyWritePending, visibleRedirectsError } from '../../rules.js';
import { translateRedirectsEn } from '../../messages.en.js';
/** Preserve the fetch-query pilot's cache/invalidation lifecycle and first-load-only screen guard.
 * One list read, three independent writes, the same error precedence and no form reset on failure.
 * Localization arrives once from the host, preventing N independent settings reads per table row.
 */
export function useRedirects(
  { api }: { api: AdminRedirectsPort },
  { t = translateRedirectsEn, locale = 'en', events }: { t?: RedirectsTranslate; locale?: string; events?: RedirectsEventsPort } = {},
) {
  const list = useFetchQuery({ key: KEYS.list, fetch: () => api.listRedirects({}) });
  const invalidate = useInvalidate();
  const invalidateList = useCallback(() => invalidate({ key: KEYS.list }), [invalidate]);
  useEffect(() => events?.subscribe(invalidateList), [events, invalidateList]);
  // Writes name their cache rather than calling a loader. Other views of the key refresh too,
  // and background reads keep the last successful table on screen.
  const createRule = useFetchMutation({ run: ({ input: form }: { input: FormData }) => api.createRedirect(buildCreateRedirectPayload({ form })) }, { invalidates: [KEYS.list] });
  const toggleStatus = useFetchMutation({ run: ({ input: rule }: { input: AdminRedirect }) => api.updateRedirect({ id: rule.id }, { status: nextRedirectStatus({ currentStatus: rule.status }) }) }, { invalidates: [KEYS.list] });
  const removeRule = useFetchMutation({ run: ({ input: rule }: { input: AdminRedirect }) => api.tombstoneRedirect({ id: rule.id }) }, { invalidates: [KEYS.list] });
  const writes = [createRule, toggleStatus, removeRule];
  const saving = isAnyWritePending({ writes });
  const error = visibleRedirectsError({ writeError: firstWriteError({ writes }), saving, listError: list.error });
  const actions = useRef<RedirectsActions>(null!);
  actions.current = {
    saving,
    create: form => createRule.mutate({ input: form }),
    toggle: rule => toggleStatus.mutate({ input: rule }),
    remove: rule => removeRule.mutate({ input: rule }),
    resetOthers(active) {
      const activeWrite = { create: createRule, toggle: toggleStatus, remove: removeRule }[active];
      // A new write used to clear one shared error. Reset siblings so an earlier create failure
      // cannot blame a later successful toggle merely because create is first in the array.
      for (const write of writes) if (write !== activeWrite) write.reset();
    },
  };
  const { controller, snapshot } = useController({ create: () => createRedirectsController({ actions: () => actions.current }), dependencies: [] });
  const redirects = list.data;
  const createRedirect = (form: FormData) => controller?.createRedirect({ form }) ?? Promise.resolve(false);
  function submitCreate(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    // Capture synchronously: React clears currentTarget after dispatch. Reset only on success.
    const form = e.currentTarget;
    void createRedirect(new FormData(form)).then(succeeded => { if (succeeded) form.reset(); });
  }
  return {
    redirects, listStatus: list.status, listError: list.error, error, saving,
    pendingDelete: snapshot?.pendingDelete ?? null,
    setPendingDelete: (rule: AdminRedirect | null) => controller?.setPendingDelete({ rule }),
    confirmDelete: () => controller?.confirmDelete(), deletePending: removeRule.status === 'pending',
    createRedirect, submitCreate,
    onToggleStatus: (rule: AdminRedirect) => controller?.onToggleStatus({ rule }),
    onRequestDelete: (rule: AdminRedirect) => controller?.onRequestDelete({ rule }),
    t, locale,
    // Stable, unique ids disambiguate every row's action menu and lazy hits button.
    rowMenuHandles: buildAgentListHandles({ prefix: 'redirects-row', ids: (redirects ?? []).map(rule => rule.id) }),
  };
}
export type RedirectsController = ReturnType<typeof useRedirects>;
