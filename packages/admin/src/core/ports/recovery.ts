/**
 * @file `AdminRecoveryPort` — point-in-time restore: what can be restored to, what would be lost,
 * and the restore ceremony itself.
 *
 * `AdminRestorePoint` is imported from `./database.js` rather than redeclared — see that file's
 * header for why Database and Recovery are two views onto one persisted set.
 *
 * ## The restore triad IS a `GatedOperation` — with operation-specific confirm/execute input
 *
 * `./database.js`'s `migrateForward` is the simple case: none of its three calls needs input
 * beyond the token the previous step produced. Restore needs two more fields —
 *
 * - `confirm` also carries `disclosureAcknowledged`: the operator must affirmatively accept the
 *   data-loss disclosure `computeRecoveryDisclosure` computed, not merely echo back a token; and
 * - `execute` also carries `restorePointId`: belt-and-suspenders against a confirmation token
 *   being replayed against a different target than the one it was confirmed for.
 *
 * `GatedOperation` carries `TConfirmInput`/`TExecuteInput` type parameters (defaulting to `string`)
 * for exactly this, so restore is declared as a real `GatedOperation` rather than three loose
 * methods. See `../gated/types.js` for the full rationale — in short, `disclosureAcknowledged`
 * shows the protocol is *recorded informed consent* rather than a two-step token handshake, and
 * restore is the most destructive operation a host exposes, so it is the last thing that should sit
 * outside the abstraction built for that ceremony.
 *
 * A first draft of this file argued the opposite, against an earlier `confirm(token: string)`
 * signature, and predicted the widening that has since happened. Kept as a note because the
 * inference was right: if a fourth ceremony needs something this shape still cannot express, that
 * is a signal about `GatedOperation`, not a reason for the caller to opt out of it.
 *
 * ## The deep-link envelope carries display continuity only, never authority
 *
 * `DatabaseContextEnvelope` (used by `resolveRecoveryDeepLink`) is how a panel preserves "which
 * restore point was I just looking at" across a navigation — e.g. a link from the database timeline
 * into recovery. A host must always re-verify `restorePointId` server-side rather than trusting the
 * envelope's contents as authorization; the envelope existing does not mean the operation it
 * references is still valid or still permitted for the caller presenting it.
 */
import type { AdminRestorePoint, RestorePointCostClass } from './database.js';
import type { GatedOperation } from '../gated/types.js';

/** A count that may be unknown rather than a real number — used where computing an exact count
 *  would be prohibitively expensive for at least one category. */
export type CategoryCount = number | "unknown";

/**
 * What would be lost or affected by restoring to a given point, broken down by category. `partial`
 * is always `true`: this is a best-effort disclosure, not a guarantee that no other consequence
 * exists — see `watermarkBaselineAvailable` for one specific case where the disclosure itself is
 * degraded.
 */
export interface AdminDisclosureResult {
  readonly partial: true;
  /** `false` means the disclosure could not establish a watermark baseline to diff against — the
   *  `counts` below may be less trustworthy than usual, and a panel should say so rather than
   *  present them with the same confidence as a normal disclosure. */
  readonly watermarkBaselineAvailable: boolean;
  readonly counts: Readonly<Record<string, CategoryCount>>;
}

/** Reasons the recovery feature itself may be degraded right now, independent of any one restore
 *  point — surfaced by `getRecoveryStatus` so a panel can explain *why* recovery is unavailable
 *  rather than just failing silently. */
export type DegradedBannerKind =
  | "migration-interrupted"
  | "pending-migration"
  | "operation-in-flight"
  | "cost-unavailable"
  | "watermark-baseline-unavailable";

export type DegradedBannerActionKind =
  | "deep-link-to-database-migration"
  | "unblock-interrupted-migration"
  | "none";

export interface AdminDegradedBanner {
  readonly kind: DegradedBannerKind;
  /** Pre-composed, host-owned copy — render as-is rather than deriving text from `kind`, for the
   *  same reason `GatedPlanResult.warnings` is rendered as-is (see `../gated/types.ts`). */
  readonly accessibleText: string;
  readonly actionKind: DegradedBannerActionKind;
}

export interface AdminRecoveryStatus {
  readonly costClass: RestorePointCostClass;
  readonly banner: AdminDegradedBanner | null;
}

/**
 * An opaque envelope a panel round-trips through a deep link to preserve display continuity across
 * navigation. Treat every field as informational — see the file header on why `restorePointId`
 * here is never authoritative.
 */
export interface DatabaseContextEnvelope {
  readonly v: number;
  readonly correlationId: string;
  readonly siteId: string;
  readonly ledgerEventId: string | null;
  readonly restorePointId: string | null;
  /** Host-defined description of how far the envelope's view of the world has drifted from
   *  current reality by the time it is resolved (e.g. `"none"`, `"stale"`). */
  readonly drift: string;
  /** What the envelope was created to let the operator do (e.g. `"view"`, `"restore"`). */
  readonly intent: string;
  readonly issuedAt: string;
}

export interface AdminRecoveryDeepLinkResult {
  readonly found: boolean;
  readonly restorePoint: { restorePointId: string; capturedAt: string } | null;
}

/**
 * What `restore.confirm` takes. The `token` comes from `restore.plan`'s `GatedPlanResult`.
 *
 * ## Adapter obligation: `token` is opaque, and a host may have to compose it
 *
 * Deliberately one opaque `token`, not the reference host's raw field pair. Its wire protocol
 * confirms a restore with `{planId, planHash}` — two fields — and its plan step returns them
 * separately. Exposing that pair here would contradict `GatedPlanResult.token`'s own contract
 * ("opaque; panels must not parse or construct these"): a panel assembling `planId` + `planHash`
 * into a confirm call *is* reconstructing the token, which is the thing that contract forbids.
 *
 * So the composition is the **route-factory adapter's** job, not the panel's: encode the host's
 * plan identity into one string on the way out of `plan`, decode it on the way into `confirm`. A
 * host whose protocol already uses a single token does nothing. This is the same division of labour
 * as `settings.ts`'s `value`, where the adapter owns any JSON encoding the wire format needs.
 *
 * Whoever writes the reference implementation's adapter: this is a real responsibility with no compiler support. Getting it
 * wrong surfaces as a confirm that is rejected server-side for a plan the operator can see on
 * screen — so encode both halves, and fail loudly on a token you cannot decode rather than sending
 * a partial one.
 */
export interface RestoreConfirmInput {
  readonly token: string;
  /**
   * Must be `true` — the operator has seen `computeRecoveryDisclosure`'s result and accepted it.
   *
   * A host must **reject** the confirm outright when this is `false`, not merely warn. This field
   * is the recorded-consent half of the ceremony; treating it as advisory turns the whole gated
   * protocol back into a confirmation dialog.
   */
  readonly disclosureAcknowledged: boolean;
}

/** What `restore.execute` takes. `confirmToken` comes from `restore.confirm`'s result. */
export interface RestoreExecuteInput {
  readonly confirmToken: string;
  /** Re-stated so the server can verify the token was confirmed for *this* target. A host must
   *  re-verify server-side rather than trusting the caller-supplied id. */
  readonly restorePointId: string;
}

/** `restore.execute`'s terminal result. */
export interface RestoreExecuteResult {
  readonly restoreRunId: string;
  /** Host-defined run state (e.g. `"completed"`, `"failed"`). */
  readonly state: string;
  readonly databaseTimelineDeepLink?: { v: 1; siteId: string; intent: "view" };
  /**
   * `true` when the restore physically swapped the underlying database and the server process
   * needs an operator-triggered restart to pick it up. Until restarted, the running process may
   * keep serving pre-restore data from an already-open file handle — a panel should surface this
   * as a required follow-up action, not a background detail.
   */
  readonly restartRequired?: boolean;
}

export interface AdminRecoveryPort {
  /** Same underlying set as `AdminDatabasePort.listDatabaseRestorePoints` — see the file header. */
  listRecoveryRestorePoints(): Promise<readonly AdminRestorePoint[]>;
  computeRecoveryDisclosure(restorePointId: string): Promise<AdminDisclosureResult>;
  /** Resolves a deep-link envelope back into a restore point reference. `found: false` means the
   *  envelope no longer resolves to anything (e.g. the restore point it named was since purged) —
   *  not an error, a valid negative result a panel should render distinctly from a thrown error. */
  resolveRecoveryDeepLink(envelope: DatabaseContextEnvelope): Promise<AdminRecoveryDeepLinkResult>;
  getRecoveryStatus(): Promise<AdminRecoveryStatus>;

  /**
   * The restore ceremony: `restore.plan(restorePointId)` -> `restore.confirm(...)` ->
   * `restore.execute(...)`. A real `GatedOperation`, so a shared confirmation component can drive
   * it without knowing it is a restore — see the file header.
   */
  readonly restore: GatedOperation<
    /* plan input    */ string,
    /* plan details  */ unknown,
    /* result        */ RestoreExecuteResult,
    /* confirm input */ RestoreConfirmInput,
    /* execute input */ RestoreExecuteInput
  >;
}
