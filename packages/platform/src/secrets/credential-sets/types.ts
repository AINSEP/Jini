/** Host-neutral credential records and workspace-scoped repository contracts.
 * insert/update clear other defaults in the same vendor group; deleting a default promotes
 * the most recently updated remaining row. Summaries never include sealed payloads.
 */

import type { SealedSecret } from "../types.js";

// Types carry no keyring/sealer or I/O dependency: validation and sealing belong to the store,
// while memory and database repositories implement the same workspace-scoped contract.
// Connection fields exist only in memory after opening sealed material, never in this stored row.
export interface VendorCredentialSetRecord {
  readonly workspaceId: string;
  readonly id: string;

  /** Open string so plugin hosts can declare vendors beyond the built-in validators. */
  readonly vendorId: string;
  readonly label: string;
  readonly sealed: SealedSecret;

  /** Last four secret characters for recognition, stored in clear; a suffix alone is not the token. */
  readonly tokenTail: string;

  /** At most one default per (workspaceId, vendorId), maintained by the store/repository write path. */
  readonly isDefault: boolean;

  /** Only a verified public login belongs here; null until verification populates it. */
  readonly accountLabel: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// No field may carry sealed material, a token, or decrypted connection input. The short suffix is
// deliberate recognition metadata; it is not enough material to recover a long secret.
export interface VendorCredentialSetSummary {
  readonly id: string;
  readonly vendorId: string;
  readonly label: string;
  readonly configured: true;
  readonly isDefault: boolean;
  readonly tokenTail: string;
  readonly accountLabel: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VendorCredentialSetRepoPort {
  // Clear other defaults atomically with insert/update: a read-then-clear sequence can race.
  insert(record: VendorCredentialSetRecord): Promise<void>;

  /** Full-row replacement supports rename and secret rotation; label uniqueness can still reject it. */
  update(record: VendorCredentialSetRecord): Promise<void>;
  findById(input: { workspaceId: string; id: string }): Promise<VendorCredentialSetRecord | null>;

  findDefaultByVendor(input: { workspaceId: string; vendorId: string }): Promise<VendorCredentialSetRecord | null>;

  /** Lets the store recognize a group's first row and choose a promotion candidate before deletion. */
  listByVendor(input: { workspaceId: string; vendorId: string }): Promise<VendorCredentialSetRecord[]>;

  /** Intentionally unpaginated for a human-managed connection list, rather than a bulk credential inventory. */
  listByWorkspace(input: { workspaceId: string }): Promise<VendorCredentialSetRecord[]>;

  /** Missing (workspaceId, id) is a no-op so repeated deletes remain idempotent. */
  delete(input: { workspaceId: string; id: string }): Promise<void>;

  /** Target only accountLabel: verification must not rewrite sealed/default/tail/updatedAt state.
   * A missing row is a no-op, as with delete. */
  updateAccountLabel(input: { workspaceId: string; id: string; accountLabel: string }): Promise<void>;
}
