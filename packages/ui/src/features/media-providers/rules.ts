import { isAllowedEndpointUrl } from '../../utils/endpoint-policy.js';
import type { MediaProviderCredentials, MediaProviderMap } from './types.js';

/**
 * Reconciliation rules for credentials that exist in two places at once: a
 * server ("daemon") that holds the authoritative copy, and a local editor
 * where the operator may have unsaved changes.
 *
 * See `types.ts` for the recoverable-vs-marker distinction these all turn on.
 */

/** Trimmed-non-empty, treating `undefined`/`null` as absent. */
function filled(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

/**
 * Whether the entry carries real, re-sendable credential data.
 *
 * Markers (`apiKeyConfigured`/`apiKeyTail`) deliberately do NOT count — they
 * prove a key exists somewhere without carrying anything that could be sent
 * back. This is the predicate that decides whether a local edit is worth
 * preserving over the server's copy.
 */
export function hasRecoverableFields(entry: MediaProviderCredentials | null | undefined): boolean {
  return filled(entry?.apiKey) || filled(entry?.baseUrl) || filled(entry?.model);
}

/**
 * Whether the entry is configured AT ALL — real data OR a server marker.
 *
 * Broader than `hasRecoverableFields` on purpose: for "is this provider set
 * up?" a server-held key the UI cannot see still counts as set up.
 */
export function isEntryPresent(entry: MediaProviderCredentials | null | undefined): boolean {
  return hasRecoverableFields(entry) || Boolean(entry?.apiKeyConfigured) || filled(entry?.apiKeyTail);
}

/** Inverse of `isEntryPresent`, kept as its own name because call sites read
 *  far better as "is empty" than as a negation. */
export function isEntryEmpty(entry: MediaProviderCredentials | null | undefined): boolean {
  return !isEntryPresent(entry);
}

/**
 * An entry that is configured but holds nothing usable — markers only.
 *
 * These are echoes of a server state that no longer exists. When the server
 * reports no managed providers at all, every marker-only local entry is stale
 * and must be dropped, or the UI keeps claiming a provider is configured after
 * the server has forgotten it.
 */
export function isMarkerOnlyEntry(entry: MediaProviderCredentials | null | undefined): boolean {
  return isEntryPresent(entry) && !hasRecoverableFields(entry);
}

/** Whether any provider in the map is configured. */
export function hasAnyConfiguredProvider(providers: MediaProviderMap | null | undefined): boolean {
  if (!providers) return false;
  return Object.values(providers).some((entry) => isEntryPresent(entry));
}

/**
 * Merges the server's providers over the local ones.
 *
 * Three cases, in order:
 *
 * 1. **`daemonProviders == null`** — the server was never reached (as opposed
 *    to reached and empty). Local state is returned untouched. Treating an
 *    unreachable server as "the server has nothing" would wipe local edits on
 *    a network blip, which is why `null` and `{}` must stay distinguishable.
 * 2. **Server reached, manages nothing** — every marker-only local entry is a
 *    stale echo and is dropped. Entries with real local data are KEPT: the
 *    operator typed those and no server has claimed them yet.
 * 3. **Server reached with providers** — each present server entry wins,
 *    EXCEPT where the caller named that provider in `preserveLocalProviderIds`
 *    AND the local entry has recoverable fields. That exception is what stops
 *    a background refresh from overwriting a field being typed. The local
 *    values are layered ON TOP of the server entry (`{...daemon, ...local}`)
 *    rather than replacing it, so server-only markers survive alongside the
 *    edit.
 *
 * Server entries that are not present are skipped entirely — an empty server
 * record must not blank a configured local one.
 *
 * ## `dropProviderIds` — why a preserve list was not enough
 *
 * `preserveLocalProviderIds` can only preserve something that EXISTS locally:
 * case 3 requires `hasRecoverableFields(localEntry)`, and a cleared provider
 * has no local entry at all. So a provider the operator cleared, whose removal
 * has not yet reached the server, was re-created here from the server's own
 * still-present copy — a reload silently put a deleted credential back on
 * screen. A deletion is not a weaker edit; it is an edit the preserve
 * mechanism structurally cannot express, so it needs its own channel.
 * `dropProviderIds` names ids whose local absence is INTENTIONAL and
 * authoritative for this merge, and they are dropped whichever case runs.
 */
export function mergeDaemonProviders(
  localProviders: MediaProviderMap | null | undefined,
  daemonProviders: MediaProviderMap | null | undefined,
  options?: { preserveLocalProviderIds?: ReadonlySet<string>; dropProviderIds?: ReadonlySet<string> },
): MediaProviderMap {
  const dropped = options?.dropProviderIds;
  const withoutDropped = (map: MediaProviderMap): MediaProviderMap =>
    dropped === undefined || dropped.size === 0
      ? map
      : Object.fromEntries(Object.entries(map).filter(([providerId]) => !dropped.has(providerId)));

  const local = withoutDropped({ ...(localProviders ?? {}) });

  if (daemonProviders == null) return local;

  if (!hasAnyConfiguredProvider(daemonProviders)) {
    return Object.fromEntries(Object.entries(local).filter(([, entry]) => !isMarkerOnlyEntry(entry)));
  }

  const merged: MediaProviderMap = { ...local };
  for (const [providerId, daemonEntry] of Object.entries(daemonProviders)) {
    if (!isEntryPresent(daemonEntry)) continue;
    if (dropped?.has(providerId)) continue;
    const localEntry = merged[providerId];
    const preserveLocalEdit =
      Boolean(options?.preserveLocalProviderIds?.has(providerId)) && hasRecoverableFields(localEntry);
    merged[providerId] = preserveLocalEdit ? { ...daemonEntry, ...localEntry } : { ...daemonEntry };
  }
  return merged;
}

/**
 * Whether local credentials should be pushed to the server.
 *
 * True only when the server is reachable, the operator has real local data,
 * and the server manages nothing yet — i.e. a first upload. Once the server
 * holds anything, it is authoritative and pushing would let a stale local copy
 * clobber it; that path belongs to an explicit save, not an automatic sync.
 */
export function shouldSyncLocalProvidersToDaemon(
  localProviders: MediaProviderMap | null | undefined,
  daemonProviders: MediaProviderMap | null | undefined,
): boolean {
  if (daemonProviders == null) return false;
  if (hasAnyConfiguredProvider(daemonProviders)) return false;
  return Object.values(localProviders ?? {}).some((entry) => hasRecoverableFields(entry));
}

/**
 * The base URL to use for a provider: whatever the operator typed, else the
 * catalog's default, else empty.
 *
 * Deliberately still returns whatever was typed, valid or not — callers render
 * this value back into the field, and silently substituting the default under
 * an operator mid-edit would look like their input was eaten. Acceptability is
 * {@link isProviderBaseUrlInvalid}'s question, asked separately.
 */
export function resolveProviderBaseUrl(
  entry: MediaProviderCredentials | null | undefined,
  defaultBaseUrl: string | undefined,
): string {
  const typed = entry?.baseUrl?.trim();
  if (typed) return typed;
  return defaultBaseUrl?.trim() ?? '';
}

/**
 * True when the operator typed a base URL this tab will not send credentials
 * to — distinct from "hasn't typed anything yet", which is not an error state
 * (the catalog default takes over). Mirrors the execution tab's
 * `isBaseUrlInvalid` exactly, against the same shared policy.
 *
 * This tab had NO url validation at all, which made it strictly worse than the
 * execution tab's old scheme-only check on a field of the same kind: operator
 * supplied, persisted, and paired with a real API key that is then sent to
 * whatever it names. See `utils/endpoint-policy.ts`.
 */
export function isProviderBaseUrlInvalid(entry: MediaProviderCredentials | null | undefined): boolean {
  const typed = entry?.baseUrl?.trim();
  if (!typed) return false;
  return !isAllowedEndpointUrl(typed);
}

/** Every provider id in the map whose typed base URL is unacceptable — the save gate's input. */
export function invalidBaseUrlProviderIds(providers: MediaProviderMap | null | undefined): readonly string[] {
  if (!providers) return [];
  return Object.keys(providers).filter((id) => isProviderBaseUrlInvalid(providers[id]));
}

/**
 * Orders a provider catalog for display: configured providers first (real
 * data or a server marker — see `isEntryPresent`), then alphabetically by
 * label within each group. Mirrors `sortDetectedAgents`'s convention in the
 * execution tab's rules — configured-first is what the origin's inline sort
 * did too (`MediaProvidersSection`'s `availableProviders` sort in
 * `SettingsDialog.tsx`), extracted here as a testable pure function instead
 * of living inline in JSX. Generic over `{ id, label }` so callers can pass
 * `MediaProviderOption[]` directly without this module importing that type.
 */
export function sortProvidersByConfigured<T extends { id: string; label: string }>(
  catalog: readonly T[],
  providers: MediaProviderMap | null | undefined,
): readonly T[] {
  return [...catalog].sort((a, b) => {
    const aConfigured = isEntryPresent(providers?.[a.id]);
    const bConfigured = isEntryPresent(providers?.[b.id]);
    if (aConfigured !== bConfigured) return aConfigured ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

/** How many trailing characters of a key may ever be shown. Matches
 *  `source-config-list`'s `MASKED_VALUE_VISIBLE_SUFFIX_LENGTH` — the two mask
 *  the same class of secret and must not disagree about how much of it leaks. */
const KEY_TAIL_MAX_LENGTH = 4;

/**
 * How a configured key should be displayed.
 *
 * Never returns the key itself. A locally-typed key is masked down to its own
 * tail so it reads the same as a server-reported one, which keeps the UI from
 * looking different depending on where the value happens to live.
 *
 * **`apiKeyTail` is clamped rather than trusted.** It arrives from the daemon,
 * and `types.ts` describes it as "the last few characters" in prose only — there
 * was nothing enforcing that. A daemon bug (or a compromised one) returning the
 * WHOLE key in that field would have rendered the whole key behind a `••••`
 * prefix that makes it look masked. Clamping here means the display cannot leak
 * more than it promises no matter what the server sends.
 */
export function maskedKeyLabel(entry: MediaProviderCredentials | null | undefined): string | null {
  const tail = entry?.apiKeyTail?.trim();
  if (tail) return `••••${tail.slice(-KEY_TAIL_MAX_LENGTH)}`;
  const local = entry?.apiKey?.trim();
  if (local) return `••••${local.slice(-KEY_TAIL_MAX_LENGTH)}`;
  if (entry?.apiKeyConfigured) return '••••';
  return null;
}
