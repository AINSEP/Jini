import { describe, expect, it } from 'vitest';
import type { AuthServiceDeps } from '../../../server/auth-service.js';
import type { MfaStore } from '../../../server/mfa/ports.js';
import { createSealedMfaSecrets } from '../../../server/mfa/secret-adapter.js';
import { createOtplibTotp } from '../../../server/mfa/totp-adapter.js';
import { composeOwnerMfaDeps, type OwnerMfaSource } from '../mfa-deps.js';

const scope = { workspaceId: 'site', principalId: 'owner' };
const envelope = { keyId: 'fixture-key', alg: 'aes-256-gcm', nonce: 'n', ciphertext: 'c' };
/** `open` may throw before returning a promise (the sealer getter runs synchronously); capture both. */
const later = <T>(fn: () => Promise<T>) => Promise.resolve().then(fn);
const KEY_MISSING = 'The site key is unavailable for owner authenticator verification';

/** A mutable host bag: the source reads it through getters, as the host binding does. */
function fixture() {
  const calls: unknown[] = [];
  const order: string[] = [];
  const key = { keyId: 'fixture-key' };
  const sealer = {
    seal: async (input: unknown) => { calls.push({ op: 'seal', input }); return envelope; },
    open: async (input: unknown, options: unknown) => { calls.push({ op: 'open', input, options }); return 'fixture-secret'; },
  };
  const keyring = { activeKey: async () => { calls.push({ op: 'active-key' }); return key; } };
  const bag: { store: MfaStore | null | undefined; sealer?: typeof sealer; keyring?: typeof keyring } = { store: {} as MfaStore };
  let ready!: () => void;
  const identityReady = new Promise<void>(resolve => { ready = resolve; });
  const source: OwnerMfaSource<typeof envelope> = {
    identityReady,
    get mfaStore() { order.push('store'); return bag.store; },
    ownerPrincipalId: Promise.resolve(scope.principalId),
    get secretSealer() { return bag.sealer; },
    get secretKeyring() { return bag.keyring; },
  };
  const auth = { marker: 'auth' } as unknown as AuthServiceDeps;
  const authServiceDeps = () => { order.push('auth'); return auth; };
  const totp = createOtplibTotp({}, {});
  return { source, bag, calls, order, key, sealer, keyring, auth, authServiceDeps, ready, totp };
}

describe('composeOwnerMfaDeps', () => {
  it('waits for identity bootstrap before reading storage, then binds the injected auth deps and owner', async () => {
    const f = fixture();
    const pending = composeOwnerMfaDeps({ deps: f.source, authServiceDeps: f.authServiceDeps, totp: f.totp, sealedSecrets: createSealedMfaSecrets });
    await Promise.resolve();
    expect(f.order).toEqual([]);
    f.ready();
    const mfa = await pending;
    expect(f.order).toEqual(['store', 'auth']);
    expect(mfa.auth).toBe(f.auth);
    expect(mfa.store).toBe(f.bag.store);
    expect(mfa.seededOwnerPrincipalId).toBe('owner');
    // The injected adapter is the one bound, not a default built here.
    expect(mfa.totp).toBe(f.totp);
  });

  it('refuses without storage before composing anything else', async () => {
    const f = fixture();
    f.bag.store = undefined;
    f.ready();
    await expect(composeOwnerMfaDeps({ deps: f.source, authServiceDeps: f.authServiceDeps, totp: f.totp, sealedSecrets: createSealedMfaSecrets }))
      .rejects.toThrow('Owner authenticator storage is unavailable');
    expect(f.order).toEqual(['store']);
  });

  for (const missing of ['both', 'keyring', 'sealer'] as const) {
    it(`composes crypto lazily and refuses when ${missing} sealing port(s) are missing`, async () => {
      const f = fixture();
      if (missing === 'keyring') f.bag.sealer = f.sealer;
      if (missing === 'sealer') f.bag.keyring = f.keyring;
      f.ready();
      const mfa = await composeOwnerMfaDeps({ deps: f.source, authServiceDeps: f.authServiceDeps, totp: f.totp, sealedSecrets: createSealedMfaSecrets });
      expect(f.calls).toEqual([]);
      await expect(later(() => mfa.secrets.seal({ ...scope, secret: 's' }))).rejects.toThrow(KEY_MISSING);
      await expect(later(() => mfa.secrets.open({ ...scope, sealedSecret: JSON.stringify(envelope) }))).rejects.toThrow(KEY_MISSING);
      expect(f.calls).toEqual([]);
    });
  }

  it('resolves late-bound sealing ports on every use and keeps the owner-scope AAD', async () => {
    const f = fixture();
    f.ready();
    const mfa = await composeOwnerMfaDeps({ deps: f.source, authServiceDeps: f.authServiceDeps, totp: f.totp, sealedSecrets: createSealedMfaSecrets });
    f.bag.sealer = f.sealer;
    f.bag.keyring = f.keyring;
    const sealedSecret = await mfa.secrets.seal({ ...scope, secret: 'fixture-secret' });
    expect(sealedSecret).toBe(JSON.stringify(envelope));
    expect(await mfa.secrets.open({ ...scope, sealedSecret })).toBe('fixture-secret');
    const aad = JSON.stringify(['owner-totp-v1', 'site', 'owner']);
    expect(f.calls).toEqual([
      { op: 'active-key' },
      { op: 'seal', input: { plaintext: 'fixture-secret', key: f.key, aad } },
      { op: 'open', input: { sealed: envelope }, options: { aad } },
    ]);
    delete f.bag.keyring;
    await expect(later(() => mfa.secrets.open({ ...scope, sealedSecret }))).rejects.toThrow(KEY_MISSING);
    expect(f.calls).toHaveLength(3);
  });
});
