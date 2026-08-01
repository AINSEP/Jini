/**
 * One place that decides whether an operator-supplied endpoint URL is
 * acceptable, shared by every tab that takes one.
 *
 * ## Why this is a copy rather than an import
 *
 * `@jini-ai/agent-runtime`'s `providers/connection-guard.ts` already implements
 * this policy, and it stays the richer implementation: it adds
 * `validateBaseUrlResolved`, which resolves DNS and re-checks every address the
 * host would actually connect to, catching `internal.example.com -> 10.0.0.5`
 * that no string inspection can. That function needs `node:dns`, and this
 * package ships ZERO dependencies precisely so it can run in a browser bundle
 * — the same reasoning `features/execution/types.ts` gives for mirroring that
 * package's shapes instead of depending on it. Importing it here would pull a
 * Node-only module into every host that renders a settings dialog.
 *
 * So the split is deliberate and layered, not accidental duplication:
 *
 * - **Here (sync, browser-safe):** scheme allow-list plus a literal-hostname
 *   block-list. Runs in render logic, on every keystroke, in any runtime.
 * - **`connection-guard.ts` (async, Node):** the same check plus DNS
 *   resolution, run where a connection is actually attempted.
 *
 * The predicates below are ported from that file's synchronous half verbatim
 * in behavior. **If one side's block-list changes, change the other.** A gap
 * between them is a request the UI accepted and the runtime then refused, or
 * worse, the reverse.
 *
 * That instruction is now enforced rather than merely written down:
 * `__tests__/utils/endpoint-policy.parity.test.ts` runs both implementations
 * over the cross-product of address forms and whitespace padding and fails on
 * any disagreement. It exists because the sentence above was not enough — the
 * two drifted on Unicode whitespace (this side trimmed, the other did not), and
 * a hand-written 46-URL audit corpus rated them identical because it happened
 * not to contain a padded case. A corpus only proves the axis it samples.
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

/** Strips one RFC 1034 trailing dot (`localhost.` resolves as `localhost`) and IPv6 brackets, then lowercases. */
function normalizeHost(hostname: string): string {
  const stripped =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return stripped.toLowerCase().replace(/\.+$/, '');
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const parsed = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : null;
  });
  if (parsed.some((part) => part === null)) return null;
  return parsed as [number, number, number, number];
}

function isLoopbackIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  return Boolean(parts && parts[0] === 127);
}

function isBlockedIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    a >= 224
  );
}

/** `::ffff:10.0.0.1` and `::ffff:a00:1` both denote the same IPv4 address; returns it dotted so the v4 rules apply. */
function ipv4MappedToDotted(hostname: string): string | null {
  const host = normalizeHost(hostname);
  const mapped = /^::ffff:(.+)$/i.exec(host)?.[1];
  if (!mapped) return null;
  if (parseIpv4(mapped.toLowerCase())) return mapped.toLowerCase();
  const hexParts = mapped.split(':');
  if (hexParts.length !== 2 || !hexParts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) {
    return null;
  }
  // Non-null assertions, not a runtime guard: the length/regex checks above
  // already guarantee exactly two non-empty hex segments here.
  const hi = hexParts[0]!;
  const lo = hexParts[1]!;
  const value = (Number.parseInt(hi, 16) << 16) | Number.parseInt(lo, 16);
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

/** True for `localhost`, `::1`, `127.0.0.0/8`, and their IPv4-mapped-IPv6 forms. Allowed — local model servers live here. */
export function isLoopbackEndpointHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host === 'localhost' || host === '::1') return true;
  if (isLoopbackIpv4(host)) return true;
  const mapped = ipv4MappedToDotted(host);
  return Boolean(mapped && isLoopbackIpv4(mapped));
}

/** True for RFC1918/link-local/CGNAT/multicast/unspecified/unique-local-IPv6 literals — private space a credentialed request must not be steered into. */
export function isBlockedEndpointHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host === '::') return true;
  if (isBlockedIpv4(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  const mapped = ipv4MappedToDotted(host);
  return Boolean(mapped && isBlockedIpv4(mapped));
}

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
export function isAllowedEndpointUrl(raw: string): boolean {
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
  if (isLoopbackEndpointHost(hostname)) return true;
  return !isBlockedEndpointHost(hostname);
}
