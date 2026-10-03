import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
import { OAuthError } from './errors.js';
import type { OAuthUrlGuard } from './ports.js';
/** Application policy must check outbound destinations; a paired fetch port must enforce DNS at connection time. */
export interface OAuthUrlGuardOptions {
    readonly assertAllowed: (requiredArgs: {
        readonly url: URL;
        readonly label: string;
    }) => void;
    /** Test/development exception for localhost, the full 127.0.0.0/8 range, ::1 and mapped IPv6 loopback. */
    readonly allowLoopbackHttp?: boolean;
}
/** Adds OAuth's scheme gate and typed errors around the application's URL policy. No DNS I/O is hidden here. */
export function createOAuthUrlGuard(requiredArgs: OAuthRequiredArgs<OAuthUrlGuardOptions>, optionalArgs: OAuthOptionalArgs<OAuthUrlGuardOptions> = {}): OAuthUrlGuard {
    const options = { ...optionalArgs, assertAllowed: requiredArgs.assertAllowed };
    return {
        assertSafeUrl({ raw, label }) {
            const link = label === 'provider-supplied link';
            const subject = link ? label : `${label}: provider endpoint`;
            const reject = (reason: string, action: string): never => {
                throw new OAuthError({
                    code: 'OAUTH_UNSAFE_ENDPOINT', message: `${subject} ${reason}`,
                    operatorAction: action
                });
            };
            let parsed: URL;
            try {
                parsed = new URL(raw.trim());
            }
            catch {
                return reject('is not a valid absolute URL', 'Check the OAuth endpoints configured for this provider.');
            }
            const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
            // URL parsing canonicalizes IPv4 and mapped IPv6; recognize their full loopback range.
            // This only gates plaintext. The required host policy still approves the destination.
            const loopback = host === 'localhost' || host === '::1'
                || /^127\.\d+\.\d+\.\d+$/.test(host) || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host);
            // Discovery, registration and token traffic can carry secrets; plaintext would expose
            // them before any protocol check could help. Local development is an explicit exception.
            if (parsed.protocol !== 'https:' && !(options.allowLoopbackHttp === true && parsed.protocol === 'http:' && loopback)) {
                return reject('must use https (http is permitted only for loopback)', 'Use an https:// URL for this provider.');
            }
            try {
                // Pass a snapshot so a policy cannot change the URL after validating it.
                options.assertAllowed({ url: new URL(parsed.href), label });
            }
            catch (cause) {
                if (cause instanceof OAuthError)
                    throw cause;
                throw new OAuthError({
                    code: 'OAUTH_UNSAFE_ENDPOINT', message: `${subject} was rejected by the outbound URL policy`,
                    operatorAction: 'Check the application outbound URL policy for this provider.'
                }, {
                    cause
                });
            }
            return parsed;
        },
    };
}
/** Internal endpoint gate; exported flows always require an application guard. */
export function assertSafeProviderEndpoint(raw: string, label: string, guard: OAuthUrlGuard): URL {
    return guard.assertSafeUrl({ raw, label });
}
/** Validate provider-supplied device links before showing them to an operator. */
export function assertSafeUserFacingUrl({ raw, guard }: {
    readonly raw: string;
    readonly guard: OAuthUrlGuard;
}): URL {
    const parsed = guard.assertSafeUrl({
        raw: raw,
        label: 'provider-supplied link'
    });
    if (parsed.username !== '' || parsed.password !== '') {
        throw new OAuthError({
            code: 'OAUTH_UNSAFE_ENDPOINT', message: 'provider-supplied link embeds credentials in the URL',
            operatorAction: "This provider's device-authorization response is malformed — do not open the link."
        });
    }
    return parsed;
}
