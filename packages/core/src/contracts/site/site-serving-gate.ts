import type { SiteServeStatus } from './recovery-reconcile-interrupted-migration.js';

export async function siteServingDecision({ path, exactPaths, prefixes, readStatus }: {
  path: string; exactPaths: ReadonlySet<string>; prefixes: readonly string[]; readStatus: () => Promise<SiteServeStatus>;
}, _optional = {}): Promise<'serve' | 'blocked'> {
  if (exactPaths.has(path)) return 'serve';
  if (prefixes.some((prefix) => path.startsWith(prefix))) return 'serve';
  const status = await readStatus();
  return status !== 'BLOCKED_PENDING_RECOVERY' ? 'serve' : 'blocked';
}
