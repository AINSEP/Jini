import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import { ToolInputError } from '@jini-ai/core';
import type { CredentialStoreErrorClasses } from '../credential-routes-shared.js';

export function knownPublishCredentialListRefusal({ err, storeErrors }: { err: unknown; storeErrors: CredentialStoreErrorClasses }, _optional = {}): { status: number; body: { error: string; detail: string } } | undefined {
  if (err instanceof ToolInputError) return { status: 409, body: { error: 'KEY_IN_USE', detail: err.message } };
  const rows: [abstract new (...args: never[]) => Error, number, string][] = [
    [storeErrors.validation, 400, 'VALIDATION'],
    [storeErrors.duplicateLabel, 409, 'DUPLICATE_LABEL'],
    [storeErrors.notFound, 404, 'NOT_FOUND'],
    [storeErrors.secretStoreUnconfigured, 503, 'SECRET_STORE_UNCONFIGURED'],
  ];
  const row = rows.find(([type]) => err instanceof type);
  return row ? { status: row[1], body: { error: row[2], detail: (err as Error).message } } : undefined;
}

interface PublishCredentialSummary {
  readonly credentialType: "vendor" | "custom";
  readonly worksFor: string[];
  readonly publishHosts: string[];
  readonly defaultFor: string[];
  readonly tokenHint?: CredentialTokenHint | null;
  readonly id: string;
  /** Display host: the first compatible target, or the stored vendor's editing host. */
  readonly providerId: string;
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
  readonly scope?: "site" | "project";
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `GET` the credentials + execution mode, then fire the account-label heal after the response. */
export async function listPublishCredentialsReply({ deps }: { deps: {
  list: () => Promise<PublishCredentialSummary[]>;
  executionMode: () => string;
  json: (body: { credentials: PublishCredentialSummary[]; executionMode: string }) => void;
  triggerAccountLabelHeal: (credentials: readonly PublishCredentialSummary[]) => Promise<void>;
} }, _optional = {}): Promise<void> {
  const credentials = await deps.list();
  deps.json({ credentials, executionMode: deps.executionMode() });
  // Fires AFTER the response is already sent, and only for rows THIS call itself found still
  // `null` — never awaited, never able to change or delay what the caller above just received.
  // `accountLabelHealScheduler.triggerFor` is documented to never throw or reject, even if `heal`
  // misbehaves (`account-label-heal-scheduler.ts`'s own tests cover that directly) — see this
  // file's header for why this is the one new trigger point and why it must stay exactly this
  // narrow.
  void deps.triggerAccountLabelHeal(credentials);
}
