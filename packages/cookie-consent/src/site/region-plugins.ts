/** @file Region readers and browser bridges for cookie consent, contributed as DATA by active plugins in
 * {@link CONSENT_CONTRIBUTIONS_FILENAME} (schema 2: one open `contributions` list of `{ kind, id, … }`).
 * Core names no host. Only the configured ingress plugin may contribute trusted region readers: a
 * country header from anywhere else can be forged by the visitor. No ingress (Fly, Electron, a
 * static export) means no reader, and every visitor gets the strict banner with Reject.
 *
 * Trust: data-only (no plugin code runs) and loaded for ACTIVE plugins only, so switching a host
 * plugin off stops trusting its header. Kinds this file doesn't know are skipped, not refused. */
import { consentBridgeContribution, declaredScriptsContribution, parseConsentContributions as parseConsentFile } from '../contracts/consent-file.js';
import { REGION_SLOT } from '../server/region.js';
import type { DeclaredScript, RawContribution, RegionResolver } from '@jini-ai/core/contracts/site/cookie-consent';

/** The part of a host plugin-contribution definition this file declares: a data file per active plugin,
 * parsed and loaded entry by entry. The host's contribution loader accepts it as is. */
export interface ConsentContributionDefinition<D, T> {
  readonly filename: string;
  readonly contribution: string;
  readonly kind: 'data';
  readonly parse: (input: { readonly raw: string }) => { ok: true; descriptors: D[] } | { ok: false; reason: string };
  readonly load: (input: { readonly plugin: { readonly pluginId: string }; readonly descriptor: D }) => T | string | Promise<T | string>;
  readonly onReadError?: (input: { readonly error: unknown }) => readonly string[] | undefined;
}

/** The host's plugin-contribution loader (trust, activation and file reads stay with the host). */
export type LoadConsentContributions = <D, T>(
  required: { readonly workspaceId: string; readonly definition: ConsentContributionDefinition<D, T> },
  optional: { readonly requireActive?: boolean },
) => Promise<{ readonly items: readonly T[]; readonly refusals: readonly string[] }>;

/** Receives a plain message (no prefix) and the caught error; the host owns the console line and redaction. */
export type ReportConsentPluginFailure = (required: { message: string; error: unknown }, optional?: Record<string, never>) => void;

/** The file a plugin ships at its root to contribute cookie-consent pieces. */
export const CONSENT_CONTRIBUTIONS_FILENAME = 'jini-consent.json';

/** Parse one schema-2 file into region readers and browser bridge declarations. Pure. @complexity O(entries).
 * The rules live in `@jini-ai/cookie-consent/plugins`; this keeps the host's name and signature. */
export function parseConsentContributions({ raw }: { raw: string }, _optional = {}): { ok: true; descriptors: RawContribution[] } | { ok: false; reason: string } {
  return parseConsentFile({ raw });
}

type PluginRegion = { pluginId: string; entry: RawContribution };
const regionContribution: ConsentContributionDefinition<RawContribution, PluginRegion> = {
  filename: CONSENT_CONTRIBUTIONS_FILENAME, contribution: 'cookie consent contributions', kind: 'data',
  parse: parseConsentContributions,
  load: ({ plugin, descriptor }) => descriptor.kind === 'declared-scripts'
    ? declaredScriptsContribution({ pluginId: plugin.pluginId, entry: descriptor }) : { pluginId: plugin.pluginId, entry: descriptor },
  onReadError: ({ error }) => (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : undefined,
};

/** Turn data entries into resolvers through the package's own trust boundary; refused entries drop.
 * `legacyHeader` absorbs the host's older consent-region-header setting as one more header reader.
 * @complexity O(entries). */
export function toRegionResolvers({ entries }: { entries: readonly RawContribution[] }, { legacyHeader }: { legacyHeader?: string | undefined } = {}): RegionResolver[] {
  const readers = entries.filter(entry => entry.kind === 'region-resolver');
  const all = legacyHeader ? [...readers, { kind: 'region-resolver', id: 'configured-header', header: legacyHeader }] : readers;
  return all.flatMap(contribution => {
    const accepted = REGION_SLOT.accept({ contribution });
    return typeof accepted === 'string' ? [] : [accepted];
  });
}

/** This site's region readers: the configured ingress plugin's entries (when active), then the legacy
 * header. A plugin fault leaves the site strict; it never fails a page. @complexity O(p) plugins. */
export async function loadSiteRegionResolvers(
  { workspaceId, loadContributions, reportFailure }: { workspaceId: string; loadContributions: LoadConsentContributions; reportFailure: ReportConsentPluginFailure },
  { ingress, legacyHeader }: { ingress?: string; legacyHeader?: string } = {},
): Promise<RegionResolver[]> {
  let entries: RawContribution[] = [];
  if (ingress) {
    try {
      const load = await loadContributions({ workspaceId, definition: regionContribution }, { requireActive: true });
      entries = load.items.flatMap(item => (item.pluginId === ingress ? [item.entry] : []));
    } catch (error) { reportFailure({ message: 'region readers could not be loaded; visitors get the strict banner', error }); }
  }
  return toRegionResolvers({ entries }, { legacyHeader });
}

/** Active plugins may supply a browser consent UI/bridge without becoming trusted region readers.
 * O(active plugin declarations); no browser module executes on the server. A load failure emits no bridge. */
export async function loadSiteConsentBridges(
  { workspaceId, loadContributions, reportFailure }: { workspaceId: string; loadContributions: LoadConsentContributions; reportFailure: ReportConsentPluginFailure },
  _optional = {},
): Promise<RawContribution[]> {
  try {
    const load = await loadContributions({ workspaceId, definition: regionContribution }, { requireActive: true });
    return load.items.flatMap(({ entry }) => {
      const bridge = consentBridgeContribution({ entry });
      return bridge ? [bridge] : [];
    });
  } catch (error) {
    reportFailure({ message: 'browser bridges could not be loaded', error });
    return [];
  }
}


/** Declared assets come from active plugins only. Refusals remain data for readiness/admin diagnostics;
 * a failed load rejects, so the snapshot owner can keep its last good scripts.
 * O(declarations), no module execution or script-body/content reads. */
export async function loadSiteConsentScripts(
  { workspaceId, loadContributions }: { workspaceId: string; loadContributions: LoadConsentContributions },
  _optional = {},
): Promise<{ scripts: DeclaredScript[]; problems: readonly string[] }> {
  const loaded = await loadContributions({ workspaceId, definition: regionContribution }, { requireActive: true });
  return { scripts: loaded.items.flatMap(({ entry }) => entry.kind === 'declared-scripts' ? entry.scripts as DeclaredScript[] : []), problems: loaded.refusals };
}
