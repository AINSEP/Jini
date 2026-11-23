import { randomBytes } from "node:crypto";
import type { RuntimeMode } from "@jini-ai/core/contracts/site/core-runtime-mode";

/**
 * @file The salt `POST /api/site/comments` folds into `authorIpHash` (2026-10-08 hardwiring audit
 * #4). Resolved ONCE by the composition root and injected into the route, which never reads env.
 *
 * Why not the old public constant: the route used to fall back to `"dev-only-insecure-salt"`
 * whenever `COMMENTS_IP_SALT` was unset, and nothing (boot gate, deploy config) ever asked for that
 * var. Every such install salted with the same string printed in this repo, so anyone holding a
 * copied `content.db` could reverse every commenter's IP hash with a single IPv4-space dictionary.
 *
 * Why derive from the site key instead of minting and persisting a new random salt: the site key
 * IS this install's existing, durable, per-install secret store — production refuses to boot
 * without it (`boot-readiness-gate.ts`, missing-site-key) and it already lives outside the portable
 * `content.db`. An HKDF derivation under its own `purpose` is one-way and domain-separated from
 * every other use of that key (`KeyringPort.derive()`'s contract), needs no new file, no new
 * migration, and is stable across restarts and redeploys. A copied `content.db` alone stays
 * unreversible. The only coupling: rotating the site key changes the salt, so hashes recorded
 * before the rotation stop matching new ones — set `COMMENTS_IP_SALT` to decouple them.
 *
 * Order: an explicit `COMMENTS_IP_SALT` wins; else the site-key derivation; else (no usable site
 * key) a local/dev server keeps the old dev constant, while a production server gets a random
 * per-process salt and a warning — never a public constant. That last branch is unreachable
 * through the real boot paths (the production gate refuses first) and exists as a fail-safe.
 */

/** The env var an operator sets to pin the comments IP-hash salt explicitly. */
export const COMMENTS_IP_SALT_ENV_VAR = "COMMENTS_IP_SALT";

/** The public development salt. Only ever used by a non-production server with no site key. */
export const DEV_COMMENTS_IP_SALT = "dev-only-insecure-salt";

/** `KeyringPort.derive()` domain label for this salt. Changing it changes every install's salt. */
export const COMMENTS_IP_SALT_PURPOSE = "comments-ip-hash-salt";

/** The single `KeyringPort` capability this resolver needs (structurally `KeyringPort["derive"]`). */
export interface CommentsIpSaltKeyring {
  derive(input: { workspaceId: string; purpose: string; info: string }): Promise<Uint8Array>;
}

export type CommentsIpHashSaltSource = "env" | "site-key" | "dev-default" | "ephemeral";

/**
 * Resolves the comments IP-hash salt for one serving process.
 *
 * @param required.env the composition root's environment (`process.env` there).
 * @param required.mode the resolved runtime mode.
 * @param required.workspaceId scopes the site-key derivation.
 * @param required.keyring the site-key-backed keyring the root already built.
 * @param required.warn the host's sink for the production fail-safe warning (this module never logs).
 * @param optional.randomHex entropy for the production fail-safe (default: 32 random bytes).
 * @returns the salt and where it came from (never logged by this module).
 * @throws never: a keyring failure falls through to the mode-appropriate fallback.
 * @complexity O(1) plus one HKDF derivation.
 */
export async function resolveCommentsIpHashSalt(
  required: { env: Readonly<Record<string, string | undefined>>; mode: RuntimeMode; workspaceId: string; keyring: CommentsIpSaltKeyring; warn: (line: string) => void },
  optional: { randomHex?: () => string } = {}
): Promise<{ salt: string; source: CommentsIpHashSaltSource }> {
  const configured = required.env[COMMENTS_IP_SALT_ENV_VAR];
  if (configured !== undefined && configured.trim() !== "") return { salt: configured, source: "env" };

  try {
    const derived = await required.keyring.derive({ workspaceId: required.workspaceId, purpose: COMMENTS_IP_SALT_PURPOSE, info: "v1" });
    return { salt: Buffer.from(derived).toString("hex"), source: "site-key" };
  } catch {
    // No usable site key. Local/dev keeps its old constant; production never gets a public one.
  }

  if (required.mode !== "production") return { salt: DEV_COMMENTS_IP_SALT, source: "dev-default" };
  required.warn(`[comments] ${COMMENTS_IP_SALT_ENV_VAR} is unset and no site key resolved: using a random per-process salt, so comment IP hashes will not match across restarts. Set ${COMMENTS_IP_SALT_ENV_VAR}.`);
  return { salt: (optional.randomHex ?? (() => randomBytes(32).toString("hex")))(), source: "ephemeral" };
}
