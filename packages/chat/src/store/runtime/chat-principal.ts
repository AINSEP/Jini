import { createHash } from "node:crypto";

import type { ChatHistoryStore } from "../ports.js";

/**
 * @file Who a chat history belongs to — the principal a host hands its owner-scoped store factory,
 * and the two owner-derived values every host binding needs: the hashed guest owner id and the
 * per-principal retention deadline.
 *
 * Guest sessions are keyed by a hash of their cookie, never the cookie itself — see
 * {@link hashSessionKey}. The host binds a principal onto a store scope (`scopeId` = workspace,
 * `ownerKind` = principal kind, `ownerId` = user id or hashed session key).
 */

/** How long a visitor's chat history survives without activity. */
export const GUEST_CHAT_TTL_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Hashes a visitor's session key for storage.
 *
 * The cookie is a bearer credential: anyone holding it can read that visitor's transcripts. Stored
 * raw, a database dump, a stray log line, or a backup handed to a contractor becomes a set of live
 * session tokens. Hashed, the same leak yields values that cannot be replayed against the site.
 *
 * Plain SHA-256 rather than a password KDF, deliberately: the input is a high-entropy random token
 * we generate, not a user-chosen secret, so there is nothing for a slow hash to protect against —
 * and this runs on every request to the public assistant, where a deliberately slow hash would be
 * a self-inflicted denial of service.
 */
export function hashSessionKey({ sessionKey }: { sessionKey: string }, _optional = {}): string {
  return createHash("sha256").update(sessionKey).digest("hex");
}

/** An authenticated staff member. History is retained until explicitly deleted. */
export interface AdminChatPrincipal {
  readonly kind: "user";
  readonly workspaceId: string;
  readonly userId: string;
}

/** An anonymous site visitor, identified only by the opaque token in their cookie. */
export interface GuestChatPrincipal {
  readonly kind: "guest";
  readonly workspaceId: string;
  /** The RAW cookie value. It is hashed here and never stored or logged in this form. */
  readonly sessionKey: string;
}

export type ChatPrincipal = AdminChatPrincipal | GuestChatPrincipal;

/**
 * What routes are handed instead of a database.
 *
 * Injected through the host's route dependencies so a handler's only path to chat history runs
 * through a principal. The raw database handle is closed over at composition time and never
 * reaches a route, which is what makes the unscoped query unwritable rather than merely discouraged.
 */
export type ChatStoreFactory = (principal: ChatPrincipal) => ChatHistoryStore;

/**
 * When a new conversation for this principal should expire, or `undefined` for never.
 *
 * Admin history has no TTL: it is work product, and an assistant that quietly forgets what an
 * administrator did two days ago is worse than useless during an incident review. Guest history
 * expires because it is personal data belonging to someone who never created an account, and
 * keeping it indefinitely is a liability with no matching benefit.
 */
export function chatExpiryFor({ principal }: { principal: ChatPrincipal }, { now = Date.now() }: { now?: number } = {}): number | undefined {
  return principal.kind === "guest" ? now + GUEST_CHAT_TTL_MS : undefined;
}
