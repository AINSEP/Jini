import type { Generated, Selectable } from "kysely";
import {
  createVerifiedOrigin,
  type OriginScheme,
  type OriginSource,
  type VerifiedOrigin,
} from "@jini-ai/core/contracts/server/verified-origin";

/** Stored column shape, copied without schema changes; the table name is host-owned (see `OriginTables`). */
export interface OriginSettingsTable {
  workspace_id: string;
  scheme: string;
  host: string;
  port: number | null;
  base_path: string | null;
  verified_at: string;
  source: string;
  redirect_allowlist_json: Generated<string>;
  egress_allowlist_json: Generated<string>;
}

export type OriginRow = Selectable<OriginSettingsTable>;

export function toVerifiedOrigin({ row }: { row: OriginRow }, _optional: Record<string, never> = {}): VerifiedOrigin {
  // Built up conditionally, not `port: row.port ?? undefined` — an object literal with an
  // explicit `undefined`-valued key is NOT deep-equal to one that never had the key at all
  // (`assert.deepStrictEqual` is strict about this), and `VerifiedOrigin.port`/`.basePath` are
  // genuinely optional fields the in-memory adapter simply omits when unset.
  const candidate: VerifiedOrigin = {
    scheme: row.scheme as OriginScheme,
    host: row.host,
    verifiedAt: row.verified_at,
    source: row.source as OriginSource,
  };
  if (row.port != null) candidate.port = row.port;
  if (row.base_path != null) candidate.basePath = row.base_path;
  return createVerifiedOrigin(candidate);
}

/** The origin columns only — deliberately NOT the allowlist columns. See
 *  {@link registerConfiguredOriginOn}. */
export function originColumns({ origin }: { origin: VerifiedOrigin }, _optional: Record<string, never> = {}) {
  return {
    scheme: origin.scheme,
    host: origin.host,
    port: origin.port ?? null,
    base_path: origin.basePath ?? null,
    verified_at: origin.verifiedAt,
    source: origin.source,
  };
}

/**
 * Whether the stored row already names the same origin. `verifiedAt` is excluded on purpose: it is
 * a stamp, not part of the origin's identity, so including it would make every boot an UPDATE and
 * churn the row forever.
 *
 * @complexity O(1).
 */
export function sameOrigin({ row, origin }: { row: OriginRow; origin: VerifiedOrigin }, _optional: Record<string, never> = {}): boolean {
  const sameAddress = row.scheme === origin.scheme &&
    row.host === origin.host;
  const port = origin.port ?? null;
  const basePath = origin.basePath ?? null;
  return (
    sameAddress && row.port === port &&
    row.base_path === basePath &&
    row.source === origin.source
  );
}
