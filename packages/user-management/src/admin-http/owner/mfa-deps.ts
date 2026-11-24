/**
 * @file Composes the owner MFA service deps (`OwnerMfaDeps`) from a host's late-bound bag: identity
 * bootstrap, MFA storage, the seeded owner and the host's existing secret sealer/keyring. Shared by
 * the owner sign-in, enrollment, passkey and recovery flows, so every one of them binds the same
 * server-selected owner and the same sealing ports.
 */
import type { AuthServiceDeps } from '../../server/auth-service.js';
import type { MfaStore, OwnerMfaDeps, TotpPort } from '../../server/mfa/ports.js';
// Type-only: the `./server` adapters are node code, so the host injects them (keeps this entry free of them).
import type { createSealedMfaSecrets } from '../../server/mfa/secret-adapter.js';

type SealingKeyring = Parameters<typeof createSealedMfaSecrets>[0]['keyring'];
type SealingSealer<Envelope> = Parameters<typeof createSealedMfaSecrets<Envelope>>[0]['sealer'];

/**
 * What the host exposes. Read as properties at the moment of use (a host may pass getters over its
 * own mutable deps): storage after identity bootstrap, the sealing pair on every seal/open.
 */
export interface OwnerMfaSource<Envelope = unknown> {
  readonly identityReady: PromiseLike<unknown>;
  readonly mfaStore: MfaStore | null | undefined;
  readonly ownerPrincipalId: string | PromiseLike<string>;
  readonly secretSealer: SealingSealer<Envelope> | undefined;
  readonly secretKeyring: SealingKeyring | undefined;
}

/** The host's identity service deps; called once, after storage is known to exist. */
export type OwnerAuthServiceDepsFn = () => AuthServiceDeps;

/** What `composeOwnerMfaDeps` reads: the host bag plus the collaborators it injects. */
export interface ComposeOwnerMfaDepsArgs<Envelope> {
  deps: OwnerMfaSource<Envelope>;
  authServiceDeps: OwnerAuthServiceDepsFn;
  /** A fresh TOTP adapter for this composition (`createOtplibTotp` from `./server`). */
  totp: TotpPort;
  /** The sealing adapter factory (`createSealedMfaSecrets` from `./server`). */
  sealedSecrets: typeof createSealedMfaSecrets;
}

/** Bind server-selected owner and existing sealing ports; never accept scope from a request.
 * Sealing capability is checked on use so launcher sign-in can issue a pending proof without
 * touching a secret. Missing ports refuse verification, never grant an owner session.
 * @complexity O(1) composition, waiting for the existing seed promise; no added polling.
 */
export async function composeOwnerMfaDeps<Envelope>(
  { deps, authServiceDeps, totp, sealedSecrets }: ComposeOwnerMfaDepsArgs<Envelope>,
  _options: Record<string, never> = {},
): Promise<OwnerMfaDeps> {
  await deps.identityReady;
  const store = deps.mfaStore;
  if (!store) throw new Error('Owner authenticator storage is unavailable');
  const sealingPorts = () => {
    const sealer = deps.secretSealer;
    const keyring = deps.secretKeyring;
    // A half-configured pair is never used: both ports come from the same site key.
    if (!sealer || !keyring) throw new Error('The site key is unavailable for owner authenticator verification');
    return { sealer, keyring };
  };
  const secrets = sealedSecrets<Envelope>({
    get sealer() { return sealingPorts().sealer; },
    get keyring() { return sealingPorts().keyring; },
  }, {});
  return { auth: authServiceDeps(), store,
    seededOwnerPrincipalId: await deps.ownerPrincipalId, totp, secrets };
}
