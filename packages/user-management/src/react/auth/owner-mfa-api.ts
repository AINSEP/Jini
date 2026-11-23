import type { TotpSettingsPort } from '@jini-ai/core/contracts/site/user-management-react';
import type { OwnerRequestOnce } from './owner-request.js';

/** Thin site transport: single-send writes never replay a proof after a lost response.
 * The host injects its single-send `requestOnce` and builds one port for the page.
 * @complexity O(1), one request per explicit action; status loads once, no poll.
 */
export function createOwnerMfaPort({ requestOnce }: { requestOnce: OwnerRequestOnce }, _optional: Record<string, never> = {}): TotpSettingsPort {
  const post = <T,>({ action, input }: { action: string; input: unknown }, _options = {}): Promise<T> => requestOnce<T>({
    path: `/auth/mfa/${action}`, init: { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input), cache: 'no-store' },
  });
  return {
    status: () => requestOnce({ path: '/auth/mfa', init: { cache: 'no-store' } }),
    enroll: input => post({ action: 'enroll', input }),
    confirm: input => post({ action: 'confirm', input }),
    remove: input => post({ action: 'remove', input }),
  };
}
