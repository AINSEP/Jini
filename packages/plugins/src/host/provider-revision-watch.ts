import type { PluginProviderApplyResult } from './provider-host.js';

/** A provider-config row from a store that records when the key was attached. */
export interface ProviderRevisionRow { readonly id: string; readonly revision: number; readonly attached_at: string }
/** A provider-config row from a store without attachment times. */
export interface SiteProviderRevisionRow { readonly id: string; readonly revision: number }

export interface WatchProviderRevisionsRequired {
  read: () => Promise<readonly ProviderRevisionRow[]>;
  /** The plugin a key id belongs to, or `undefined` for keys that are not provider config. Host-owned key format. */
  pluginIdOf: (required: { keyId: string }) => string | undefined;
  reapply: (required: { pluginId: string }) => Promise<PluginProviderApplyResult>;
}

export interface WatchProviderRevisionsOptional {
  readSite?: () => Promise<readonly SiteProviderRevisionRow[]>;
  schedule?: (required: { run: () => Promise<void>; intervalMs: number }) => () => void;
}

const POLL_INTERVAL_MS = 30_000;

/** Keep site and project revisions distinct even when both stores contain the same provider id. */
function revisionSnapshot({ project, site, pluginIdOf }: {
  project: readonly ProviderRevisionRow[];
  site: readonly SiteProviderRevisionRow[];
  pluginIdOf: WatchProviderRevisionsRequired['pluginIdOf'];
}): Map<string, string> {
  const entries = new Map<string, string[]>();
  for (const [scope, rows] of [['project', project], ['site', site]] as const) for (const row of rows) {
    const pluginId = pluginIdOf({ keyId: row.id });
    if (!pluginId) continue;
    const revisions = entries.get(pluginId) ?? [];
    revisions.push(`${scope}:${row.revision}:${'attached_at' in row ? row.attached_at : ''}`);
    entries.set(pluginId, revisions);
  }
  return new Map([...entries].map(([id, values]) => [id, JSON.stringify(values.sort())]));
}

function intervalSchedule({ run, intervalMs }: { run: () => Promise<void>; intervalMs: number }): () => void {
  const timer = setInterval(() => void run(), intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}

/**
 * One metadata query per store every 30 seconds; both processes observe saved revisions and detachments.
 * Reapplies each plugin whose revision set changed (including appearing or disappearing).
 * @returns Stop function: no reapply runs after it.
 */
export function watchProviderRevisions(
  { read, pluginIdOf, reapply }: WatchProviderRevisionsRequired,
  { readSite = async () => [], schedule = intervalSchedule }: WatchProviderRevisionsOptional = {},
): () => void {
  let previous = new Map<string, string>();
  let running = false;
  let closed = false;
  async function check(): Promise<void> {
    if (running || closed) return;
    running = true;
    try {
      const [project, site] = await Promise.all([read(), readSite()]);
      const next = revisionSnapshot({ project, site, pluginIdOf });
      for (const pluginId of new Set([...previous.keys(), ...next.keys()])) {
        if (!closed && previous.get(pluginId) !== next.get(pluginId)) await reapply({ pluginId });
      }
      previous = next;
    } catch { /* A transient store read must not terminate the site's polling loop. */ }
    finally { running = false; }
  }
  void check();
  const cancel = schedule({ run: check, intervalMs: POLL_INTERVAL_MS });
  return () => { closed = true; cancel(); };
}
