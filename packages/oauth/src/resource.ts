import { OAuthError } from './errors.js';
import type { OAuthResource } from './ports.js';
/** RFC 8707 requires absolute, fragment-free resource URIs and allows repeated resource fields. */
// The resource indicator narrows the token to the protected server the client actually intends to
// call. Preserve it through authorization, code exchange and refresh; providers may require it.
export function applyResourceIndicators(params: URLSearchParams, resource: OAuthResource | undefined): void {
    if (resource === undefined)
        return;
    const resources = typeof resource === 'string' ? [resource] : resource;
    for (const uri of resources) {
        try {
            // A trailing bare # is also a fragment even though URL.hash returns the empty string.
            if (new URL(uri).hash !== '' || uri.includes('#'))
                throw new Error('fragment');
        }
        catch {
            throw new OAuthError({
                code: 'OAUTH_INVALID_REQUEST', message: 'resource indicators must be absolute URIs without fragments',
                operatorAction: 'Supply the absolute protected resource URI for this authorization.'
            });
        }
    }
    params.delete('resource');
    for (const uri of resources)
        params.append('resource', uri);
}
