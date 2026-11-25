import type { Clock } from "@jini-ai/core/primitives";
import { saveConnectedDestination, removeConnectedDestination, selectConnectedDestination } from "./peer-registry.js";
import type { PublishContentPeerRepoPort, PublishContentPeerSummary } from "./peer-registry.js";
import { siteLabelFor } from "./publish-readiness.js";

/**
 * @file Connecting and disconnecting as ONE step each, compensation included.
 *
 * Connecting this computer to a live site writes two things in two different persistence systems:
 * an authorisation grant into committed deploy config (`features/publish-trust/connect.ts`) and a
 * peer row into SQLite (`peers.ts`). Disconnecting removes both. Nothing can wrap a file write and
 * a database write in one transaction, so the `TransactionRunner` answer `features/trash` uses for
 * its two-SQLite-writes problem does not apply here — the answer is compensation.
 *
 * Neither call site had any. Both the HTTP route (`routes/publish-content/destination.ts`) and the
 * assistant tool (`tool-registrations.ts`) open-coded the same sequence, and both left the two
 * systems disagreeing when the second write failed (sol review 2026-09-20, Medium finding 5):
 *
 * - Connect: the grant landed, the row write failed, the operator was told the connect failed —
 *   and a durable authorisation stayed in the deploy config, live on the next deploy.
 * - Disconnect: the grant was reversed, the row delete failed, and the UI kept saying "connected"
 *   over an authorisation that no longer existed, so the next publish failed for no visible reason.
 *
 * The grant half is injected as {@link ConnectAndRecordDeps.connectGrant}/`reverseGrant` rather
 * than imported, for the reason every other port in this feature is injected: it keeps the
 * composition testable against a failing peer repo without standing up a destination server, and
 * it keeps this module from importing `publish-trust`'s whole deps shape. Both call sites bind the
 * real `connectDestination`/`disconnectDestination`.
 *
 * ## Ordering, and why disconnect removes the row first
 *
 * Connect writes the grant first because it cannot know the destination's workspace id — which the
 * peer row needs — until the handshake inside `connectGrant` has run. So the row is the second
 * write, and a failure there compensates by reversing the grant.
 *
 * Disconnect removes the peer row FIRST, which reverses the previous order. The row is the cheap,
 * local, restorable half: if the grant reversal then fails, this module puts the row back from the
 * copy it is still holding, and the two systems agree again. The other order has no compensation
 * available — re-writing a reversed grant needs a fresh network handshake this module has no way
 * to perform while reporting a failure.
 */

/** What a successful grant write reports back. Structural, not imported, so this module stays
 *  independent of `publish-trust`'s own deps shape — see this file's header. */
export interface GrantWriteResult {
  readonly identity: { readonly workspaceId: string };
  readonly baseUrl: string;
  readonly changed: boolean;
  readonly nextStep: string;
}

/** What a successful grant reversal reports back. */
export interface GrantReverseResult {
  readonly changed: boolean;
  readonly target: { readonly nextStep: string };
}

export interface ConnectAndRecordDeps {
  readonly repo: PublishContentPeerRepoPort;
  readonly clock: Clock;
  readonly idGen: { newId(): string };
  /** Writes this install's grant for `baseUrl`. Bound to `publish-trust`'s `connectDestination`. */
  connectGrant(input: { baseUrl: string; entityTypes: readonly string[] }, optional?: Record<string, never>): Promise<GrantWriteResult>;
  /** Reverses the grant this install holds. Bound to `publish-trust`'s `disconnectDestination`,
   *  and called ONLY to compensate a failed peer-row write. */
  reverseGrant(): Promise<GrantReverseResult>;
}

export interface DisconnectAndForgetDeps {
  readonly repo: PublishContentPeerRepoPort;
  readonly clock: Clock;
  readonly idGen: { newId(): string };
  reverseGrant(): Promise<GrantReverseResult>;
}

/**
 * Connects this computer to `baseUrl`: writes the grant, then records the peer row.
 *
 * If the peer row cannot be written, the grant is reversed before the original error is re-thrown,
 * so a connect the operator was told failed leaves no durable authorisation behind. The
 * compensation is best-effort by necessity — if reversing ALSO fails there is nothing further this
 * module can do — but it never replaces the original error, which is the one that explains what
 * went wrong.
 *
 * @throws whatever `connectGrant` throws (handshake or config-write failures reach the caller
 * unchanged), or whatever the peer-row write threw, after compensation has been attempted.
 * @complexity O(n) in the workspace's peer count, plus one handshake, one config write and one
 * database write.
 */
export async function connectAndRecordDestination(
  { deps, input }: {
    deps: ConnectAndRecordDeps;
    input: { workspaceId: string; baseUrl: string; entityTypes: readonly string[] };
  },
  _optional = {}
): Promise<{ site: PublishContentPeerSummary; grant: GrantWriteResult }> {
  const grant = await deps.connectGrant({ baseUrl: input.baseUrl,
    entityTypes: input.entityTypes.filter((entityType) => entityType !== "raw-row" && entityType !== "raw-file") });

  let site: PublishContentPeerSummary;
  try {
    site = await saveConnectedDestination(
      {
        deps: { repo: deps.repo, clock: deps.clock, idGen: deps.idGen },
        input: {
          workspaceId: input.workspaceId,
          label: siteLabelFor({ baseUrl: grant.baseUrl }),
          baseUrl: grant.baseUrl,
          remoteWorkspaceId: grant.identity.workspaceId,
        }
      }
    );
  } catch (err) {
    // Compensate, then report the failure that actually happened. A reversal that itself fails is
    // deliberately swallowed: it cannot be acted on separately, and surfacing it instead of `err`
    // would hide the cause from the operator.
    try {
      await deps.reverseGrant();
    } catch {
      /* the original failure below is the one worth reporting */
    }
    throw err;
  }

  return { site, grant };
}

/**
 * Disconnects this computer: forgets the peer row, then reverses the grant.
 *
 * If the grant reversal fails, the peer row is restored from the copy held here, so the UI keeps
 * saying "connected" — which is true, because the grant is still live. See this file's header for
 * why this half runs in the opposite order to connect.
 *
 * @returns the destination that was disconnected (`null` when this computer was not connected to
 * anything), and whether the grant write actually changed the deploy config.
 * @throws whatever `reverseGrant` throws, after the peer row has been put back.
 * @complexity O(n) in the workspace's peer count, plus one config write and at most two database
 * writes.
 */
export async function disconnectAndForgetDestination(
  { deps, input }: {
    deps: DisconnectAndForgetDeps;
    input: { workspaceId: string };
  },
  _optional = {}
): Promise<{ site: PublishContentPeerSummary | null; changed: boolean; target: GrantReverseResult["target"] }> {
  const rows = await deps.repo.listByWorkspace({ workspaceId: input.workspaceId });
  const row = selectConnectedDestination({ rows });

  if (row) {
    await removeConnectedDestination({ deps: { repo: deps.repo }, input: { workspaceId: input.workspaceId, baseUrl: row.baseUrl } });
  }

  let reversed: GrantReverseResult;
  try {
    reversed = await deps.reverseGrant();
  } catch (err) {
    if (row) {
      // Put the row back so the two systems agree again. A restore that itself fails leaves the
      // pre-fix split state, which is no worse than doing nothing and is not worth masking `err`.
      try {
        await saveConnectedDestination(
          {
            deps: { repo: deps.repo, clock: deps.clock, idGen: deps.idGen },
            input: {
              workspaceId: input.workspaceId,
              label: row.label,
              baseUrl: row.baseUrl,
              remoteWorkspaceId: row.remoteWorkspaceId,
            }
          }
        );
      } catch {
        /* the original failure below is the one worth reporting */
      }
    }
    throw err;
  }

  return {
    site: row
      ? {
          id: row.id,
          label: row.label,
          baseUrl: row.baseUrl,
          remoteWorkspaceId: row.remoteWorkspaceId,
          masked: null,
          hasCredential: false,
        }
      : null,
    changed: reversed.changed,
    target: reversed.target,
  };
}
