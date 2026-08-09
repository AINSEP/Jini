/**
 * Origin: `MediaProvidersSection` (`SettingsDialog.tsx:7028`) plus the media
 * provider half of `state/config.ts` (`isStoredMediaProviderEntry*`,
 * `mergeDaemonMediaProviders`, `hasAnyConfiguredProvider`,
 * `shouldSyncLocalMediaProvidersToDaemon` and their private helpers).
 *
 * What is generic and ported: a per-provider credential record, and the rules
 * for reconciling a SERVER-HELD credential store against LOCAL unsaved edits.
 * None of that is product-bound — it is the same problem any host has once
 * credentials can live in two places at once.
 *
 * What is NOT ported verbatim: the origin's full `MEDIA_PROVIDERS` catalog
 * (`media/models.ts`, 761 lines of concrete image/video vendors with their
 * endpoints and model lists). Instead this feature ships a small, curated
 * `DEFAULT_MEDIA_PROVIDER_CATALOG` (see `constants.ts`) as a starting point,
 * not a fixed list — same convention as `execution/constants.ts`'s
 * `DEFAULT_PROVIDER_PRESETS`. A host with its own provider roster (or a
 * larger/different one) passes its own `catalog` to `MediaProvidersTab` to
 * replace this wholesale.
 *
 * Also not ported: the origin's functions take and return its whole
 * `AppConfig`. Here they take and return the providers RECORD alone. Threading
 * an entire host config object through a credential-merge rule is what made
 * the origin's version untestable in isolation.
 */

/**
 * One provider's stored credentials.
 *
 * TWO KINDS OF "PRESENT" live in this shape, and conflating them is the bug
 * this whole module exists to avoid:
 *
 * - **Recoverable fields** (`apiKey`, `baseUrl`, `model`) are real values the
 *   operator typed and that can be re-sent.
 * - **Markers** (`apiKeyConfigured`, `apiKeyTail`) are the server saying "a key
 *   exists here, but you don't get to see it". They prove configuration
 *   without carrying anything usable.
 *
 * An entry holding ONLY markers is configured but carries no data — see
 * `isMarkerOnlyEntry`.
 */
export interface MediaProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Server-side marker: a key is stored, not disclosed. */
  apiKeyConfigured?: boolean;
  /** Server-side marker: last few characters, for display only. */
  apiKeyTail?: string;
  /** Free-form provenance tag, host-defined. */
  source?: string;
}

/** Credentials keyed by provider id. */
export type MediaProviderMap = Record<string, MediaProviderCredentials>;

/**
 * One selectable provider in the catalog. A host supplies its own catalog —
 * this package ships `DEFAULT_MEDIA_PROVIDER_CATALOG` as a starting point,
 * not as a fixed list (same convention as `ProviderPreset`).
 */
export interface MediaProviderOption {
  id: string;
  label: string;
  /** Prefilled when the operator picks this provider and typed nothing. */
  defaultBaseUrl?: string;
  /** Model ids this provider advertises. A host that discovers models at
   *  runtime can leave this empty. */
  models?: readonly string[];
}

/**
 * Result of the tab's daemon read, surfaced while the initial fetch or a
 * manual reload is in flight. `'unreachable'` mirrors
 * `MediaProvidersPort.fetchMediaProviders`'s `null` result as a renderable
 * state — the daemon was never reached, distinct from `'ok'` (reached; local
 * state is now reconciled against whatever it reported, including managing
 * nothing at all). There is no `'error'` member: the port's `fetchMediaProviders`
 * never rejects — see its own doc comment for why unreachable is a value,
 * not a failure, in this contract.
 */
export type MediaProvidersLoadState = { status: 'loading' } | { status: 'ok' } | { status: 'unreachable' };

/**
 * Result of `MediaProvidersPort.saveMediaProviders`, surfaced near whichever
 * action triggered it (an explicit Save, or Clear's implicit save-on-clear).
 * Same "async edge result" idiom as `ConnectionTestState`/`AgentScanState` in
 * the execution tab's types — one shared shape for "what happened the last
 * time this async edge ran" across this package.
 */
export type MediaProvidersSaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'save-error'; message: string };
