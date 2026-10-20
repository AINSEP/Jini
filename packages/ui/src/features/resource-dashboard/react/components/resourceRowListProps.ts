import type { useT } from '../../../i18n/index.js';
import type { ResourceRowListViewProps } from './ResourceRowListView.js';

type Translate = ReturnType<typeof useT>;

/**
 * The optional hero-header props `ResourceRowList` hands `ResourceRowListView`.
 * `createLabel` (defaulting to the translated "New") is only forwarded
 * alongside `onCreate`: the view renders the create CTA only when it has a
 * handler to call, so a label with no handler would be dead weight.
 */
export function rowListHeaderProps(
  { t }: { t: Translate },
  { eyebrow, lede, createLabel, onCreate }: { eyebrow?: string | undefined; lede?: string | undefined; createLabel?: string | undefined; onCreate?: (() => void) | undefined },
): Pick<ResourceRowListViewProps, 'eyebrow' | 'lede' | 'createLabel' | 'onCreate'> {
  return {
    ...(eyebrow !== undefined ? { eyebrow } : {}),
    ...(lede !== undefined ? { lede } : {}),
    ...(onCreate ? { createLabel: createLabel ?? t('New'), onCreate } : {}),
  };
}

/** Translated labels for the load failure and the row-action failure, forwarded only while each error is set. */
export function rowListErrorLabelProps(
  { t, error, actionError }: { t: Translate; error: string | null; actionError: string | null },
): Pick<ResourceRowListViewProps, 'errorLabel' | 'actionErrorLabel'> {
  return {
    ...(error ? { errorLabel: t(error) } : {}),
    ...(actionError ? { actionErrorLabel: t(actionError) } : {}),
  };
}
