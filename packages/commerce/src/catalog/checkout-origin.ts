/** @file Checkout-origin policy, moved from the host composition root. */
import { normalizedCommerceOrigin } from './plugin-server.js';
import { isDeployedApiHostname } from '@jini-ai/core/net';

/** A configured deployed origin uses the generic HTTPS shape and shared literal-address policy.
 * DNS reachability belongs to deployment setup; no request Host or forwarded header selects it.
 * @complexity O(origin length), no DNS or HTTP I/O. */
export function commerceCheckoutOrigin({ publicOrigin }: { publicOrigin: string }, _optional = {}): string | null {
  const origin = normalizedCommerceOrigin({ publicOrigin });
  if (!origin) return null;
  return isDeployedApiHostname({ hostname: new URL(origin).hostname }) ? origin : null;
}
