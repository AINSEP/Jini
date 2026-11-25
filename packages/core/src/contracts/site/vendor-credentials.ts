import type { VaultRepoPort, VendorCredentialSetRecord as JiniVendorRecord, VendorCredentialSetRepoPort as JiniVendorRepo } from "../vault.js";
import type { CredentialTokenHint } from "./secrets-credential-token.js";
import type { CredentialProjectHalf } from "./credential-project-half.js";

export interface VendorCredentialSetRecord extends JiniVendorRecord { readonly tokenHint?: CredentialTokenHint | null }
/** Workspace-scoped persistence for {@link VendorCredentialSetRecord} (ADR-007 §1).
 *
 * `insert`/`update`/`delete` own the `isDefault` invariant: if the written `record.isDefault` is `true`,
 * `insert`/`update` atomically clear `isDefault` on every OTHER row sharing `(workspaceId, vendorId)` in
 * the SAME transaction as the write, and `delete` promotes the group's most-recently-updated remaining
 * row if the deleted row WAS the default. The store's write path decides the VALUE of `isDefault`
 * (e.g. "first row for a vendor auto-defaults"); this port only guarantees the group-wide invariant
 * once that value is decided. A `null` default is still treated as "no default" defensively (e.g. a
 * hand-edited row). `delete` is a no-op for a missing row (the route's 204, idempotent). Collections
 * are small (bounded by how many connections a human saves), so no pagination/cap.
 *
 * `updateAccountLabel` is a TARGETED single-field write, deliberately not `update()`'s full-row
 * replace: healing an account label after a verify must never disturb `sealed`, `isDefault`,
 * `tokenTail`, or `updatedAt` (a verify is a read of the provider, not a change to the credential).
 * No-op for a missing row: the human-gated verify route has no reason to treat a row that vanished
 * mid-request as anything but "nothing to heal". */
export interface VendorCredentialSetRepoPort extends JiniVendorRepo {
  readonly vault?: VaultRepoPort;
  /** The project store this site's rows fall back to (`publish-credentials/store.ts`'s scope rule: site
   *  first, then project; new rows go to the project unless saved "only for this site"). Absent = site only. */
  readonly project?: VendorCredentialProjectScope;
}

/**
 * The project store's half of the vendor-credential store (owner 2026-10-25: keys save to the project
 * by default). The same repo shape over the project's own `secrets_vault`, opened with the project's
 * keyring and sealer, under the project's workspace id. Attached by the composition root only where a
 * project store opened; Fly/production has none (the project is the site there).
 */
export interface VendorCredentialProjectScope extends CredentialProjectHalf<VendorCredentialSetRepoPort> {}
