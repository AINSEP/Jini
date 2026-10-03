import { OAuthError } from './errors.js';
import type { OAuthAppOptions } from './ports.js';
/** Fail before effects when an application has not supplied its client identity. */
export function assertOAuthAppOptions(options: OAuthAppOptions): void {
    for (const key of ['clientDisplayName', 'softwareId'] as const) {
        if (typeof options?.[key] !== 'string' || options[key].trim() === '') {
            throw invalidOption(key);
        }
    }
    if (!Array.isArray(options.redirectUris))
        throw invalidOption('redirectUris');
    for (const uri of options.redirectUris) {
        try {
            if (typeof uri !== 'string' || new URL(uri).hash !== '')
                throw invalidOption('redirectUris');
        }
        catch {
            throw invalidOption('redirectUris');
        }
    }
}
function invalidOption(key: string): OAuthError {
    return new OAuthError({
        code: 'OAUTH_INVALID_REQUEST', message: `OAuth client option '${key}' is required and must be valid`,
        operatorAction: 'Supply the application identity and registered callback URLs explicitly.'
    });
}
