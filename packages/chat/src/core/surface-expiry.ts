/**
 * @module surface-expiry
 *
 * The answer deadline of a pending MCP-UI card (`MCP_UI_EXPIRES_AT_META_KEY` in `@jini-ai/ui`):
 * whether it has passed, and the time left as the card shows it. Pure — the caller supplies "now",
 * so the boundary (just before / at / after the deadline) is tested without a real clock.
 */

/** How often a live countdown re-reads the clock. Matches the label's whole-second resolution. */
export const SURFACE_EXPIRY_TICK_MS = 1_000;

/** A card still answerable, with the time left, or one whose deadline has passed. */
export type SurfaceExpiry = { readonly expired: true } | { readonly expired: false; readonly remainingMs: number; readonly remaining: string };

/**
 * Describes a card's deadline at one instant.
 *
 * Expired AT the deadline, not after it: the server gives up when its timer fires, so a click at
 * that instant would already find nothing waiting.
 *
 * @param input.expiresAtMs - The deadline, epoch milliseconds.
 * @param input.nowMs - The current time, same clock.
 * @complexity O(1).
 */
export function describeSurfaceExpiry({ expiresAtMs, nowMs }: { expiresAtMs: number; nowMs: number }): SurfaceExpiry {
  const remainingMs = expiresAtMs - nowMs;
  if (remainingMs <= 0) return { expired: true };
  return { expired: false, remainingMs, remaining: formatRemainingTime(remainingMs) };
}

/**
 * Formats a positive duration as `m:ss`, or `h:mm:ss` from an hour up.
 *
 * Rounds UP to the whole second, so a card with any time left never reads `0:00` while it can still
 * be answered; it reads `0:01` until the instant it expires.
 *
 * @param remainingMs - Milliseconds left, greater than zero.
 * @complexity O(1).
 */
export function formatRemainingTime(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}
