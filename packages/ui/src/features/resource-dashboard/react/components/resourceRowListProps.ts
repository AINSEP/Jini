import type { useT } from '../../../i18n/index.js';
import type { ResourceRowListViewProps } from './ResourceRowListView.js';
import type { ResourceStatusOption } from '../../types.js';

type Translate = ReturnType<typeof useT>;

/** Resolve an option label with the status itself as the fallback. */
export function createResourceStatusLabel({ t, statusOptions }: { t: Translate; statusOptions: ResourceStatusOption[] }, _options = {}) {
  return (status: string) => t(statusOptions.find((option) => option.value === status)?.label ?? status);
}

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
