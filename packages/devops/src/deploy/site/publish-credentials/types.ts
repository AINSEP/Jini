import type { DeployTargetDescriptor } from "../../target-contracts.js";
import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import type { ISODateTime, UUID } from "@jini-ai/core/primitives";

/**
 * @file Domain types for named, workspace-scoped provider connections used to publish a static
 * export to a host plugin's deploy target (the host's `publish_credential_sets` table).
 *
 * Purpose:
 * `PublishProviderId` is the ONE canonical provider-id type — `../static-publish/
 * types.ts`'s `StaticPublishTargetId` is a type ALIAS of it (not a second, independently
 * declared one), so the provider set can never drift between "what a credential can be saved for"
 * and "what a publish can target". This module owns the canonical declaration (not the other way
 * around) because a credential's provider identity is the more general, storage-shaped concept; a
 * one-shot publish operation borrows it, not the reverse.
 *
 * `PublishConnectionInput` is a CLOSED discriminated union on `providerId` — deliberately not an
 * open bag of optional fields, so a caller can never construct a connection with the wrong provider's
 * companion fields and have it silently ignored. Every host's required/optional split comes from
 * its plugin's descriptor (some need more than a bare token, e.g. an owner/repo or an account id,
 * HARD required — see `store.ts`'s `validateConnection`); other hosts' companion fields are
 * genuinely optional. Per-host notes on which stored companion fields a deploy target actually
 * reads live with the host plugin (its own `NOTES.md`).
 *
 * A companion field is accepted and stored here even when, as of this pass, the host's deploy
 * target has nowhere to send it once decrypted. Storing it anyway keeps this module's contract
 * stable for whichever side (this store, or a future deploy-target change) ships second — see `../static-publish/adapter.ts`'s header for where this gap is flagged again at
 * the point it would actually matter (wiring a real publish).
 *
 * Architectural role:
 * Domain types only — no I/O, no sealer/keyring dependency. `store.ts` is the one place a
 * `PublishConnectionInput` is validated, serialized, and sealed. Since the vendor-vault migration the
 * sealed connections are vendor vault rows, persisted through the host's `VendorCredentialSetRepoPort`
 * (which carries the `isDefault`/`updateAccountLabel` contract).
 */

/** A deploy target id (`DeployTargetDescriptor.id`) that takes a saved credential. Open: which ids
 *  exist is the deploy registry's business, validated where a connection is written (`store.ts`). */
export type PublishProviderId = DeployTargetDescriptor["id"];

/**
 * A saved connection: the target id plus the flat string fields that host's deploy-plugin descriptor
 * declares for its credential (`DeployTargetDescriptor.credential`), validated by `store.ts`. This
 * whole object is what gets serialized to JSON and sealed as ONE ciphertext blob per credential set
 * (never per-field columns — see the host schema's `publishCredentialSets` header for why). The shape is byte-compatible with rows sealed before hosts moved into the plugin: same
 * `providerId`, same field names.
 *
 * Publish-TARGET settings (a repository, a team) are never credential fields: they are chosen per
 * publish run and live on the publish config.
 */
export type PublishConnectionInput = { readonly providerId: PublishProviderId } & Readonly<Record<string, string>>;

/** The read model every route/tool in this feature returns — see `store.ts`'s `toSummary`. NEVER
 *  contains `sealed`, a token, or any `PublishConnectionInput` field — enforced by construction: this
 *  type has no field capable of carrying one. */
export interface PublishCredentialSummary {
  readonly credentialType: "vendor" | "custom";
  readonly worksFor: string[];
  readonly publishHosts: string[];
  readonly defaultFor: string[];
  readonly tokenHint?: CredentialTokenHint | null;
  readonly id: UUID;
  /** Display host: the first compatible target, or the stored vendor's editing host. */
  readonly providerId: PublishProviderId;
  /** Stored vendor group; custom NULL-provider keys use the display host's vendor. */
  readonly vendorId: string;
  readonly label: string;
  readonly configured: true;
  /** At most one `true` per vendor group, maintained by `store.ts`'s write path — see
   *  `VendorCredentialSetRepoPort`'s doc for the invariant. */
  readonly isDefault: boolean;
  /** Last 4 characters of the token field — see `vendor_credential_sets.token_tail`'s own doc. */
  readonly tokenTail: string;
  /** The verified account's public login, held in the clear (never sealed) — carried through
   *  unchanged, never re-derived here (this is a read model, it never decrypts or verifies anything).
   *  Create, a connection rotation or a vendor move reset it; only the verify heal
   *  (`healAccountLabel`) populates it. */
  readonly accountLabel: string | null;
  /** Where the row lives — present only where a project store is attached (local web + desktop):
   *  `"project"` is visible to attached sites only, `"site"` is this site's own (an override). */
  readonly scope?: PublishCredentialScope;
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

/** This site's own vault, or the project store every site of the project shares (`project.db`). */
export type PublishCredentialScope = "site" | "project";
