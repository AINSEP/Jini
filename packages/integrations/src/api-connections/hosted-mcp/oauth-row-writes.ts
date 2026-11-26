import { applyInternalChange } from "@jini-ai/core/optimistic-concurrency";
import type { ExternalMcpOAuthRuntimePatch, ExternalMcpServerKey, ExternalMcpServerRecord, ExternalMcpServerRepoPort } from "@jini-ai/core/contracts/hosted-mcp";
import type { HostedMcpSignInPorts } from "./contracts.js";

/**
 * @file The two kinds of write the sign-in makes to an external-MCP row (lost-update design S1, M7).
 *
 * A sign-in step reads the row, then calls a provider over the network, then writes. Writing the
 * whole row back from that early read restores every column the person edited in between (label,
 * enabled flag, tool grants) — a token refresh in flight could re-enable a server an admin had just
 * disabled. So:
 *
 * - {@link writeOAuthRuntime}: the write that only moves OAuth runtime state (tokens, status,
 *   expiry, lease). Names only those columns, is fenced on the credential it read, and leaves
 *   `version` alone so background activity never makes a person's save conflict.
 * - {@link updateRowOnce}: the write that changes columns an editor sees (sign-in configuration, a
 *   forgotten client). Compares the row's `version` and credential pointers in the write; on a miss
 *   it re-reads and re-applies the same change once (M4), then reports the conflict.
 */

type RowRepo = Pick<ExternalMcpServerRepoPort, "findByServerId" | "updateIfVersion" | "updateOAuthRuntime">;

/** The runtime columns of a row built for a status change; everything else on it is ignored. */
export function runtimePatchOf(row: ExternalMcpServerRecord): ExternalMcpOAuthRuntimePatch {
  return { oauthStatus: row.oauthStatus, oauthExpiresAt: row.oauthExpiresAt, oauthRefreshLeaseUntil: row.oauthRefreshLeaseUntil,
    sealedOAuth: row.sealedOAuth, oauthAadVersion: row.oauthAadVersion, updatedAt: row.updatedAt };
}

/**
 * Applies a runtime patch to the credential `record` was read with.
 *
 * @throws the host's re-authorization error when the credential was replaced or removed since the
 *   read: the tokens belong to a credential that is gone, so they are dropped (never written onto
 *   its replacement) and the connection reports that it must be authorized again.
 * @complexity O(1): one conditional write.
 */
export async function writeOAuthRuntime(
  { repo, ports, record, patch }: { repo: Pick<ExternalMcpServerRepoPort, "updateOAuthRuntime">; ports: Pick<HostedMcpSignInPorts, "errors">; record: ExternalMcpServerRecord; patch: ExternalMcpOAuthRuntimePatch },
  options: { expectedConfig?: Pick<ExternalMcpServerRecord, "createdAt" | "version"> } = {},
): Promise<void> {
  const key: ExternalMcpServerKey = { workspaceId: record.workspaceId, serverId: record.serverId };
  if (await repo.updateOAuthRuntime({ key, expectedSealedOAuth: record.sealedOAuth, patch, ...options })) return;
  throw ports.errors.reauthRequired({
    serverId: record.serverId,
    label: record.label,
    cause: new Error(`The OAuth credential of MCP server '${record.serverId}' (workspace '${record.workspaceId}') was replaced or removed while a sign-in write was in flight. The new token set was dropped, not written onto its replacement.`),
  });
}

/**
 * Re-reads the row, lets `build` derive its next state, and writes it conditionally on the version
 * and credentials it read; once more from a fresh read if that missed, then a conflict (M4).
 *
 * @param required.build - Derives the next row from the row just read; `null` means nothing to write.
 * @returns the row as written, or `null` when the row is gone or `build` had nothing to write.
 * @throws {RecordVersionConflictError} when the row changed again between the retry's read and write.
 * @complexity O(1) writes; at most two reads and two builds.
 */
export async function updateRowOnce(
  { repo, key, build }: { repo: RowRepo; key: ExternalMcpServerKey; build: (record: ExternalMcpServerRecord) => Promise<ExternalMcpServerRecord | null> },
  _options = {},
): Promise<ExternalMcpServerRecord | null> {
  return applyInternalChange<ExternalMcpServerRecord>({ recordKind: "MCP server", recordId: key.serverId, read: () => repo.findByServerId(key), build: async current => {
    const next = await build(current);
    return next === null ? null : { ...next, version: current.version + 1 };
  },
    write: ({ current, next }) => repo.updateIfVersion({ record: next, expectedVersion: current.version, replaces: { sealedEnv: current.sealedEnv, sealedOAuth: current.sealedOAuth } }) });
}
