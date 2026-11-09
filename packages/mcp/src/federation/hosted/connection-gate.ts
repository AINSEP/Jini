import { ToolInputError } from "@jini-ai/core";
import type { UUID } from "@jini-ai/core/primitives";
import type { ExternalMcpRevocationReason, ExternalMcpServerRecord, ExternalMcpServerRepoPort } from "@jini-ai/core/contracts/hosted-mcp";
import type { FederatedCallTarget, FederatedGateVerdict } from "../ports.js";
import { rosterRefusalFor } from "./revocation.js";
import { resolveExternalMcpAuthMode, resolveExternalMcpOAuthStatus } from "./auth.js";

/** What {@link createHostedMcpConnectionGate} closes over — split out so
 *  {@link readConnectionRowOrRefuse} can share the exact same shape rather than restating it. */
export interface ExternalMcpConnectionGateDeps {
  readonly workspaceId: UUID;
  readonly repo: Pick<ExternalMcpServerRepoPort, "findByServerId">;
  readonly isPluginEnabled: (pluginId: string) => Promise<boolean>;
  readonly assertSharedAuthorized?: (input: { serverId: string }) => Promise<boolean>;
}

/**
 * @agent-note The gate's host inputs (EXTRACT-S5 H2b seam; the gate moves to `mcp/federation/hosted` in H3 and imports no
 * integrations or OAuth module). The host fulfills them ONCE per gate. `repo` is the same repository instance the store and
 * sign-in use; the gate makes one `findByServerId` per call and never unseals, opens a token or touches the network.
 * `isPluginEnabled` is the host's activation owner: a throw DENIES. `assertSharedAuthorized` is the host's shared-owner
 * check; `true` skips only the legacy re-authorization check. `reauthRequired` is the host's ONE canonical re-authorization
 * factory, the same function its sign-in service throws through, so `instanceof`, `code` and `retryable` stay one identity.
 * `revoked` builds the host's revocation error with its own messages and code. `recovery` returns model-facing recovery
 * text naming the host's own tool ids. `logUnreadableRow` is operator-only diagnostics; it MUST NOT throw, and its detail never reaches model text.
 */
export interface HostedMcpConnectionGatePorts extends ExternalMcpConnectionGateDeps {
  readonly reauthRequired: (input: { serverId: string; label?: string | null }) => Error;
  readonly revoked: (input: { serverId: string; label: string | null; remoteName: string; reason: ExternalMcpRevocationReason }) => Error;
  readonly recovery: {
    readonly accessHint: (input: { pluginId: string; serverId: string; refusal: ExternalMcpRevocationReason }) => string;
    readonly pluginOff: (input: { pluginId: string }) => string;
  };
  readonly logUnreadableRow: (input: { connectionId: string; error: unknown }) => void;
}

/**
 * Builds the liveness-AND-revocation gate the federation checks before every
 * federated call.
 *
 * ## Why this reads the database on every call, and why that is the right cost
 *
 * The connection's row is the only thing both processes that might serve a call — the agent daemon
 * and the admin web server, which hold separate database handles — can see, so an in-memory flag in
 * either one would be invisible to the other. Answering "is this connection still usable" is one
 * indexed primary-key read and, for the legacy reauth check below, no keyring round trip either.
 *
 * ## Two checks, in order, and why a PRESET short-circuits the first
 *
 * A preset connection (`origin.kind === "preset"`) has no row in this table at all — its
 * `allowedToolNames`, its enabled state, everything about it, comes from
 * the host's preset resolution, not from an operator-editable roster row.
 * So {@link rosterRefusalFor} — `revocation.ts`'s per-call re-check against a roster
 * row's CURRENT `enabled`/grant-lists/admission-revision — is skipped entirely for a preset; refusing
 * it would take out a working server to guard a state it structurally cannot be in. A roster
 * connection (`origin.kind === "roster"`, or a call built with no origin at all — the `unverifiable`
 * bug-guard) gets the full re-check.
 *
 * The legacy OAuth `needs_reauth` check ({@link assertNotAwaitingReauth}) then runs regardless of
 * origin, UNCHANGED from before this gate also did revocation — a preset can be OAuth-authenticated
 * too, and this is the one state that always applied to both origins.
 *
 * @returns The gate. Never throws at construction.
 * @complexity O(1) per call — one primary-key read, no unseal.
 * @tradeoffs One read per federated tool call, rather than caching the status. A cache is what would
 *   reintroduce the cross-process invisibility this exists to close, and the read is far cheaper
 *   than the network round trip it guards.
 */
export function createHostedMcpConnectionGate(deps: HostedMcpConnectionGatePorts): (connectionId: string, call: FederatedCallTarget) => Promise<void | FederatedGateVerdict> {
  return async (connectionId, call) => {
    const record = await readConnectionRowOrRefuse(deps, connectionId);
    await assertProvisioningPluginEnabled({ deps, record });
    const isPreset = call.origin?.kind === "preset";
    const refusal = isPreset ? null : rosterRefusalFor(record, call);
    if (refusal !== null) {
      offerPluginAccessCard({ deps, record, refusal });
      throw deps.revoked({ serverId: connectionId, label: record?.label ?? null, remoteName: call.remoteName, reason: refusal });
    }
    const shared = await deps.assertSharedAuthorized?.({ serverId: connectionId });
    if (!shared) assertNotAwaitingReauth(deps, record, connectionId);
    // A roster call just passed `rosterRefusalFor`'s current-row grant check; tell Jini so its
    // admitted-grants snapshot does not refuse a grant added since boot. A preset vouches for nothing.
    return isPreset ? undefined : "current-grants-checked";
  };
}

/** Point an active plugin with missing source/tool/write grants back to its existing single card.
 * @throws ToolInputError naming that review flow; no grant or configuration is changed here.
 * @complexity O(1), no I/O.
 */
function offerPluginAccessCard({ deps, record, refusal }: { deps: HostedMcpConnectionGatePorts; record: ExternalMcpServerRecord | null; refusal: ExternalMcpRevocationReason }, _options = {}): void {
  const pluginId = record?.provisionedByPluginId;
  if (!pluginId || !['turned-off', 'tool-not-allowed', 'write-not-allowed'].includes(refusal)) return;
  throw new ToolInputError({ message: deps.recovery.accessHint({ pluginId, serverId: record!.serverId, refusal }) });
}

/** A surviving connection never overrides its provisioning plugin's OFF switch.
 * @throws ToolInputError before any remote call when activation is off or cannot be verified.
 * @complexity One activation-owner check for plugin rows; no extra row read.
 */
async function assertProvisioningPluginEnabled({ deps, record }: { deps: HostedMcpConnectionGatePorts; record: ExternalMcpServerRecord | null }, _options = {}): Promise<void> {
  const pluginId = record?.provisionedByPluginId;
  if (!pluginId) return;
  let enabled = false;
  try { enabled = await deps.isPluginEnabled(pluginId); }
  catch { /* An unreadable activation must not authorize a remote call. */ }
  if (!enabled) throw new ToolInputError({ message: deps.recovery.pluginOff({ pluginId }) });
}

/** The gate's row read, guarded: a read that THROWS (a locked database, a corrupt row) must not leak
 *  its detail to the model — that detail can carry a file path or a driver's internal message — so it
 *  goes to the host's `logUnreadableRow` port for an operator to find, and the model gets only `unverifiable`'s generic
 *  text. Split out of {@link createHostedMcpConnectionGate} purely to keep that function's
 *  complexity under the shop ceiling.
 *  @complexity O(1). */
async function readConnectionRowOrRefuse(deps: HostedMcpConnectionGatePorts, connectionId: string): Promise<ExternalMcpServerRecord | null> {
  try {
    return await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId: connectionId });
  } catch (error) {
    deps.logUnreadableRow({ connectionId, error });
    throw deps.revoked({ serverId: connectionId, label: null, remoteName: "", reason: "unverifiable" });
  }
}

/** The gate's ORIGINAL body, byte-identical in behaviour: a missing row, or one not OAuth-authenticated,
 *  passes; `needs_reauth` throws the same terminal error it always has. Split out of
 *  {@link createHostedMcpConnectionGate} purely to keep that function's complexity under the shop
 *  ceiling.
 *  @complexity O(1). */
function assertNotAwaitingReauth(deps: HostedMcpConnectionGatePorts, record: ExternalMcpServerRecord | null, connectionId: string): void {
  if (!record || resolveExternalMcpAuthMode(record) !== "oauth") return;
  if (resolveExternalMcpOAuthStatus(record) !== "needs_reauth") return;
  throw deps.reauthRequired({ serverId: connectionId, label: record.label });
}
