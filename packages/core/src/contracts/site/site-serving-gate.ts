import type { SiteServeStatus } from './recovery-reconcile-interrupted-migration.js';

export async function siteServingDecision({ path, exactPaths, prefixes, readStatus }: {
  path: string; exactPaths: ReadonlySet<string>; prefixes: readonly string[]; readStatus: () => Promise<SiteServeStatus>;
}, _optional = {}): Promise<'serve' | 'blocked'> {
  if (exactPaths.has(path)) return 'serve';
  if (prefixes.some((prefix) => path.startsWith(prefix))) return 'serve';
  const status = await readStatus();
  return status !== 'BLOCKED_PENDING_RECOVERY' ? 'serve' : 'blocked';
}

export async function dispatchSiteServingGate(required: Parameters<typeof siteServingDecision>[0] & {
  serve: () => void; blocked: () => void; failure: (error: unknown) => void;
}, _optional = {}): Promise<void> {
  try {
    const decision = await siteServingDecision(required);
    if (decision === 'serve') {
      required.serve();
      return;
    }

    required.blocked();
  } catch (error) {
    required.failure(error);
  }
}
