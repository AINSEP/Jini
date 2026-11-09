/** Shared external-MCP access vocabulary and pure row projections. Persistence remains in the
 * external-MCP service and is supplied to plugin consumers through their MCP port. */
import { createHash } from "node:crypto";
import { ToolInputError } from "@jini-ai/core";
import type { ISODateTime } from "@jini-ai/core/primitives";
import type { ExternalMcpAccessSnapshot } from "@jini-ai/core/contracts/hosted-mcp";
import { ExternalMcpValidationError } from "./validation-error.js";

/** Only source identity is hashed; credentials are represented by their existing ciphertext. */
interface ExternalMcpAdmissionSource {
  readonly createdAt: ISODateTime;
  readonly transport: string;
  readonly url: string | null;
  readonly command: string | null;
  readonly args: string | null;
  readonly authMode: string;
  readonly sealedEnv: { readonly ciphertext: string } | null;
  readonly sealedOAuth: { readonly ciphertext: string } | null;
}

type ExternalMcpAccessRecord = ExternalMcpAdmissionSource & Omit<ExternalMcpAccessSnapshot, "admissionRevision">;

const MAX_ALLOWED_TOOLS = 64;
/** Matches `trust.ts`'s own `REMOTE_TOOL_NAME_PATTERN`. Restated rather than imported because that
 *  constant is private to the trust tier; `__tests__/external-mcp-store.test.ts` asserts the two
 *  agree by round-tripping a name through `admitRemoteTools`. */
const REMOTE_TOOL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
/** Decode stored list columns; strict grant readers refuse malformed state. O(n) JSON bytes. */
/** @agent-note Pure decode of a saved JSON list column. Strict mode throws `ToolInputError` (model-facing, neutral wording); non-strict fails closed to `[]`. */
export function parseExternalMcpJsonArray({ raw }: { raw: string | null }, { strict = false }: { strict?: boolean | undefined } = {}): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (strict && (!Array.isArray(parsed) || !parsed.every(v => typeof v === "string"))) throw new Error("malformed");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    if (strict) throw new ToolInputError({ message: "The plugin connection has an unreadable tool list. Save its tool list again before enabling it." });
    return [];
  }
}

/**
 * A connection's "admitted under this" fingerprint — what `external-mcp-revocation.ts`'s per-call
 * gate compares a roster connection's row against to catch a delete-then-recreate, a
 * url/command/args/transport/authMode edit, or a rotated/cleared static credential, none of
 * which re-admit an already-running connection (the registry is append-only;
 * `mcp-federation/reload.ts` never re-admits an admitted id).
 *
 * `sealedEnv`'s CIPHERTEXT is included: a `static_env`/`stdio` credential is
 * resealed only when an operator actually submits a new `env` block — an ordinary toggle/rename
 * leaves `env` undefined and carries the existing seal through byte-for-byte (see
 * `resolveExternalMcpSealedEnv`'s `rawEnv === undefined` branch), so the ciphertext is stable across
 * cosmetic saves and only moves when the credential itself is rotated or cleared. On `static_env`
 * rows, `sealedOAuth` holds the dedicated static access token and follows the same preservation rule,
 * so its ciphertext is included too. On OAuth rows it is excluded: re-sealing on token refresh must
 * not refuse an otherwise valid connection.
 *
 * Otherwise deliberately narrow: `label`, `enabled`, both grant lists, OAuth status/expiry/tokens,
 * and `updatedAt` are excluded, because none of them identify WHERE or via WHAT credentials a call
 * reaches the remote, and including any of them would flip the revision on a toggle or a token
 * refresh that must not refuse an already-admitted tool. `createdAt` is included so a delete +
 * re-create under the same id (same url/command, different row) still changes the revision.
 *
 * Hashed rather than kept as plain text, because a hosted row's `url` can itself carry a bearer
 * token as a query parameter — this value is compared, logged, and passed to a model-facing gate, so
 * it must never be a place a credential could leak through.
 *
 * @complexity O(1).
 * @overallScore 100
 */
/** @agent-note Saved/compared format: sha256 hex over the exact JSON array below. Never reorder, add or drop inputs; existing approvals and per-call gates compare these bytes. */
export function externalMcpAdmissionRevision(
  record: ExternalMcpAdmissionSource,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        record.createdAt,
        record.transport,
        record.url,
        record.command,
        record.args,
        record.authMode,
        record.sealedEnv?.ciphertext ?? null,
        record.authMode === "static_env" ? (record.sealedOAuth?.ciphertext ?? null) : null,
      ]),
    )
    .digest("hex");
}

/** Capture the source identity, exact previous grants and their decision, excluding token-refresh metadata.
 * @returns A detached approval snapshot containing no credential bytes.
 * @complexity O(a+w) in the bounded grant lists; no I/O.
 */
/** @agent-note Pure, no I/O. One of the six `hostedMcpProjections`; the repository's compare-and-set compares its output field-for-field. */
export function externalMcpAccessSnapshot({ record }: { record: ExternalMcpAccessRecord }, _options = {}): ExternalMcpAccessSnapshot {
  return { admissionRevision: externalMcpAdmissionRevision(record), enabled: record.enabled,
    allowedToolNames: record.allowedToolNames, writeAllowedToolNames: record.writeAllowedToolNames,
    writeGrantsUpdatedByPrincipalId: record.writeGrantsUpdatedByPrincipalId, writeGrantsUpdatedAt: record.writeGrantsUpdatedAt,
    provisionedByPluginId: record.provisionedByPluginId };
}

/** Parses a row's two grant lists the same way {@link resolveExternalMcpConfig} does — shared so
 *  admission and `external-mcp-revocation.ts`'s per-call re-check can never silently disagree about
 *  what a malformed list means (both fail closed to `[]`).
 *  @complexity O(n) in the size of the two JSON blobs. */
/** @agent-note Pure. Admission and the per-call gate must both use this function so a malformed list means the same thing to both. */
export function readExternalMcpToolGrants(
  record: Pick<ExternalMcpAccessSnapshot, "allowedToolNames" | "writeAllowedToolNames">,
  options: { strict?: boolean } = {},
): { allowedToolNames: string[]; writeAllowedToolNames: string[] } {
  return {
    allowedToolNames: parseExternalMcpJsonArray({ raw: record.allowedToolNames }, { strict: options.strict }),
    writeAllowedToolNames: parseExternalMcpJsonArray({ raw: record.writeAllowedToolNames }, { strict: options.strict }),
  };
}

/** Validate already-decoded names using the save path's charset, cap and dedup rule.
 * @throws ExternalMcpValidationError for a refused name or more than 64 tools.
 * @complexity O(names), no I/O.
 */
/** @agent-note Pure. Throws only the canonical `ExternalMcpValidationError`, which plugin `classifyError` and sign-in refusal recognize. */
export function validateExternalMcpToolNames({ names, field }: { names: readonly string[]; field: string }, _options = {}): string[] {
  if (names.length > MAX_ALLOWED_TOOLS) {
    throw new ExternalMcpValidationError(`at most ${MAX_ALLOWED_TOOLS} tools are supported`, field);
  }
  for (const name of names) {
    if (!REMOTE_TOOL_NAME_PATTERN.test(name)) {
      throw new ExternalMcpValidationError(
        `'${name}' is not a valid MCP tool name, so the trust tier would refuse it on connect`,
        field,
      );
    }
  }
  return [...new Set(names)];
}
