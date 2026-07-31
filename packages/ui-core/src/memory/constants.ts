// Static constants for the memory slice: the manual-editor type list and
// starters, the field-label style, and the connector app catalogue. No state,
// no transport — pure module-level data shared by the slice's components.
import type { DraftEntry, MemoryType } from './types.js';

// All manually-selectable memory types. `profile` (the structured singleton)
// and `rule` (verified checks the POST loop enforces) join the original four
// so the editor type-picker and the saved-memory filter pills surface them.
export const TYPES: MemoryType[] = ['profile', 'user', 'feedback', 'project', 'reference', 'rule'];

export const EMPTY_DRAFT: DraftEntry = {
  name: '',
  description: '',
  type: 'user',
  body: '',
};

// Small uppercase caption used above each form field. Centralised so
// every field renders with the same color/letter-spacing/baseline; this
// is what gives the editor a settings-form rhythm rather than a stack
// of unlabelled inputs.

/**
 * Click-to-prefill examples shown above the editor when creating a new
 * memory. Three starters cover the most common reasons a person writes a
 * memory by hand: tell the assistant about themselves, lock in a repeated
 * UI/output preference, or pin the current project. Plain-English strings
 * (not dictionary keys) per this package's i18n convention — the caller
 * wraps each in `t()` at the render site, so `t(starter.name)` doubles as
 * both the passthrough default and the translation-dictionary key.
 */
export const STARTERS: ReadonlyArray<{
  type: MemoryType;
  name: string;
  description: string;
  body: string;
}> = [
  {
    type: 'user',
    name: 'About me',
    description: 'Tell the assistant about yourself',
    body: 'I prefer concise answers with code examples.',
  },
  {
    type: 'feedback',
    name: 'A preference I repeat often',
    description: 'Lock in a UI or output preference',
    body: 'Always use dark mode for generated UI.',
  },
  {
    type: 'project',
    name: 'This project',
    description: 'Pin context about the current project',
    body: 'This project targets a mobile-first responsive layout.',
  },
];

export const MEMORY_CONNECTOR_APP_IDS = ['notion', 'figma', 'linear', 'google_drive', 'github', 'slack'] as const;

// Keyed by the id union itself (not a general `Record<string, string>`) so
// adding an id above without a label here is a type error, not a silent
// runtime fallback — this is what makes the `?? id` guard callers used to
// need provably unnecessary.
export const MEMORY_CONNECTOR_APP_LABELS: Record<(typeof MEMORY_CONNECTOR_APP_IDS)[number], string> = {
  notion: 'Notion',
  figma: 'Figma',
  linear: 'Linear',
  google_drive: 'Google Drive',
  github: 'GitHub',
  slack: 'Slack',
};

/** Looks up a label for a connector id that ISN'T statically known to be one
 *  of `MEMORY_CONNECTOR_APP_IDS` — e.g. a `connectorId` string arriving from
 *  an API response. Returns undefined for an id this app doesn't recognize,
 *  unlike `MEMORY_CONNECTOR_APP_LABELS[id]` directly, which requires (and is
 *  typed to guarantee) a known id. */
export function connectorAppLabel(connectorId: string): string | undefined {
  return (MEMORY_CONNECTOR_APP_LABELS as Record<string, string | undefined>)[connectorId];
}

/**
 * Placeholder `provider` label for a memory-connector catalogue row this
 * client has only an id for (no full connector detail has loaded yet).
 * The pinned source hardcoded `'composio'` here — that's a specific
 * third-party OAuth-integration vendor OD's real deployment happens to use,
 * not a generic concept, so this package uses a neutral placeholder instead;
 * a host resolving real connector details overwrites it via
 * `applyConnectorStatuses`/discovery merge before it's ever shown as the
 * sole source of truth.
 */
export const DEFAULT_CONNECTOR_PROVIDER = 'connector-catalog';

export const CONNECTOR_CALLBACK_MESSAGE_TYPE = 'jini:connector-connected';

export const MEMORY_CONNECTOR_PENDING_AUTH_STORAGE_KEY = 'jini:memory:pending-connector-auth';
