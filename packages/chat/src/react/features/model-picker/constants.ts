import type { CredentialStatus } from './types.js';

/** Below this many total options, the picker skips the search input (matches OD's `SearchableModelSelect`). */
export const DEFAULT_MIN_SEARCHABLE_OPTIONS = 8;

/** Lower sorts first: configured providers surface above merely-available, above unconfigured. */
export const CREDENTIAL_STATUS_SORT_PRIORITY: Record<CredentialStatus, number> = {
  configured: 0,
  available: 1,
  unconfigured: 2,
};
