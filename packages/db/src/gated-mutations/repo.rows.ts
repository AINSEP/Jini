import type { Insertable, Selectable } from "kysely";
import type { ConfirmationTokenRecord } from "@jini-ai/core/gated-mutations";

/** Stored column shape, copied without schema changes; the table name is host-owned (see `TokenStoreTables`). */
export interface GatedMutationTokensTable {
  confirmation_token: string;
  plan_hash: string;
  scope_id: string;
  confirmer_principal_id: string;
  status: string;
  created_at: string;
  expires_at: string;
}

export function toRecord(row: Selectable<GatedMutationTokensTable>): ConfirmationTokenRecord {
  return {
    confirmationToken: row.confirmation_token,
    planHash: row.plan_hash,
    scopeId: row.scope_id,
    confirmerPrincipalId: row.confirmer_principal_id,
    status: row.status as ConfirmationTokenRecord["status"],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function toRow(record: ConfirmationTokenRecord): Insertable<GatedMutationTokensTable> {
  return {
    confirmation_token: record.confirmationToken,
    plan_hash: record.planHash,
    scope_id: record.scopeId,
    confirmer_principal_id: record.confirmerPrincipalId,
    status: record.status,
    created_at: record.createdAt,
    expires_at: record.expiresAt,
  };
}
