import type { OAuthEmptyArgs } from './args.js';
import { OAuthError } from './errors.js';

/** Shared internal redirect gate for host transports and upstream customFetch adapters.
 * @param requiredArgs - The response returned by the injected HTTP port.
 * @returns Resolves for a non-redirect response, leaving its body available to the caller.
 * @throws {OAuthError} OAUTH_UNSAFE_ENDPOINT after cancelling a refused redirect's body.
 * @complexity O(1) time and space, excluding transport-owned cancellation.
 */
export async function assertOAuthResponseNotRedirect(
  { response }: { readonly response: Response }, _optionalArgs: OAuthEmptyArgs = {},
): Promise<void> {
  // A redirect destination has not passed the address policy. The explicit response check also
  // catches injected fetch implementations that do not enforce redirect: 'error' themselves.
  if ((response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect') {
    await response.body?.cancel().catch(() => undefined);
    throw new OAuthError({
      code: 'OAUTH_UNSAFE_ENDPOINT', message: 'refusing to follow an OAuth endpoint redirect',
      operatorAction: 'Configure the final HTTPS endpoint directly.',
    });
  }
}
