import type { PasskeySettingsPort, PasskeySignInPort } from '@jini-ai/core/contracts/site/user-management-react';
import type { OwnerRequestOnce } from './owner-request.js';

/** Explicit ceremonies are single-send requests; lost responses never trigger proof replay.
 * The host injects its single-send `requestOnce` and builds both ports once. @complexity O(1). */
export function createOwnerPasskeyPorts({ requestOnce }: { requestOnce: OwnerRequestOnce }, _optional: Record<string, never> = {}): {
  settings: PasskeySettingsPort; signIn: PasskeySignInPort;
} {
  const post = <T,>({ action, input }: { action: string; input: unknown }, _options = {}): Promise<T> => requestOnce<T>({
    path: `/auth/passkeys/${action}`, init: { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input), cache: 'no-store' },
  });
  const settings: PasskeySettingsPort = {
    status: () => requestOnce({ path: '/auth/passkeys', init: { cache: 'no-store' } }),
    enroll: input => post({ action: 'enroll', input }), confirm: input => post({ action: 'confirm', input }), remove: input => post({ action: 'remove', input }),
  };
  const signIn: PasskeySignInPort = {
    begin: input => post({ action: 'begin-login', input }), complete: async input => { await post({ action: 'login', input }); },
  };
  return { settings, signIn };
}
