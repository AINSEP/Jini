/** @file The legacy owner store's read contract, shared by the file wiring (`@jini-ai/server/owner-store`)
 * and the passphrase-backup decoder (`@jini-ai/platform/secrets/legacy-owner`): both produce this snapshot.
 */

/** A site the legacy store copied an entry to (consumerId = the site's canonical folder). */
export interface LegacyOwnerStoreDestination { entryId: string; consumerId: string }
/** grants: active copies. revocations: revoked copies whose site cleanup never finished. */
export interface LegacyOwnerStoreSnapshot<Entry> { entries: Entry[]; grants: LegacyOwnerStoreDestination[]; revocations: LegacyOwnerStoreDestination[] }
