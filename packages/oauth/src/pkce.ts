/** S256 PKCE generation and validation (RFC 7636). Entropy is supplied by the application. */
import { createHash } from 'node:crypto';
import { OAuthError } from "./errors.js";
import type { OAuthRandomBytes } from "./ports.js";
const VERIFIER_BYTES = 32;
const MIN_VERIFIER_LENGTH = 43;
const MAX_VERIFIER_LENGTH = 128;
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]+$/;
export interface PkcePair {
    readonly codeVerifier: string;
    readonly codeChallenge: string;
    readonly codeChallengeMethod: "S256";
}
export function assertValidCodeVerifier({ codeVerifier }: {
    readonly codeVerifier: string;
}): void {
    if (codeVerifier.length < MIN_VERIFIER_LENGTH || codeVerifier.length > MAX_VERIFIER_LENGTH) {
        throw new OAuthError({
            code: "OAUTH_INVALID_REQUEST", message: `PKCE code verifier must be ${MIN_VERIFIER_LENGTH}–${MAX_VERIFIER_LENGTH} characters (RFC 7636 §4.1)`,
            operatorAction: "Start the connection again — the stored authorization request is unusable."
        });
    }
    if (!VERIFIER_PATTERN.test(codeVerifier)) {
        throw new OAuthError({
            code: "OAUTH_INVALID_REQUEST", message: "PKCE code verifier contains characters outside RFC 7636's unreserved set",
            operatorAction: "Start the connection again — the stored authorization request is unusable."
        });
    }
}
export function deriveCodeChallenge({ codeVerifier }: {
    readonly codeVerifier: string;
}): string {
    assertValidCodeVerifier({
        codeVerifier: codeVerifier
    });
    return createHash('sha256').update(codeVerifier).digest('base64url');
}
export function createPkcePair({ randomBytesFn }: {
    readonly randomBytesFn: OAuthRandomBytes;
}, { verifierBytes = VERIFIER_BYTES }: { readonly verifierBytes?: number } = {}): PkcePair {
    // 64 random bytes encode to 86 unpadded base64url characters, within RFC 7636
    // section 4.1's 43–128 range; the main API retains its 32-byte default.
    const codeVerifier = Buffer.from(randomBytesFn({ byteLength: verifierBytes })).toString('base64url');
    return { codeVerifier, codeChallenge: deriveCodeChallenge({
            codeVerifier: codeVerifier
        }), codeChallengeMethod: "S256" };
}

/** State is the CSRF token binding one browser callback to one authorization attempt.
 * Generate fresh cryptographic entropy per flow rather than reuse a server or session ID. */
export function generateOAuthState({ randomBytesFn }: { readonly randomBytesFn: OAuthRandomBytes }, { stateBytes = 32 }: { readonly stateBytes?: number } = {}): string {
    return Buffer.from(randomBytesFn({ byteLength: stateBytes })).toString('base64url');
}
