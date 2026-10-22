import { createElement } from 'react';
import type { ChangeEvent } from 'react';
import type { AdminRedirectImportFailure } from '../../../core/ports/redirects.js';
import type { RedirectsTranslate } from '../../models.js';
import { useRedirectsPorts } from './RedirectsPorts.hooks.js';
import { useRedirectsOptions } from './RedirectsOptions.hooks.js';
import { useRedirects } from './use-redirects.hooks.js';
import { useHitCountCell } from './use-hit-count-cell.hooks.js';
import { useImportRedirectsForm } from './use-import-redirects-form.hooks.js';
/** Resolve localization once for the list; every row receives that bound translator. */
export function useWiredRedirects(_required: Record<string, never> = {}, _optional = {}) {
  const { redirectsApi: api, redirectsEvents: events } = useRedirectsPorts();
  const { t, locale } = useRedirectsOptions();
  return useRedirects({ api }, { t, locale, ...(events ? { events } : {}) });
}
/** Hit counts stay gesture-gated and use the same scoped resource port as list and import. */
export function useWiredHitCountCell({ redirectId, t }: { redirectId: string; t: RedirectsTranslate }, _optional = {}) {
  const { redirectsApi: api } = useRedirectsPorts();
  return useHitCountCell({ redirectId, api }, { t });
}
/** Derive copy and input handlers outside TSX. Partial results remain individual created/failed rows. */
export function useWiredImportRedirectsForm({ t, locale }: { t: RedirectsTranslate; locale: string }, _optional = {}) {
  const { redirectsApi: api } = useRedirectsPorts();
  const { renderMessage } = useRedirectsOptions();
  const form = useImportRedirectsForm({ api }, { t, locale });
  return { ...form,
    changeRaw: (event: ChangeEvent<HTMLTextAreaElement>) => form.setRaw(event.target.value),
    rulesLabel: renderMessage({ key: 'importRulesLabel', shapeCode: createElement('code', { key: 'shape' }, '{matchType, fromPattern, toTarget, statusCode, override?, priority?}') }),
    resultSummary: form.result ? t('{created} created, {failed} failed.', { created: form.result.created.length, failed: form.result.failed.length }) : '',
    createdText: t('Created'),
    failedLabel: (failure: AdminRedirectImportFailure) => t('Item {index} ({code})', { index: failure.index, code: failure.code }),
  };
}
