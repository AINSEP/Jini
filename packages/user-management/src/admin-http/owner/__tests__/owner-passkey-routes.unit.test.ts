import { expect, it } from 'vitest';
import { ownerPasskeySite } from '../passkey-routes.js';

it('uses the configured relying-party origin including its port', () => {
  const copy = { unavailable: 'unavailable', insecure: 'insecure' };
  expect(ownerPasskeySite({ deps: { passkeyOrigin: 'https://configured.example:8443', derivedPublicOrigin: 'https://other.example' }, localPort: 4000, name: 'Site', copy })).toEqual({ origin: 'https://configured.example:8443', rpId: 'configured.example', name: 'Site' });
  expect(ownerPasskeySite({ deps: { derivedPublicOrigin: 'http://localhost' }, localPort: 4000, name: 'Site', copy })).toEqual({ origin: 'http://localhost:4000', rpId: 'localhost', name: 'Site' });
});

it('sets no-store before refusals and admits management separately from login', async () => {
  const { ownerPasskeyActionRoute } = await import('../passkey-routes.js');
  for (const action of ['enroll', 'begin-login'] as const) {
    const order: string[] = [];
    const deps = { site: { origin: 'https://configured.example' }, mfa: { seededOwnerPrincipalId: 'owner' } } as Awaited<ReturnType<Parameters<typeof ownerPasskeyActionRoute>[0]['admission']['passkeyDeps']>>;
    const admission: Parameters<typeof ownerPasskeyActionRoute>[0]['admission'] = {
      workspaceId: 'w', passkeyDeps: async () => { order.push('deps'); return deps; },
      authenticate: async () => { order.push('authenticate'); return { kind: 'session', principal: { id: 'owner' } }; },
      ownerPrincipalId: async () => 'owner', isJson: () => true, fetchSite: () => 'same-origin', origin: () => deps.site.origin,
      body: () => ({}), byteCount: () => { order.push('bytes'); return 0; }, rate: async () => { order.push('rate'); return { allowed: true }; },
      noStore: () => { order.push('no-store'); }, retryAfter: () => {}, json: () => { order.push('json'); }, empty: () => {},
      failure: error => { throw error; }, signedIn: async () => {},
      services: {
        beginOwnerPasskeyEnrollment: async () => { order.push('enroll'); return { pendingToken: 'token', options: { challenge: 'challenge' } }; },
        beginOwnerPasskeyLogin: async () => { order.push('begin-login'); return { pendingToken: 'token', options: { challenge: 'challenge' } }; },
        confirmOwnerPasskeyEnrollment: async () => {}, removeOwnerPasskey: async () => {}, completeOwnerPasskeyLogin: async () => { throw new Error('unexpected login'); },
      }, copy: { ownerRequired: 'owner', origin: 'origin', tooLarge: 'large', rate: 'rate' },
    };
    await ownerPasskeyActionRoute({ admission, action });
    expect(order).toEqual(['no-store', 'deps', 'bytes', 'rate', ...(action === 'enroll' ? ['authenticate'] : []), action, 'json']);
    order.length = 0;
    admission.origin = () => 'https://foreign.example';
    await ownerPasskeyActionRoute({ admission, action });
    expect(order).toEqual(['no-store', 'deps', 'json']);
  }
});
