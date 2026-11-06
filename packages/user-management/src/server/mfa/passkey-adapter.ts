import { createHash } from 'node:crypto';
import { generateRegistrationOptions, generateAuthenticationOptions, verifyRegistrationResponse, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { PasskeyPort } from './passkey-ports.js';

/** SimpleWebAuthn owns RP/origin/signature/UV and authenticator-counter validation.
 * @complexity O(n) option generation for at most five credentials; bounded verification payloads.
 */
export function createSimpleWebAuthnPasskeys(_required: Record<string, never>, _options: Record<string, never> = {}): PasskeyPort {
  return {
    registration: async ({ site, scope, credentials }) => ({ ...await generateRegistrationOptions({
      rpName: site.name, rpID: site.rpId, userName: 'Owner',
      userID: new Uint8Array(createHash('sha256').update(JSON.stringify([scope.workspaceId, scope.principalId])).digest()),
      attestationType: 'none', excludeCredentials: credentials.map(({ id }) => ({ id })),
      authenticatorSelection: { userVerification: 'required', residentKey: 'discouraged' },
    }) }),
    authentication: async ({ site, credentials }) => ({ ...await generateAuthenticationOptions({
      rpID: site.rpId, userVerification: 'required', allowCredentials: credentials.map(({ id }) => ({ id })),
    }) }),
    register: async ({ site, response, challenge }) => {
      const result = await verifyRegistrationResponse({ response: response as RegistrationResponseJSON,
        expectedChallenge: challenge, expectedOrigin: site.origin, expectedRPID: site.rpId, requireUserVerification: true });
      if (!result.verified || !result.registrationInfo) throw new Error('Passkey registration was not verified');
      const { credential } = result.registrationInfo;
      return { id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter };
    },
    authenticate: async ({ site, response, challenge, credential }) => {
      const result = await verifyAuthenticationResponse({ response: response as AuthenticationResponseJSON,
        expectedChallenge: challenge, expectedOrigin: site.origin, expectedRPID: site.rpId, requireUserVerification: true,
        credential: { id: credential.id, publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')), counter: credential.counter } });
      if (!result.verified) throw new Error('Passkey assertion was not verified');
      return result.authenticationInfo.newCounter;
    },
  };
}
