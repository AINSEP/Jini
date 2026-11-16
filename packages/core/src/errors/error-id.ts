/**
 * @file The one error ID format every incident uses: `ERR-XXXX-XXXX-XXXX-XXXX`.
 *
 * Why one format, and why this one: `formatUserFacingError` recovers exactly this shape from a
 * cause's plain text. A chat consumer that rebuilds `new Error(message)` and an Electron renderer
 * that only receives a rejection's message both lose every typed field, so the ID has to survive as
 * words. Hosts pass this function's result through their `ids` port; the daemon's tool-failure
 * decorator mints its IDs the same way, so a tool failure and a route incident look alike.
 */

/** Options of {@link mintToolErrorId}. None yet; named so one can be added without changing the signature. */
export interface MintErrorIdOptions {}

/**
 * Mints one error ID: 64 bits from the host's random source (`crypto.randomBytes` in a Node host),
 * formatted `ERR-XXXX-XXXX-XXXX-XXXX` in upper-case hex. Randomness is a port, so this stays pure.
 *
 * @param required.randomHex - Returns `bytes` random bytes as hex (16 characters for the 8 asked for).
 * @returns The ID. It has the four-group shape whenever the source returns the 16 characters asked for.
 * @complexity O(1).
 */
export function mintToolErrorId(required: { randomHex: (required: { bytes: number }) => string }, _optional: MintErrorIdOptions = {}): string {
  const hex = required.randomHex({ bytes: 8 }).toUpperCase();
  const groups = hex.match(/.{4}/g) ?? [];
  return `ERR-${groups.join('-')}`;
}
