import { useRef } from 'react';
import type { FormEvent } from 'react';
import { useFetchMutation } from '@jini-ai/ui/fetch-query';
import { describeApiError } from '../../../core/transport/errors.js';
import { useController } from '../../../core/react/use-controller.js';
import type { AdminRedirectCreateInput, AdminRedirectsPort } from '../../../core/ports/redirects.js';
import type { RedirectsTranslate } from '../../models.js';
import { createImportRedirectsController } from '../../controllers/import-redirects.controller.js';
import { KEYS } from '../../rules.js';
import { translateRedirectsEn } from '../../messages.en.js';
type ImportRedirectsSnapshot = ReturnType<ReturnType<typeof createImportRedirectsController>['getSnapshot']>;
/** Before the controller mounts there is no snapshot: an empty form. A parse error wins over a
 * request error, so a later parse failure replaces an earlier request failure instead of stacking. */
function deriveFormState(
  { snapshot, requestError }: { snapshot: ImportRedirectsSnapshot | null; requestError: unknown }, _optional = {},
) {
  return { raw: snapshot?.raw ?? '',
    error: snapshot?.parseError ?? (requestError ? describeApiError({ e: requestError, fallback: 'Import failed' }) : null),
    result: snapshot?.result ?? null };
}
/** A resolved 207 is a result, including failed items; only transport failures enter error state. */
export function useImportRedirectsForm(
  { api }: { api: AdminRedirectsPort },
  { t = translateRedirectsEn, locale = 'en' }: { t?: RedirectsTranslate; locale?: string } = {},
) {
  const mutation = useFetchMutation({ run: ({ input: rules }: { input: readonly AdminRedirectCreateInput[] }) => api.importRedirects({ rules }) }, { invalidates: [KEYS.list] });
  const current = useRef({ mutation, t });
  current.current = { mutation, t };
  const { controller, snapshot } = useController({
    create: () => createImportRedirectsController({ t: () => current.current.t, actions: () => ({ reset: current.current.mutation.reset, run: rules => current.current.mutation.mutate({ input: rules }) }) }),
    dependencies: [],
  });
  function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    return controller?.submit() ?? Promise.resolve();
  }
  const { raw, error, result } = deriveFormState({ snapshot, requestError: mutation.error });
  return { raw, setRaw: (next: string) => controller?.setRaw({ raw: next }),
    error, result, importing: mutation.status === 'pending', submit, t, locale };
}
export type ImportRedirectsFormController = ReturnType<typeof useImportRedirectsForm>;
