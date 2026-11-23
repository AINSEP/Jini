import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * @file A single-use, in-memory, per-launch token that can be exchanged once for a real admin
 * session over loopback.
 *
 * Purpose:
 * Lets a parent process that STARTED this server prove it started it, without anybody having to
 * know a password. The token is minted at boot only when the launcher explicitly asks for one
 * (the host's serve command with its `--emit-boot-token` flag), lives in this process's memory for the life of that launch, is
 * handed to the launcher over the child's own stdout pipe, and is destroyed the moment it is
 * redeemed.
 *
 * How it relates to the project:
 * `cli/commands/serve.ts` mints and emits it; `admin-http/dev-auth.ts`'s
 * `POST /api/admin/v1/auth/boot-session` redeems it. Browser dev uses this same factory with a
 * request-scoped store after local-launch admission (`POST /auth/local-boot-session`), so its
 * internal token never leaves server memory and cannot replace the launcher's process token.
 *
 * **This module knows nothing about who launches the server, and must stay that way.** There is no
 * "am I in Electron" branch here and no host desktop-shell env-var name anywhere in this file or its callers'
 * server-side halves. The contract is only: *hand me a valid single-use loopback token and I will
 * start a session.* Browser dev's admission policy lives outside this store. Whoever redeems is
 * not this store's business, which is what keeps the
 * desktop shell deletable without leaving a server that misses it.
 *
 * Security properties, each one load-bearing:
 *
 * - **Nothing is persisted.** No file, no keystore, no config, no environment variable. A launch
 *   that ends takes its token with it. The token also never travels through the child's
 *   environment: an env block is readable from the process list by anything running as this user,
 *   whereas the stdout pipe is private to the parent that opened it.
 * - **Fail closed when unarmed.** `redeem` on a store that was never minted into returns `false`
 *   for every input, including `""` and `undefined`. There is deliberately no branch anywhere in
 *   which "no token was minted" means "let this through" — a permissive arm here would turn every
 *   launch of the host into an open admin.
 * - **Single use.** The first successful redeem clears the store, so a replay of the same token
 *   fails exactly like a wrong one. A FAILED redeem does not clear it: burning the token on a bad
 *   guess would let any local process disarm the real launcher's one redemption at will, and the
 *   token is 256-bit random, so guessing is not the threat that matters.
 * - **Constant-time comparison.** Both sides are reduced to a fixed-length SHA-256 digest before
 *   `timingSafeEqual`, which requires equal lengths and would otherwise throw on a short input.
 *
 * Architectural role:
 * A factory plus one process-scoped instance. The factory is what the tests drive, so no test has
 * to reach into module state or reset a singleton between cases. The instance exists to keep this
 * state OUT of `RouteDeps`/the composition root: `cli/commands/serve.ts` (the minting call site) and
 * `admin-http/dev-auth.ts`'s route (the redeeming call site) both call this module's own exported
 * functions directly, never through `deps`.
 *
 * An earlier version of this comment claimed the two call sites "have no dependency path between
 * them" — that is false at the module level and is corrected here (2026-09-06, while adding this
 * route's first server-side test, `admin-boot-session-route.test.ts`): `serve.ts` builds the very
 * `RouteDeps` bag it hands to `createApp(deps)`, which is what wires `registerAuthRoutes(app, deps)` —
 * i.e. `serve.ts` already depends on `dev-auth.ts`, transitively through `createApp`, in the very same
 * function that calls {@link mintBootSessionToken}. What is actually true, and is the real reason for
 * this singleton, is narrower: NEITHER call site reads or writes the token through `deps`, so this
 * module (mint and redeem sites included) can be deleted outright without `RouteDeps`'s shape ever
 * having to change — unlike a hypothetical `deps.bootToken` field, which every other `RouteDeps`
 * consumer and test fixture would have had to account for.
 */

/** Bytes of entropy per token. 32 bytes = 256 bits, the same size the identity library uses for a
 *  session's own raw token. */
const TOKEN_BYTES = 32;

export interface BootSessionTokenStore {
  /** Mint and arm a new token, replacing any previous one. Returns the raw token to hand out. */
  mint: () => string;
  /** Exchange a raw token. `true` at most once per {@link mint}; `false` for everything else. */
  redeem: (required: { rawToken: unknown }, optional?: {}) => boolean;
  /** Whether a token is currently armed. Diagnostics only — never an authorization decision. */
  isArmed: () => boolean;
}

/** SHA-256 digest of a raw token. Fixed length, which is what makes `timingSafeEqual` usable. */
function digest({ rawToken }: { rawToken: string }, _options = {}): Buffer {
  return createHash("sha256").update(rawToken, "utf8").digest();
}

/**
 * Build an isolated single-use token store.
 *
 * @returns a {@link BootSessionTokenStore} holding at most one armed token.
 * @complexity O(1) per operation; O(1) space (one 32-byte digest).
 */
export function createBootSessionTokenStore(): BootSessionTokenStore {
  let armed: Buffer | null = null;

  return {
    mint(): string {
      const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
      armed = digest({ rawToken });
      return rawToken;
    },

    redeem({ rawToken }: { rawToken: unknown }, _options = {}): boolean {
      if (armed === null) return false;
      if (typeof rawToken !== "string" || rawToken.length === 0) return false;

      // Compared against a local copy so a concurrent `mint` cannot change what this call is
      // checking halfway through, and so the clear below cannot race a second redeem into
      // succeeding against an already-spent token.
      const expected = armed;
      if (!timingSafeEqual(digest({ rawToken }), expected)) return false;

      armed = null;
      return true;
    },

    isArmed(): boolean {
      return armed !== null;
    },
  };
}

/** The one store this process uses. See this file's header ("Architectural role") for why a
 *  module-scoped instance, not a `RouteDeps`-threaded field, is the right shape: neither the CLI's
 *  mint call nor the route's redeem call ever needs to read this through `deps`. */
const processStore = createBootSessionTokenStore();

/** Mint this launch's boot token. Called at most once, by `cli/commands/serve.ts`. */
export function mintBootSessionToken(): string {
  return processStore.mint();
}

/** Redeem a raw boot token. `false` unless one was minted this launch and this is it, first time. */
export function redeemBootSessionToken({ rawToken }: { rawToken: unknown }, _options = {}): boolean {
  return processStore.redeem({ rawToken });
}

/** Whether this launch minted a boot token. Diagnostics only. */
export function isBootSessionTokenArmed(): boolean {
  return processStore.isArmed();
}
