import { PublishContentPeerNotFoundError } from "./peers.js";

/**
 * @file The single seam where a publish decides HOW it authenticates — item 6 of
 * `ADS-memory/.local-artifacts/handoffs/2026-09-19-publish-zero-setup-auth.md`.
 *
 * Two kinds of destination, one credential shape:
 *
 * - A row with a sealed key is the original explicitly-configured peer. Unchanged: the key is
 *   opened by `resolvePeerCredential`, the one decrypting function in `peers.ts`.
 * - A row with NO sealed key is a destination this install is CONNECTED to. There is nothing to
 *   open, because nothing was ever stored: the handshake proves possession of the site key and
 *   mints a session token good for the next few minutes, and that token is the credential.
 *
 * ## Why this is the only change the outbound transport needed
 *
 * `peer-transport.ts`'s `callPeer` sends `Bearer ${credential.apiKey}` and builds every path from
 * `credential.remoteWorkspaceId`. Neither cares where those two values came from, so a session
 * token substituted for a pasted key travels the existing push and pull paths with no change to
 * the driver at all — verified against the tree before this file was written, not assumed. What the
 * driver's own comment used to claim (that a peer "authenticates as an ordinary API-key principal")
 * is now true of one of the two kinds only, and that comment has been corrected.
 *
 * ## The session never outlives the request
 *
 * A fresh session is minted per resolution, exactly as a sealed key is opened per resolution. It is
 * not cached: a cached publishing token would outlive a revocation, and the destination re-reads
 * its deny list on every request precisely so that revocation is immediate.
 */

/** One stored destination row, as far as the credential decision needs it. `sealed` is `null` for a
 *  destination this install is CONNECTED to (nothing to open). */
export interface DestinationPeerRecord {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly remoteWorkspaceId: string;
  readonly sealed: unknown;
}

/** The repo read the credential decision needs. Structural, so a host's richer repo port satisfies it. */
export interface DestinationPeerRepo {
  findById(input: { workspaceId: string; id: string }): Promise<DestinationPeerRecord | null>;
}

/** The credential shape the transport driver consumes, whichever way it was obtained. */
export interface ResolvedDestinationCredential {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly remoteWorkspaceId: string;
  readonly apiKey: string;
}

/** What a minted publishing session exposes: the short-lived token and the destination's own claim
 *  about which workspace it is. */
export interface DestinationSession {
  readonly token: string;
  readonly identity: { readonly workspaceId: string };
}

/** The host-supplied behaviour this module decides between; every one is REQUIRED so the package
 *  imports no handshake, sealer, keyring or HTTP implementation. `D` is the host's deps bag, handed
 *  through untouched. */
export interface DestinationCredentialPorts<D> {
  /** Opens a sealed row's key — the host's ONE decrypting function. */
  resolveSealedCredential(args: { deps: D; input: { workspaceId: string; id: string } }): Promise<ResolvedDestinationCredential>;
  /** Mints a session for a connected (unsealed) destination. */
  openSession(args: { deps: D; input: { baseUrl: string; workspaceId: string; backstop?: true } }): Promise<DestinationSession>;
  /** Builds the host's refusal (its own error class and owner-facing sentence) for a destination that
   *  now reports a different workspace than the one learned at connect time. */
  workspaceMismatchError(args: { label: string }): Error;
}

/**
 * Resolves whatever credential a destination is due, for the lifetime of one outbound request.
 *
 * @param required.input.workspaceId - THIS install's workspace. It scopes the row AND selects the site key
 * the publishing key is derived from; those are deliberately the same value.
 * @returns A credential the transport driver can use unchanged.
 * @throws {PublishContentPeerNotFoundError} when no row exists.
 * @throws {PublishTrustHandshakeError} when a connected destination cannot be reached, is not a
 * recognised site, or does not recognise this computer — each already a sentence for the owner.
 * @throws Whatever `resolvePeerCredential` throws for a sealed row (unchanged).
 * @complexity O(1) plus one repo read; then either one AEAD open, or three round trips and two
 * HKDFs for a connected destination.
 */
export async function resolvePublishDestinationCredential<D extends { readonly repo: DestinationPeerRepo }>(
  { deps, input, resolveSealedCredential, openSession, workspaceMismatchError }: { deps: D; input: { workspaceId: string; id: string; backstop?: boolean } } & DestinationCredentialPorts<D>,
  _optional = {}
): Promise<ResolvedDestinationCredential> {
  const record = await deps.repo.findById(input);
  if (!record) throw new PublishContentPeerNotFoundError({ message: `peer '${input.id}' was not found` });

  if (record.sealed !== null) {
    // Deliberately re-entered rather than inlined: `resolvePeerCredential` is the ONLY function
    // allowed to decrypt (`peers.ts`'s header), and it is worth one extra indexed read to keep that
    // property literally true instead of "true apart from here".
    return resolveSealedCredential({ deps, input });
  }

  const session = await openSession({
    deps,
    input: { baseUrl: record.baseUrl, workspaceId: input.workspaceId, ...(input.backstop ? { backstop: true as const } : {}) },
  });

  // The workspace learned at connect time, re-checked against what the site says about itself right
  // now. A destination rebuilt under a different workspace is a DIFFERENT site; publishing into it
  // would be a silent misdelivery, and a misdelivery is worse than a refusal. The session mint
  // above would not have caught this on its own — a grant is bound to the destination's
  // installation, and a restore can change the workspace while the grant still verifies.
  if (session.identity.workspaceId !== record.remoteWorkspaceId) {
    throw workspaceMismatchError({ label: record.label });
  }

  return {
    id: record.id,
    label: record.label,
    baseUrl: record.baseUrl,
    remoteWorkspaceId: record.remoteWorkspaceId,
    apiKey: session.token,
  };
}
