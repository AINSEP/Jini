/**
 * @module sealed-state-codec
 *
 * The site-key codec for a sealed authorization state: the host's authenticated sealer encrypts the
 * state under a context AAD, and the sealed envelope travels as base64url JSON. No crypto lives here.
 */
import type { AuthorizationStateCodec } from '@jini-ai/core/contracts/oauth';
import type { KeyringPort, SecretSealerPort } from '@jini-ai/core/contracts/vault';
import { invalidState } from './pending-authorizations.js';

/** What the codec needs: the host's sealer, its keyring, and the AAD this state is bound to. */
export interface SealerStateCodecPorts {
    readonly sealer: Pick<SecretSealerPort, 'seal' | 'open'>;
    readonly keyring: Pick<KeyringPort, 'activeKey'>;
    /** Context AAD; a state sealed under one AAD never opens under another. */
    readonly aad: string;
}

/** Seals with the keyring's active key; opens only the canonical base64url spelling of a sealed envelope.
 * @example createSealedAuthorizationState({ clock, workspaceId, serverId, codec: createSealerStateCodec({ sealer, keyring, aad }) })
 * @throws {OAuthError} `OAUTH_INVALID_STATE` from `open` for a non-canonical state; sealer errors propagate.
 * @complexity O(state bytes) per seal/open.
 */
export function createSealerStateCodec({ sealer, keyring, aad }: SealerStateCodecPorts, _optional = {}): AuthorizationStateCodec {
    return {
        async seal({ plaintext }) {
            const sealed = await sealer.seal({ plaintext, key: await keyring.activeKey({}), aad });
            return Buffer.from(JSON.stringify(sealed), 'utf8').toString('base64url');
        },
        async open({ state }) {
            const bytes = Buffer.from(state, 'base64url');
            // Node's permissive decoder otherwise accepts appended garbage or alternate encodings.
            if (bytes.toString('base64url') !== state) throw invalidState({});
            return sealer.open({ sealed: JSON.parse(bytes.toString('utf8')) }, { aad });
        },
    };
}
