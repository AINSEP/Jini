/**
 * @file Credential token display contracts. Additive copy of the type declarations in
 * `@jini-ai/platform/secrets/credential-token`; that module keeps its identical declarations, its
 * validation values and its exports until the paired cutover.
 */

export interface CredentialTokenHint { length: number; last4: string | null }

export type CredentialConnection = 'connected' | 'auth' | 'timeout' | 'unreachable' | 'saved';
