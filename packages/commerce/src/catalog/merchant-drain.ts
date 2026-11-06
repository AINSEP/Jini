import type { PaymentsLedger } from '../payments/ledger/repo.js';
import type { PaymentMode } from '../payments/contract/scope.js';
/** Public merchant selection; credentials remain in the host's sealed settings. */
export interface CommerceConfiguration { providerId: string; accountId: string; mode: PaymentMode; publicOrigin: string }
export interface RecordedCommerce {
  provider_id: string; provider_account_id: string; mode: 'test' | 'live'; dispatch_json: string | null;
}
export function commerceConfigurationKey({ config }: { config: CommerceConfiguration | null }, _optional = {}): string { return JSON.stringify(config); }

/** Read one durable unfinished intent, only at activation/configuration transitions.
 * @complexity At most one result row and one original intent snapshot; no provider I/O. */
export async function readCommerceDrain({ ledger, workspaceId }: { ledger: PaymentsLedger; workspaceId: string }, optional: { configured?: CommerceConfiguration | null } = {}): Promise<RecordedCommerce | null> {
  return ledger.transaction({ fn: async tx => {
    let payment = await tx.findOpenPayment({ workspaceId }, { excludeRequiresAction: true });
    if (!payment) {
      const configured = optional.configured;
      const candidate = await tx.findOpenPayment({ workspaceId });
      // One endpoint cannot distinguish two accounts in the same provider/mode.
      // Old sessions can still be paid after a mode change; their merchant credentials must remain available.
      if (!configured || (candidate && (candidate.providerId !== configured.providerId || candidate.providerAccountId !== configured.accountId))) payment = candidate;
    }
    if (!payment) return null;
    const attempt = await tx.findAttemptByOperationKey({ workspaceId, mode: payment.mode, operationKey: `intent:${payment.idempotencyKey}` });
    return { provider_id: payment.providerId, provider_account_id: payment.providerAccountId, mode: payment.mode, dispatch_json: attempt?.dispatchJson ?? null };
  } });
}

function recordedOrigin(record: RecordedCommerce): string | null {
  try {
    const snapshot = JSON.parse(record.dispatch_json ?? 'null') as { returnUrl?: string } | null;
    return snapshot?.returnUrl ? new URL(snapshot.returnUrl).origin : null;
  } catch { return null; }
}

/** Configuration writes never redirect existing work to a newly selected merchant account.
 * @complexity O(snapshot bytes) parsing; only credential-free original URLs are consulted. */
export function selectCommerceDrain({ configured, previous, recorded }: {
  configured: CommerceConfiguration | null; previous: CommerceConfiguration | null; recorded: RecordedCommerce | null;
}, _optional = {}): { config: CommerceConfiguration | null; problem: string | null } {
  if (!recorded) return { config: configured ?? previous, problem: configured ? null : 'Commerce configuration is missing. Restore the configured payment account and deployed HTTPS origin before accepting checkout.' };
  const publicOrigin = drainOrigin({ recorded, previous, configured });
  if (!publicOrigin) return { config: null, problem: 'Existing payment work has no recoverable site origin. Restore the original payment configuration to resume settlement.' };
  const original: CommerceConfiguration = { providerId: recorded.provider_id, accountId: recorded.provider_account_id, mode: recorded.mode, publicOrigin };
  const matches = merchantMatches(configured, original);
  return { config: matches ? configured : original, problem: matches ? null : 'Existing payments are draining under their original account, mode and site. Restore that configuration or wait for settlement before changing checkout settings.' };
}

function normalizedOrigin(value: string): string | null { try { return new URL(value).origin; } catch { return null; } }

function drainOrigin({ recorded, previous, configured }: { recorded: RecordedCommerce; previous: CommerceConfiguration | null; configured: CommerceConfiguration | null }): string | undefined {
  return recordedOrigin(recorded) ?? previous?.publicOrigin ?? configured?.publicOrigin;
}
function merchantMatches(configured: CommerceConfiguration | null, original: CommerceConfiguration): boolean {
  if (!configured) return false;
  const sameScope = configured.providerId === original.providerId && configured.accountId === original.accountId && configured.mode === original.mode;
  return sameScope && normalizedOrigin(configured.publicOrigin) === normalizedOrigin(original.publicOrigin);
}
