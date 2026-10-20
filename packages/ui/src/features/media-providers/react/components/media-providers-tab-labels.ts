import type { I18nContextValue } from '../../../i18n/index.js';
import type { MediaProvidersTabLabels } from './MediaProvidersTab.js';

/** Every `MediaProvidersTabLabels` field, resolved to the string actually rendered. */
export type ResolvedMediaProvidersTabLabels = Required<MediaProvidersTabLabels>;

/** English defaults, keyed exactly like `MediaProvidersTabLabels`; each is passed through `t`
 *  only when the host did not supply that label (the dictionaries are keyed by this English text). */
const DEFAULT_LABELS: ResolvedMediaProvidersTabLabels = {
  title: 'Media providers',
  description: 'Credentials this host uses to generate images and video.',
  reloadLabel: 'Reload',
  reloadingLabel: 'Reloading…',
  unreachableLabel: 'Could not reach the server. Showing local changes only.',
  emptyStateLabel: 'No media providers configured yet.',
  apiKeyLabel: 'API key',
  apiKeyPlaceholder: 'Paste your API key',
  showKeyLabel: 'Show',
  hideKeyLabel: 'Hide',
  baseUrlLabel: 'Base URL',
  baseUrlPlaceholder: 'https://api.example.com',
  baseUrlDefaultHintTemplate: 'Uses {url} by default.',
  baseUrlInvalidLabel: 'Enter an absolute http:// or https:// URL that is not a private or internal address.',
  modelLabel: 'Model',
  modelPlaceholder: 'Default model',
  savedWithMaskTemplate: 'Saved ({mask})',
  unsavedLabel: 'Unsaved',
  clearLabel: 'Clear',
  saveChangesLabel: 'Save changes',
  savingLabel: 'Saving…',
  savedNoticeLabel: 'Saved.',
  saveErrorLabel: 'Could not save media providers.',
};

/** Host-supplied label where given, else the translated English default. */
export function resolveMediaProvidersTabLabels(
  { t }: { t: I18nContextValue['t'] },
  { labels }: { labels?: MediaProvidersTabLabels | undefined } = {},
): ResolvedMediaProvidersTabLabels {
  const pick = (key: keyof ResolvedMediaProvidersTabLabels): string => labels?.[key] ?? t(DEFAULT_LABELS[key]);
  return {
    title: pick('title'),
    description: pick('description'),
    reloadLabel: pick('reloadLabel'),
    reloadingLabel: pick('reloadingLabel'),
    unreachableLabel: pick('unreachableLabel'),
    emptyStateLabel: pick('emptyStateLabel'),
    apiKeyLabel: pick('apiKeyLabel'),
    apiKeyPlaceholder: pick('apiKeyPlaceholder'),
    showKeyLabel: pick('showKeyLabel'),
    hideKeyLabel: pick('hideKeyLabel'),
    baseUrlLabel: pick('baseUrlLabel'),
    baseUrlPlaceholder: pick('baseUrlPlaceholder'),
    baseUrlDefaultHintTemplate: pick('baseUrlDefaultHintTemplate'),
    baseUrlInvalidLabel: pick('baseUrlInvalidLabel'),
    modelLabel: pick('modelLabel'),
    modelPlaceholder: pick('modelPlaceholder'),
    savedWithMaskTemplate: pick('savedWithMaskTemplate'),
    unsavedLabel: pick('unsavedLabel'),
    clearLabel: pick('clearLabel'),
    saveChangesLabel: pick('saveChangesLabel'),
    savingLabel: pick('savingLabel'),
    savedNoticeLabel: pick('savedNoticeLabel'),
    saveErrorLabel: pick('saveErrorLabel'),
  };
}
