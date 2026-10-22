import { useFetchQuery } from '@jini-ai/ui/fetch-query';
import { useController } from '../../../core/react/use-controller.js';
import type { AdminRedirectsPort } from '../../../core/ports/redirects.js';
import type { RedirectsTranslate } from '../../models.js';
import { createHitCountController } from '../../controllers/hit-count.controller.js';
import { KEYS } from '../../rules.js';
import { translateRedirectsEn } from '../../messages.en.js';
/** Localization is passed from the list once; a row never independently fetches locale settings. */
export function useHitCountCell(
  { redirectId, api }: { redirectId: string; api: AdminRedirectsPort },
  { t = translateRedirectsEn }: { t?: RedirectsTranslate } = {},
) {
  // Preserve the original mount-local requested flag across redirect-id/port prop changes.
  const { controller, snapshot } = useController({ create: () => createHitCountController({}), dependencies: [] });
  // Enabled only after a gesture: no N+1 request burst when rendering a large table.
  const hits = useFetchQuery({ key: KEYS.hits({ redirectId }), fetch: () => api.getRedirectHitStats({ id: redirectId }) }, { enabled: snapshot?.requested ?? false });
  return { error: hits.error, data: hits.data === undefined ? undefined : { data: hits.data },
    isFetching: hits.isFetching, request: () => controller?.request(), t };
}
export type HitCountCellController = ReturnType<typeof useHitCountCell>;
