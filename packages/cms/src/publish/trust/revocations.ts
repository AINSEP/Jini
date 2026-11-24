import type { PublishTrustGrant } from "./grant.js";
import { isGrantActive } from "./grant.js";
import type { PublishTrustResolution } from "./provisioning.js";
import { findGrantForSource } from "./provisioning.js";

/**
 * @file Zero-setup publishing auth — disconnecting a computer, without a deploy.
 *
 * `provisioning.ts` carries GRANTS in committed config, which is what makes the feature need no key
 * ceremony. It also means a grant only changes when someone deploys, and that is not good enough for
 * revocation: "this computer must stop publishing here" cannot wait on a pipeline, a provider
 * console, or whoever happens to push next.
 *
 * So there are two stores, with a deliberate asymmetry:
 *
 * - **Committed config can only GRANT.** It ships inside the image, it is reviewable in a diff, and
 *   it is restored by a redeploy.
 * - **This store can only DENY.** Production persists it in the destination's content database,
 *   is written by the running process, and takes effect on the next request.
 *
 * Deny wins, and a redeploy cannot clear a denial because denials are not in the image. That single
 * property is what makes three separate claims true at once: revocation does not need a deploy,
 * revocation does not need provider access, and a ROLLBACK to an older commit cannot resurrect a
 * computer the owner disconnected — which the committed-config path on its own could not promise.
 *
 * FAIL-CLOSED HERE MEANS THE OPPOSITE OF `provisioning.ts`. An unreadable GRANT document must admit
 * nobody; an unreadable REVOCATION list must also admit nobody. Both stores fail towards "no
 * publishing", which means this one fails towards treating everyone as disconnected — see
 * {@link admitPublish}. Getting that backwards would turn a corrupt file into a bypass.
 *
 * The durable production adapter is deliberately selected by the composition root, over the same
 * `content.db` that holds the site's content. A deployment that loses that database has an obvious
 * content-loss outage; there is no second mount path whose omission can silently reconnect a
 * disconnected computer.
 */

/** Most disconnections one destination keeps. Bounded like every other document in this feature; a
 *  list longer than the machine list it shadows means something is appending in a loop. */
export const MAX_REVOCATIONS = 64;

/** Bound on the stored file, for the same reason the grant document has one. */
const MAX_DOCUMENT_BYTES = 16_384;

const MAX_FIELD_LENGTH = 512;

/** One computer the owner has disconnected from this site. Carries no key material: it names a
 *  source installation and when the owner said no. */
export interface PublishTrustRevocation {
  readonly sourceInstallationId: string;
  /** ISO-8601, for the admin list — "disconnected on the 3rd" is the question people actually ask. */
  readonly revokedAt: string;
  /** Optional plain-words reason, shown back to the owner. Never interpreted. */
  readonly note: string | null;
}

export type RevocationRead =
  | { readonly ok: true; readonly revocations: readonly PublishTrustRevocation[] }
  | { readonly ok: false; readonly reason: string };

export type RevocationWrite =
  | { readonly ok: true; readonly revocations: readonly PublishTrustRevocation[]; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Disconnecting and reconnecting a computer at the destination, effective immediately.
 *
 * Reconnecting is deliberately an explicit act rather than something a later publish or deploy can
 * do on its own. A revocation that could lapse by accident is not a revocation.
 * Production has no revocation-file path or environment override: its deny rows live in the site's
 * content database instead, so a missing second mount cannot silently reconnect a computer.
 */
export interface PublishTrustRevocationPort {
  list(): Promise<RevocationRead>;
  revoke(input: {
    readonly sourceInstallationId: string;
    readonly nowIso: string;
    readonly note?: string;
  }, optional?: {}): Promise<RevocationWrite>;
  restore(input: { readonly sourceInstallationId: string }, optional?: {}): Promise<RevocationWrite>;
}

/** @complexity O(1). */
function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}

/**
 * Parses the stored revocation list.
 *
 * Refuses the whole document on any bad element, like every other parser in this feature — and here
 * the consequence of refusing is that NOBODY publishes, which is the safe direction for a list whose
 * job is to say no.
 *
 * @complexity O(n) in the record count, bounded by {@link MAX_REVOCATIONS}.
 */
export function parseRevocationDocument({ text }: { text: string }, _optional = {}): RevocationRead {
  if (text.length > MAX_DOCUMENT_BYTES) return { ok: false, reason: `revocation list exceeds ${MAX_DOCUMENT_BYTES} bytes` };
  if (text.trim().length === 0) return { ok: true, revocations: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `revocation list is not valid JSON: ${(error as Error).message}` };
  }
  if (!Array.isArray(raw)) return { ok: false, reason: "revocation list must be a JSON array" };
  if (raw.length > MAX_REVOCATIONS) return { ok: false, reason: `revocation list holds more than ${MAX_REVOCATIONS} records` };

  const revocations: PublishTrustRevocation[] = [];
  for (const entry of raw) {
    const revocation = parseRevocationEntry({ entry });
    if (typeof revocation === "string") return { ok: false, reason: revocation };
    revocations.push(revocation);
  }
  return { ok: true, revocations };
}

/**
 * Validates one stored record in a fixed order — object, id, date, note — keeping only those three
 * fields; an absent or null note becomes `null`.
 *
 * @returns The record, or a reason string.
 * @complexity O(1) — every string is bounded by `MAX_FIELD_LENGTH`.
 */
function parseRevocationEntry({ entry }: { entry: unknown }, _optional = {}): PublishTrustRevocation | string {
  if (typeof entry !== "object" || entry === null) return "each revocation must be an object";
  const { sourceInstallationId, revokedAt, note } = entry as Record<string, unknown>;
  if (!isBoundedString(sourceInstallationId)) return "each revocation needs a 'sourceInstallationId'";
  if (!isBoundedString(revokedAt) || Number.isNaN(Date.parse(revokedAt))) {
    return "each revocation needs an ISO-8601 'revokedAt'";
  }
  const noteRefusal = refuseNote({ note });
  if (noteRefusal !== undefined) return noteRefusal;
  return { sourceInstallationId, revokedAt, note: typeof note === "string" ? note : null };
}

/** The reason a stored record's optional `note` is invalid, or `undefined` when absent, null or fine. @complexity O(1). */
function refuseNote({ note }: { note: unknown }, _optional = {}): string | undefined {
  if (note !== undefined && note !== null && !isBoundedString(note)) {
    return "a revocation 'note' must be a non-empty string when present";
  }
  return undefined;
}

/**
 * True when `sourceInstallationId` has been disconnected.
 *
 * @complexity O(n) in the record count.
 */
export function isRevoked(
  { revocations, sourceInstallationId }: { revocations: readonly PublishTrustRevocation[]; sourceInstallationId: string },
  _optional = {}
): boolean {
  return revocations.some((r) => r.sourceInstallationId === sourceInstallationId);
}

// ---------------------------------------------------------------------------
// The one admission decision
// ---------------------------------------------------------------------------

export type AdmissionRefusal =
  | "site-not-configured"
  | "not-connected"
  | "disconnected"
  | "expired"
  | "superseded-key"
  | "revocations-unreadable";

export type PublishAdmission =
  | { readonly allowed: true; readonly grant: PublishTrustGrant }
  | { readonly allowed: false; readonly refusal: AdmissionRefusal; readonly message: string };

/** Ordinary words for each refusal. No key vocabulary, no identifiers, no error codes — the owner is
 *  not a developer and must never be shown one of these as a string like
 *  "no accepted public key for the claimed generation".
 *  @complexity O(1). */
function refusalMessage(
  { refusal, siteLabel }: { refusal: Exclude<AdmissionRefusal, never>; siteLabel: string },
  _optional = {}
): string {
  switch (refusal) {
    case "site-not-configured":
      return `${siteLabel} isn't set up to accept published changes yet.`;
    case "not-connected":
      return `${siteLabel} doesn't recognise this computer yet. Connect it once and publishing will work — there's nothing to copy and no key to keep.`;
    case "disconnected":
      return `This computer was disconnected from ${siteLabel}. Reconnect it on ${siteLabel} to publish from here again.`;
    case "expired":
      return `This computer's connection to ${siteLabel} has run out. Reconnect it to carry on publishing.`;
    case "superseded-key":
      return `${siteLabel} is still set up for this computer's previous sign-in. This happens right after the Site key is regenerated — reconnect and deploy once to finish the change.`;
    case "revocations-unreadable":
      return `${siteLabel} can't check which computers are allowed to publish right now, so it isn't accepting changes. This clears once the site is healthy again.`;
    default:
      return undefined as never;
  }
}

/**
 * The single question the destination asks on a publish: may THIS computer, presenting THIS key,
 * publish here right now?
 *
 * Composes the two stores with deny winning. Deliberately says nothing about routes: the reachable
 * method+path set is owned by `grant.ts`'s `PUBLISH_TRUST_ROUTES` and must never be carried by a
 * credential, a session, or this decision — a surface that can name its own routes can widen itself.
 *
 * @param input - `revocations` is the ALREADY-READ list, or `null` when the list could not be read.
 *   `null` refuses: a destination that cannot tell whether a computer was disconnected must assume
 *   it was.
 * @returns The grant to authorise against, or a refusal with a sentence fit to show a person.
 * @complexity O(n) in the grant and revocation counts; both are small bounded lists.
 */
export function admitPublish(input: {
  readonly resolution: PublishTrustResolution;
  readonly revocations: readonly PublishTrustRevocation[] | null;
  readonly sourceInstallationId: string;
  readonly publicKeyB64u: string;
  readonly siteLabel: string;
  readonly nowIso: string;
}, _optional = {}): PublishAdmission {
  const refuse = (refusal: AdmissionRefusal): PublishAdmission => ({
    allowed: false,
    refusal,
    message: refusalMessage({ refusal, siteLabel: input.siteLabel }),
  });

  // Deny first, and before anything that could throw or short-circuit: a disconnected computer must
  // be refused even while the grant side of the config is broken or absent.
  if (input.revocations === null) return refuse("revocations-unreadable");
  if (isRevoked({ revocations: input.revocations, sourceInstallationId: input.sourceInstallationId })) return refuse("disconnected");

  if (input.resolution.state !== "configured") return refuse("site-not-configured");
  const grant = findGrantForSource({ res: input.resolution, sourceInstallationId: input.sourceInstallationId });
  if (grant === null) return refuse("not-connected");
  if (!isGrantActive({ grant, nowIso: input.nowIso })) return refuse("expired");
  if (!grant.publicKeys.some((k) => k.publicKeyB64u === input.publicKeyB64u)) return refuse("superseded-key");

  return { allowed: true, grant };
}

// ---------------------------------------------------------------------------
// The edits the in-memory adapter applies
// ---------------------------------------------------------------------------

/** One whole-list edit for the in-memory adapter. */
type RevocationEdit = (current: readonly PublishTrustRevocation[]) => readonly PublishTrustRevocation[];

/**
 * The revoke edit: append a record unless the computer is already listed, so a repeat disconnect
 * keeps the FIRST timestamp and note.
 *
 * @complexity O(n) in the record count.
 */
function revokeEdit({ sourceInstallationId, nowIso, note }: Parameters<PublishTrustRevocationPort["revoke"]>[0]): RevocationEdit {
  return (current) =>
    isRevoked({ revocations: current, sourceInstallationId })
      ? current
      : [...current, { sourceInstallationId, revokedAt: nowIso, note: note ?? null }];
}

/** The restore edit: drop every record for the computer. @complexity O(n) in the record count. */
function restoreEdit({ sourceInstallationId }: Parameters<PublishTrustRevocationPort["restore"]>[0]): RevocationEdit {
  return (current) => current.filter((revocation) => revocation.sourceInstallationId !== sourceInstallationId);
}

/**
 * Applies `edit` to `current` under {@link MAX_REVOCATIONS}: the refusal, or the next list and
 * whether it differs from `current`. Pure — the adapter decides whether and where to persist.
 *
 * @complexity O(n) in the record count (the edit and one JSON comparison).
 */
function planEdit({ current, edit }: {
  current: readonly PublishTrustRevocation[];
  edit: RevocationEdit;
}): { ok: false; reason: string } | { ok: true; next: readonly PublishTrustRevocation[]; changed: boolean } {
  const next = edit(current);
  if (next.length > MAX_REVOCATIONS) {
    return { ok: false, reason: `this site already lists ${MAX_REVOCATIONS} disconnected computers` };
  }
  return { ok: true, next, changed: JSON.stringify(next) !== JSON.stringify(current) };
}

/**
 * Hermetic half of the revocation-store rule of two. The running server uses the SQLite adapter;
 * this tiny process-local store lets the filesystem-free composition root keep exercising the same
 * read/write port without manufacturing a pretend database path.
 */
export function createInMemoryRevocations(): PublishTrustRevocationPort {
  let current: readonly PublishTrustRevocation[] = [];

  const list = async (): Promise<RevocationRead> => ({ ok: true, revocations: current });
  const applyEdit = async (edit: RevocationEdit): Promise<RevocationWrite> => {
    const plan = planEdit({ current, edit });
    if (!plan.ok) return plan;
    if (plan.changed) current = plan.next;
    return { ok: true, revocations: current, changed: plan.changed };
  };

  return {
    list,
    revoke: (input) => applyEdit(revokeEdit(input)),
    restore: (input) => applyEdit(restoreEdit(input)),
  };
}
