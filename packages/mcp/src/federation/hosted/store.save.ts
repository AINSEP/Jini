import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import type { ExternalMcpServerKey, ExternalMcpServerRecord, ExternalMcpServerRepoPort, SaveExternalMcpServerInput } from "@jini-ai/core/contracts/hosted-mcp";
import { ExternalMcpValidationError } from "./validation-error.js";
import type { HostedMcpStorePorts } from "./store-ports.js";

/**
 * @file The write half of `saveExternalMcpServer` (lost-update design S1, rules M1/M4).
 *
 * A save used to upsert the whole row built from a read made earlier in the same request. It now
 * creates with `insert` and edits with `updateIfVersion`: the compare is in the write, and the basis
 * is the version the person loaded when they sent one (an old screen is refused) or else the version
 * read in this request (which only closes the race between two server calls).
 */

export type CredentialPorts = Pick<HostedMcpStorePorts, "assertFreeField" | "credential">;

export function assertExternalMcpPlainField(required: { value: string; field: string }, ports: CredentialPorts): void {
  try { ports.assertFreeField(required); }
  catch (err) {
    if (err instanceof ports.credential.InputError) throw new ExternalMcpValidationError(err.message, err.field);
    throw err;
  }
}

export function assertExternalMcpPlainInput({ input, ports }: { input: SaveExternalMcpServerInput; ports: CredentialPorts }, _options = {}): void {
  for (const field of ["serverId", "label", "command", "args", "url", "transport", "authMode", "accessTokenEnvName"] as const) {
    assertExternalMcpPlainField({ value: input[field] ?? "", field }, ports);
  }
  for (const [field, value] of Object.entries(input.oauth ?? {})) {
    if (field !== 'clientSecret' && typeof value === 'string') assertExternalMcpPlainField({ value, field: `oauth.${field}` }, ports);
  }
}

function conflict({ key, expectedVersion, currentVersion }: { key: ExternalMcpServerKey; expectedVersion: number; currentVersion: number | null }): RecordVersionConflictError {
  return new RecordVersionConflictError({ recordKind: "MCP server", recordId: key.serverId, expectedVersion, currentVersion });
}

type SaveRepo = Pick<ExternalMcpServerRepoPort, "findByServerId" | "insert" | "updateIfVersion">;

/** Refuses the save when the row's current version is not the basis the person loaded (no basis: nothing to compare). */
function assertBasis({ key, expectedVersion, current }: { key: ExternalMcpServerKey; expectedVersion: number | undefined; current: ExternalMcpServerRecord | null }): void {
  if (expectedVersion === undefined) return;
  if ((current?.version ?? 0) !== expectedVersion) throw conflict({ key, expectedVersion, currentVersion: current?.version ?? null });
}

/** Creates the row when there was none, else replaces it only if its version is still the one read. */
function writeNext({ repo, record, existing }: { repo: SaveRepo; record: ExternalMcpServerRecord; existing: ExternalMcpServerRecord | null }): Promise<boolean> {
  if (!existing) return repo.insert({ record });
  return repo.updateIfVersion({ record, expectedVersion: existing.version, replaces: { sealedEnv: existing.sealedEnv, sealedOAuth: existing.sealedOAuth } });
}

/**
 * Reads the stored row, builds the next one and writes it conditionally.
 *
 * @param required.expectedVersion - The version the person loaded; absent means "the version read here".
 * @param required.build - Derives the row to write from the stored row (`null` for a create). It is
 *   re-run on a fresh read when the write missed only because a token refresh moved a credential.
 * @returns the row as written, with its new version.
 * @throws {RecordVersionConflictError} when the row changed (or was deleted, or created) after the
 *   basis, including a second miss after the one retry.
 * @complexity O(1) writes; at most two reads and two builds.
 */
export async function commitExternalMcpSave(
  { repo, key, expectedVersion, build }: { repo: SaveRepo; key: ExternalMcpServerKey; expectedVersion: number | undefined; build: (existing: ExternalMcpServerRecord | null) => Promise<ExternalMcpServerRecord> },
  _options = {},
): Promise<ExternalMcpServerRecord> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await repo.findByServerId(key);
    assertBasis({ key, expectedVersion, current: existing });
    const record = await build(existing);
    if (await writeNext({ repo, record, existing })) return { ...record, version: (existing?.version ?? 0) + 1 };
    // A miss with the basis still current means a runtime write (a token refresh) or a concurrent
    // internal write moved the row between the read and the write; read again and rebuild once.
    assertBasis({ key, expectedVersion, current: await repo.findByServerId(key) });
  }
  const live = await repo.findByServerId(key);
  throw conflict({ key, expectedVersion: expectedVersion ?? 0, currentVersion: live?.version ?? null });
}
