import type { MfaScope, OwnerMfaDeps } from './ports.js';

export type PasskeyCredential = MfaScope & {
  id: string; publicKey: string; counter: number; rpId: string;
};
/** Methods join the same serialized identity transaction as MFA/session writes. */
export interface PasskeyStore {
  list(scope: MfaScope): Promise<PasskeyCredential[]>;
  save(credential: PasskeyCredential): Promise<void>;
  remove(input: MfaScope & { id: string }): Promise<void>;
  clear(scope: MfaScope): Promise<void>;
}
export type PasskeySite = { origin: string; rpId: string; name: string };
export type PasskeyOptions = { challenge: string; [key: string]: unknown };
/** Protocol verification belongs to a maintained WebAuthn implementation, never the service. */
export interface PasskeyPort {
  registration(input: { site: PasskeySite; scope: MfaScope; credentials: PasskeyCredential[] }): Promise<PasskeyOptions>;
  authentication(input: { site: PasskeySite; credentials: PasskeyCredential[] }): Promise<PasskeyOptions>;
  register(input: { site: PasskeySite; response: unknown; challenge: string }): Promise<{ id: string; publicKey: string; counter: number }>;
  authenticate(input: { site: PasskeySite; response: unknown; challenge: string; credential: PasskeyCredential }): Promise<number>;
}
export type OwnerPasskeyDeps = { mfa: OwnerMfaDeps; credentials: PasskeyStore; webauthn: PasskeyPort; site: PasskeySite };
