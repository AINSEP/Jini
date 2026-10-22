/**
 * One place that decides whether an operator-supplied endpoint URL is
 * acceptable, shared by every tab that takes one.
 *
 * ## Why the literal policy uses a browser-safe platform leaf
 *
 * `@jini-ai/platform/net/endpoint-policy` owns hostname normalization and
 * classification for both this UI and the runtime's connection guard. Importing
 * the Node `platform/net` barrel would bring `node:net` into browser settings
 * dialogs, so this entry has no Node effects or dependencies.
 *
 * The split remains deliberate and layered:
 * - Here (sync, browser-safe): scheme allow-list plus the shared literal-host
 *   block-list, run on every keystroke.
 * - `connection-guard.ts` (async, Node): the same hostname policy plus DNS
 *   resolution, re-checking every address the host actually connects to. That
 *   catches `internal.example.com -> 10.0.0.5`, which string inspection cannot.
 *
 * `__tests__/utils/endpoint-policy.parity.test.ts` still checks the URL wrappers
 * across address forms and whitespace padding. They previously drifted on
 * Unicode whitespace (this side trimmed, the other did not), and a hand-written
 * 46-URL audit corpus missed the padded case. A corpus only proves the axis it
 * samples, so URL parsing and trimming remain independently characterized.
 *
 * ## What this is for
 *
 * These fields are BYOK-style base URLs: operator-supplied, persisted, and
 * paired with a real API key that gets sent to whatever they name. Accepting
 * `http://169.254.169.254/` there points a credentialed request at the cloud
 * metadata service; RFC1918 and loopback-disguised forms are the same hazard
 * pointed at internal infrastructure. A scheme check alone does not see any of
 * it.
 *
 * Loopback is allowed on purpose — local model servers (Ollama and friends)
 * are a first-class configuration, not an attack.
 */

import {
  isLoopbackApiHost as isLoopbackEndpointHost,
  isBlockedExternalApiHostname as isBlockedEndpointHost,
} from '@jini-ai/platform/net/endpoint-policy';

// Preserve the UI's published names and object signatures as aliases of the owner.
export { isLoopbackEndpointHost, isBlockedEndpointHost };

/**
 * Whether `raw` is an endpoint this UI will accept: an absolute `http(s)` URL
 * whose literal hostname is not private address space.
 *
 * Blank is NOT valid here; callers decide whether blank is allowed (it is, for
 * fixed-origin gateways that resolve their own endpoint, and for optional
 * fields). A hostname that merely RESOLVES to private space still passes —
 * catching that needs DNS, which is `connection-guard.ts`'s job at connection
 * time. This is the cheap check that runs on every keystroke, not the last
 * line of defense.
 */
export function isAllowedEndpointUrl({ raw }: { raw: string }): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const hostname = parsed.hostname.toLowerCase();
  if (isLoopbackEndpointHost({ hostname })) return true;
  return !isBlockedEndpointHost({ hostname });
}
