/**
 * @file Test harness for the Sheets admin tools: the shared fixture ids, and the per-call
 * capabilities a module receives, for pins that call one module directly.
 *
 * Booting the tools on a host's registrar and approval card is the host's proof, so that half of the
 * harness (and the confirmed vertical slice) stays with the host's overlay tests.
 *
 * The only transport is the fake's `fetch` (127.0.0.1, throws for every non-Google host). The token
 * is minted at runtime and is not secret-shaped.
 */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONNECTION = 'conn-google-1';
export const SPREADSHEET = 'sheet1234567890abcdef';
export const TOKEN = `fake-access-${randomBytes(12).toString('hex')}`;
/** Plugin settings with the Sheets product on (products are off until the panel turns them on). */
export const SHEETS_ON = Object.freeze({ get: async ({ key }) => (key === 'products' ? { sheets: true } : null) });

/**
 * The capabilities one module call receives, straight over the fake (for module-level pins).
 * `withoutArtifacts: true` leaves `artifacts` out, as a host with no artifact store does.
 */
export function directCapabilities({ fake }, optional = {}) {
  const capabilities = {
    connections: { getAccessToken: async () => TOKEN },
    http: { fetch: (target, init) => fake.fetch(target, init) },
    limiter: { check: async () => ({ allowed: true }) },
    artifacts: { write: optional.writeArtifact ?? (async () => { throw new Error('no artifact store in this test'); }) },
    state: optional.state ?? SHEETS_ON,
  };
  if (optional.withoutArtifacts) delete capabilities.artifacts;
  return capabilities;
}
