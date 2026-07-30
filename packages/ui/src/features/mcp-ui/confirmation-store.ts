/**
 * @module features/mcp-ui/confirmation-store
 *
 * A short-lived, single-use, binding-checked token store — the server half of the MCP-UI two-step
 * confirmation pattern. Generalized from Tovu's `src/assistant/pending-confirmations.ts`, which was
 * already domain-agnostic in intent but hardcoded one binding shape (tool/workspace/principal/
 * entity/entityVersion); here the binding is whatever record the caller mints with.
 *
 * ## Why a token rather than a boolean "requires confirmation" flag
 *
 * A flag makes the *agent* the thing that confirms. This makes the *human* the thing that confirms,
 * because of where the secret lives: a destructive tool's first call mints a token, embeds it only
 * inside the UI resource's HTML, and returns without acting. Per MCP Apps' security model a host
 * renders that HTML for the user and does not feed it to the model — so the model sees "a dialog is
 * open", the rendered dialog holds the only copy of the token, and the second call is unreachable
 * without a human clicking. If the token ever appears in the tool result's text block, in `_meta`,
 * or in an error message, the whole arrangement collapses into theater; keeping it out of those
 * places is the caller's obligation, and one this module cannot enforce for it.
 *
 * ## Deliberate divergence from Tovu's version: no hashing at rest, by default
 *
 * Tovu stores `sha256(token)` so a heap dump yields nothing redeemable. That is defense in depth on
 * top of the real properties (random, single-use, TTL-bounded, binding-checked), and it costs a
 * `node:crypto` import — which this package, a browser-runtime package, cannot take. The two
 * isomorphic alternatives are both worse than the trade made here: `crypto.subtle.digest` is async
 * (it would make `mint`/`redeem` return promises for a defense-in-depth property) *and* absent
 * outside secure contexts, and a non-cryptographic hash would add collisions while implying a
 * strength it does not have. So the default keys entries by the raw token, and {@link
 * ConfirmationStoreDeps.digestToken} is the one-line seam a Node consumer uses to restore hashing:
 * `digestToken: (token) => createHash('sha256').update(token, 'utf8').digest('hex')`.
 */

/** Default lifetime: long enough for a human to read a dialog, short enough that an abandoned one cannot be redeemed later out of scrollback. */
export const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

/** 256 bits — the same sizing as a session token, since a guessable confirmation token is a bypass. */
const TOKEN_BYTES = 32;

/**
 * What a token is bound to. Every entry is compared on redemption, and any difference — a changed
 * value, a missing key, an extra key — is a rejection rather than a warning.
 *
 * Values are `string | number` rather than `unknown` on purpose: a binding is an identity claim, and
 * comparing arbitrary values would need a deep-equality contract this module has no business
 * defining. A caller with structured binding data should serialize it into a string itself, so it
 * owns the serialization rather than inheriting a surprising one.
 */
export type ConfirmationBinding = Readonly<Record<string, string | number>>;

/** A minted, not-yet-redeemed confirmation. */
export interface PendingConfirmation {
  readonly binding: ConfirmationBinding;
  /** Human-readable description of what was agreed to, echoed back on redemption for the audit trail. */
  readonly summary: string;
  readonly expiresAtMs: number;
}

/**
 * Why a redemption failed.
 *
 * Deliberately coarse. "No such token" and "expired token" share one reason because distinguishing
 * them tells a caller holding a guessed token that it was once real. There is no `already-used`
 * reason for the same kind of reason: a redeemed token is deleted, so a replay is indistinguishable
 * from a guess, which is the intended behavior rather than a missing case.
 */
export type ConfirmationRejectionReason = 'unknown-or-expired' | 'binding-mismatch';

export type RedeemResult =
  | { readonly ok: true; readonly confirmation: PendingConfirmation }
  | { readonly ok: false; readonly reason: ConfirmationRejectionReason };

export interface ConfirmationStore {
  /**
   * Mints a token for one pending action.
   *
   * @returns The RAW token and its expiry. The token's only safe destination is inside the UI
   * resource's HTML — see this module's header.
   */
  mint(spec: { binding: ConfirmationBinding; summary: string }): {
    readonly token: string;
    readonly expiresAtMs: number;
  };
  /** Redeems a token exactly once, against the binding the caller expects it to carry. */
  redeem(spec: { token: string; binding: ConfirmationBinding }): RedeemResult;
  /** Pending, unexpired count — for tests and diagnostics only. */
  size(): number;
}

export interface ConfirmationStoreDeps {
  /** Millisecond clock, injected so TTL expiry is testable without waiting. */
  now?: () => number;
  /** Token source, injected so a test can assert a known value. Defaults to 256 bits of `crypto.getRandomValues`, never `Math.random`. */
  randomToken?: () => string;
  /** Lifetime of a minted token. Defaults to {@link DEFAULT_CONFIRMATION_TTL_MS}. */
  ttlMs?: number;
  /** Maps a raw token to the key it is stored under. Defaults to identity — see this module's header for why, and what to pass to get hashing at rest. */
  digestToken?: (token: string) => string;
}

/**
 * Compares two strings without leaking their contents through timing.
 *
 * Length is compared first and therefore does leak, exactly as `node:crypto`'s own
 * `timingSafeEqual` leaks it (by throwing on a length mismatch). That is acceptable here: binding
 * values are ids the caller already knows the shape of, and the secret — the token — is not
 * compared with this at all, it is a map key.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function bindingsMatch(minted: ConfirmationBinding, presented: ConfirmationBinding): boolean {
  const mintedKeys = Object.keys(minted);
  if (mintedKeys.length !== Object.keys(presented).length) return false;
  let matched = true;
  for (const key of mintedKeys) {
    if (!Object.prototype.hasOwnProperty.call(presented, key)) {
      matched = false;
      continue;
    }
    const left = minted[key];
    const right = presented[key];
    // Compared as strings so a `1` presented where `1` was minted still matches, while `'1'` vs `1`
    // does not — the type check below is what keeps those apart, and it is exact on purpose: a
    // binding that silently coerces is a binding that can be satisfied by a value the minter never
    // agreed to.
    if (typeof left !== typeof right) {
      matched = false;
      continue;
    }
    if (!constantTimeEquals(String(left), String(right))) matched = false;
  }
  return matched;
}

function defaultRandomToken(): string {
  const source = globalThis.crypto;
  if (typeof source?.getRandomValues !== 'function') {
    // No `Math.random` fallback. A predictable confirmation token is a confirmation bypass, and a
    // store that silently degrades to one is worse than a store that refuses to start — every
    // browser and every supported Node exposes `getRandomValues` (it needs no secure context,
    // unlike `crypto.subtle`), so reaching this means something is deeply wrong with the host.
    throw new Error('createConfirmationStore requires crypto.getRandomValues; pass deps.randomToken to override.');
  }
  const bytes = source.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Creates an in-process confirmation store.
 *
 * In-process is correct rather than a shortcut: a confirmation that does not survive a process
 * restart is a confirmation the human is simply asked for again — the fail-closed direction —
 * whereas persisting them would build a durable store of pre-authorized destructive actions.
 *
 * @param deps - See {@link ConfirmationStoreDeps}.
 * @complexity O(1) amortized per operation; expired entries are swept lazily on `mint`/`size`.
 */
export function createConfirmationStore(deps: ConfirmationStoreDeps = {}): ConfirmationStore {
  const now = deps.now ?? (() => Date.now());
  const randomToken = deps.randomToken ?? defaultRandomToken;
  const ttlMs = deps.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
  const digestToken = deps.digestToken ?? ((token: string) => token);

  const pending = new Map<string, PendingConfirmation>();

  function sweep(nowMs: number): void {
    for (const [key, entry] of pending) {
      if (entry.expiresAtMs <= nowMs) pending.delete(key);
    }
  }

  return {
    mint(spec) {
      const nowMs = now();
      sweep(nowMs);
      const token = randomToken();
      const expiresAtMs = nowMs + ttlMs;
      pending.set(digestToken(token), {
        binding: { ...spec.binding },
        summary: spec.summary,
        expiresAtMs,
      });
      return { token, expiresAtMs };
    },

    redeem(spec) {
      const nowMs = now();
      const key = digestToken(spec.token);
      const entry = pending.get(key);
      if (!entry) return { ok: false, reason: 'unknown-or-expired' };

      // Deleted before any binding check, so a held token cannot be probed repeatedly against
      // different bindings to learn what it was minted for.
      pending.delete(key);

      if (entry.expiresAtMs <= nowMs) return { ok: false, reason: 'unknown-or-expired' };
      if (!bindingsMatch(entry.binding, spec.binding)) return { ok: false, reason: 'binding-mismatch' };
      return { ok: true, confirmation: entry };
    },

    size() {
      sweep(now());
      return pending.size;
    },
  };
}
