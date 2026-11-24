/**
 * @file Zero-setup publishing auth — provisioning: how a grant reaches the destination.
 * Design note: `ADS-memory/reports/2026-09-19-publish-zero-setup-auth-design.md`.
 *
 * `grant.ts` defines WHAT the destination trusts. This file defines HOW that document gets there,
 * and it is the whole reason the feature needs no key ceremony: a grant is secret-free, so it can
 * travel as **committed deploy config** — a file in the repo, or a plain env var — instead of
 * through a secret store, a vendor CLI, or a human copying a value between two browser tabs.
 *
 * THE VENDOR-NEUTRALITY RULE, and how it is enforced structurally rather than by discipline:
 * there is no provider branch anywhere in this feature. A provider is a {@link ProvisioningCodec} —
 * "where in this file does the value live, and how is it quoted" — handed to the one
 * {@link createFileProvisioning} flow that every adapter shares. A hosting platform's config file is
 * a codec, not an `if`; adding one is a new codec and no change to this file (the committed-JSON
 * codec below is the one shipped today). Nothing here imports a provider SDK, and nothing here shells out; the whole
 * port is `read a file, decode, merge, encode, write a file`, which is why it works identically on
 * a laptop, in CI, and on a machine that has never heard of the provider.
 *
 * TWO READ PATHS THAT MUST NOT BE CONFUSED:
 *
 * - {@link PublishTrustProvisioningPort.readProvisioned} answers "what does the REPO carry" — the
 *   source machine's question, asked before it offers to connect or disconnect.
 * - {@link resolvePublishTrust} answers "what does THIS RUNNING INSTALL see" — the destination's
 *   question, asked once at boot. It consults the env var first and the committed file second, and
 *   that precedence is load-bearing: it is the only way an operator who still has the provider
 *   console but has lost repository access can switch publishing off. See {@link resolvePublishTrust}.
 *
 * FAIL-CLOSED, BUT NEVER BOOT-BLOCKING. A malformed grant document disables publishing and says why;
 * it does not refuse to start the site. A site is not worth taking down over a feature it may not
 * even use, and `state: "invalid"` carries no grants, so the failure mode is "nobody may publish",
 * never "anybody may".
 */

import type { PublishTrustGrant } from "./grant.js";
import { parsePublishTrustGrant } from "./grant.js";

/** Repo-relative home of the committed grant document for the default (provider-agnostic) adapter.
 *  In a container image that copies the repository to its runtime working directory, a
 *  repo-root-relative path is also the deployed path. Callers pass an absolute path; this module never guesses one from `cwd`. */
export const PUBLISH_TRUST_CONFIG_PATH = "deploy/publish-trust.json";

/** Most sources one destination may accept. One entry per computer the owner publishes from; a
 *  longer list means provisioning is appending where it should be replacing, which is a bug worth
 *  failing on rather than absorbing. */
export const MAX_PROVISIONED_GRANTS = 8;

/** Bound on the whole document, so a malformed or hostile publish-trust env value cannot be a memory
 *  amplifier before `grant.ts`'s own per-field bounds get a chance to apply. Eight maximal grants
 *  are comfortably under this. */
const MAX_DOCUMENT_BYTES = 16_384;

/** How long a freshly written grant stays valid.
 *
 *  Long on purpose. The expiry exists as the LAST-RESORT revocation path for the case where both
 *  deliberate ones are gone (no repository access and no provider console) — not as a renewal
 *  ritual. Every provisioning write re-stamps it, so reconnecting or rotating renews it for free,
 *  and {@link describeConnection} warns {@link RENEWAL_WARNING_DAYS} ahead rather than letting
 *  publishing stop without notice. */
export const GRANT_LIFETIME_DAYS = 365;

/** How far ahead of `notAfter` the source starts saying "renew this on your next deploy". */
export const RENEWAL_WARNING_DAYS = 30;

export const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// The document: a LIST of grants, never one
// ---------------------------------------------------------------------------

/**
 * A parsed grant document. Never a partially-valid list: one bad element rejects the document, for
 * the same reason `grant.ts` refuses to repair a grant — a document that degrades into a valid
 * subset hides the fact that something in it was wrong.
 */
export type GrantDocumentParse =
  | { readonly ok: true; readonly grants: readonly PublishTrustGrant[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Parses the serialised grant document.
 *
 * The document is a LIST keyed by `sourceInstallationId`, not a single grant. A single grant object
 * is still accepted, because the design note describes the value that way and an early install may
 * carry one — but a second computer provisioning against a single-grant document must ADD to it,
 * not overwrite it, or connecting a desktop would silently disconnect the laptop.
 *
 * Whitespace-only input is an empty list, not an error: an untouched file and a deliberately
 * emptied one are told apart by {@link resolvePublishTrust}, which knows where the text came from.
 *
 * @returns Every grant in document order, or the reason the document was refused.
 * @complexity O(n²) in the grant count for the duplicate scan, bounded by
 *   {@link MAX_PROVISIONED_GRANTS} — a pairwise scan reads clearer than a set at eight elements.
 */
export function parseGrantDocument({ text }: { text: string }, _optional = {}): GrantDocumentParse {
  if (text.length > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: `grant document exceeds ${MAX_DOCUMENT_BYTES} bytes` };
  }
  if (text.trim().length === 0) return { ok: true, grants: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `grant document is not valid JSON: ${(error as Error).message}` };
  }

  const entries = Array.isArray(raw) ? raw : [raw];
  if (entries.length > MAX_PROVISIONED_GRANTS) {
    return { ok: false, reason: `grant document holds more than ${MAX_PROVISIONED_GRANTS} grants` };
  }

  const grants: PublishTrustGrant[] = [];
  for (const entry of entries) {
    const parsed = parsePublishTrustGrant({ raw: entry });
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    if (grants.some((g) => g.sourceInstallationId === parsed.grant.sourceInstallationId)) {
      return { ok: false, reason: `grant document repeats source installation ${parsed.grant.sourceInstallationId}` };
    }
    grants.push(parsed.grant);
  }
  return { ok: true, grants };
}

/**
 * Serialises grants for storage.
 *
 * Always writes an array, even for one grant, so the file's shape never changes when a second
 * computer is connected — a committed file whose top-level type flips produces a confusing diff at
 * exactly the moment someone is trying to understand what changed.
 *
 * @param grants - Grants to write, in the order they should appear.
 * @param options - `pretty` produces the indented form a committed file deserves in a git diff;
 *   compact is for codecs that must fit the value on one line (a TOML or dotenv assignment).
 * @complexity O(n) in the grant count.
 */
export function serializeGrantDocument(
  { grants, options }: {
    grants: readonly PublishTrustGrant[];
    options: { readonly pretty: boolean };
  },
  _optional = {}
): string {
  return options.pretty ? `${JSON.stringify(grants, null, 2)}\n` : JSON.stringify(grants);
}

/** Outcome of a list edit. `changed: false` means the write was a no-op and the caller has nothing
 *  to commit — worth saying out loud rather than inviting an empty commit. */
export type GrantListEdit =
  | { readonly ok: true; readonly grants: readonly PublishTrustGrant[]; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Merges `incoming` into `existing`, keyed by `sourceInstallationId`.
 *
 * REPLACES the matching source and leaves every other source untouched. Overwriting the whole list
 * would mean connecting a second computer silently revokes the first — the failure this list shape
 * exists to prevent.
 *
 * @complexity O(n) in the existing grant count.
 */
export function mergeGrant({ existing, incoming }: { existing: readonly PublishTrustGrant[]; incoming: PublishTrustGrant }, _optional = {}): GrantListEdit {
  const index = existing.findIndex((g) => g.sourceInstallationId === incoming.sourceInstallationId);
  if (index >= 0) {
    const grants = existing.map((g, i) => (i === index ? incoming : g));
    const changed = JSON.stringify(existing[index]) !== JSON.stringify(incoming);
    return { ok: true, grants, changed };
  }
  if (existing.length >= MAX_PROVISIONED_GRANTS) {
    return { ok: false, reason: `this site already accepts ${MAX_PROVISIONED_GRANTS} computers; disconnect one first` };
  }
  return { ok: true, grants: [...existing, incoming], changed: true };
}

/**
 * Removes one source's grant.
 *
 * Removing a source that is not there is a successful no-op with `changed: false`, not an error:
 * the caller asked for a state ("this computer cannot publish here"), and that state already holds.
 *
 * @complexity O(n) in the existing grant count.
 */
export function removeGrant(
  { existing, sourceInstallationId }: { existing: readonly PublishTrustGrant[]; sourceInstallationId: string },
  _optional = {}
): GrantListEdit {
  const grants = existing.filter((g) => g.sourceInstallationId !== sourceInstallationId);
  return { ok: true, grants, changed: grants.length !== existing.length };
}

/**
 * The `notAfter` a grant written now should carry.
 *
 * @complexity O(1).
 */
export function grantNotAfterFrom(
  { nowIso }: { nowIso: string },
  { lifetimeDays }: { readonly lifetimeDays?: number } = {}
): string {
  const days = lifetimeDays ?? GRANT_LIFETIME_DAYS;
  return new Date(Date.parse(nowIso) + days * MS_PER_DAY).toISOString();
}

// ---------------------------------------------------------------------------
// The destination's boot-time read
// ---------------------------------------------------------------------------

export type PublishTrustState = "configured" | "absent" | "revoked" | "invalid";

/** What this running install sees. `grants` is empty unless `state === "configured"`, so a caller
 *  that reads `grants` without checking `state` still fails closed. */
export interface PublishTrustResolution {
  readonly state: PublishTrustState;
  /** Which input the answer came from, for a boot log that can be acted on. */
  readonly origin: "env" | "file" | "none";
  readonly grants: readonly PublishTrustGrant[];
  /** Why, when the state is `invalid`. Always about the DOCUMENT, never about a live credential. */
  readonly reason: string | null;
}

/** The ONLY constructor that puts grants in a resolution, which is what makes "nothing but
 *  `configured` can authorise anything" a property of the type rather than of a guard someone has
 *  to remember to write.
 *  @complexity O(1). */
function configured(
  { origin, grants }: { origin: "env" | "file"; grants: readonly PublishTrustGrant[] },
  _optional = {}
): PublishTrustResolution {
  return { state: "configured", origin, grants, reason: null };
}

/** @complexity O(1). */
function withoutGrants(
  { state, origin }: { state: Exclude<PublishTrustState, "configured">; origin: PublishTrustResolution["origin"] },
  { reason = null }: { reason?: string | null } = {}
): PublishTrustResolution {
  return { state, origin, grants: [], reason };
}

/** @complexity O(n) in the document's grant count. */
function resolveText(
  { text, origin, emptyState }: { text: string; origin: "env" | "file"; emptyState: Exclude<PublishTrustState, "configured"> },
  _optional = {}
): PublishTrustResolution {
  if (text.trim().length === 0) return withoutGrants({ state: emptyState, origin });
  const parsed = parseGrantDocument({ text });
  if (!parsed.ok) return withoutGrants({ state: "invalid", origin }, { reason: parsed.reason });
  if (parsed.grants.length === 0) return withoutGrants({ state: "revoked", origin });
  return configured({ origin, grants: parsed.grants });
}

/**
 * Resolves what this install accepts publishes from, at boot.
 *
 * PRECEDENCE — env over file, and it is deliberate. The committed file is the normal channel: it
 * needs no provider console and survives a provider token being rotated or revoked. The env var
 * exists so that an operator who has the provider console but NOT the repository can still switch
 * publishing off, by setting the host's publish-trust env var to an empty value. If the file won ties, that
 * operator would have no kill switch at all. This is the mechanism behind the claim that revoking
 * publishing and revoking provider access are independent in both directions:
 *
 * - Revoke publishing WITHOUT provider access: edit the committed file, commit, deploy.
 * - Revoke publishing WITH ONLY provider access: set the env var empty; it overrides the file.
 * - Revoke PROVIDER access without touching publishing: nothing in this path reads a provider
 *   credential — the inputs are an env value and a file's text — so publishing is unaffected.
 *
 * Pure: the caller does the reading, so the whole precedence rule is testable without a filesystem
 * or a process env.
 *
 * @param input - `envValue` is `undefined` when the variable is unset and `""` when it is set but
 *   empty; those mean different things here and must not be collapsed by the caller. `fileContents`
 *   is `null` when the file does not exist.
 * @complexity O(n) in the document's grant count.
 */
export function resolvePublishTrust(input: {
  readonly envValue: string | undefined;
  readonly fileContents: string | null;
}, _optional = {}): PublishTrustResolution {
  if (input.envValue !== undefined) return resolveText({ text: input.envValue, origin: "env", emptyState: "revoked" });
  if (input.fileContents !== null) return resolveText({ text: input.fileContents, origin: "file", emptyState: "absent" });
  return withoutGrants({ state: "absent", origin: "none" });
}

/**
 * The grant for one source, or `null`.
 *
 * The `state` check guards the MODULE BOUNDARY, not this file's own paths: {@link resolvePublishTrust}
 * already cannot produce grants outside `configured`. It is here because callers — a middleware, a
 * test double — build `PublishTrustResolution` values of their own, and a caller who sets a
 * plausible-looking `state: "invalid"` beside a leftover `grants` array must still be refused.
 *
 * @complexity O(n) in the resolved grant count.
 */
export function findGrantForSource(
  { res, sourceInstallationId }: { res: PublishTrustResolution; sourceInstallationId: string },
  _optional = {}
): PublishTrustGrant | null {
  if (res.state !== "configured") return null;
  return res.grants.find((g) => g.sourceInstallationId === sourceInstallationId) ?? null;
}

// ---------------------------------------------------------------------------
// The port, and the one flow every adapter shares
// ---------------------------------------------------------------------------

/** Where an adapter puts the grant, in terms an operator can act on. */
export interface ProvisioningTarget {
  /** Stable machine-readable adapter name, e.g. `"committed-json"`. */
  readonly kind: string;
  /** Absolute path of the config file this adapter edits. */
  readonly path: string;
  /** The one sentence to show after a successful write. */
  readonly nextStep: string;
}

/** The file access a provisioning adapter needs, as a seam — so every adapter is testable without
 *  a filesystem, and so nothing in this feature reaches for `node:fs` on its own. */
export interface ProvisioningFileIo {
  /** File contents, or `null` when the file does not exist. */
  read(required: { path: string }, optional?: Record<string, never>): Promise<string | null>;
  write(required: { path: string; contents: string }, optional?: Record<string, never>): Promise<void>;
}

/** Instrumentation seam for the only I/O this feature performs (Constitution Article VIII). The
 *  composition root decides what a log line is; this module only announces what it did. */
export type ProvisioningEvent =
  | { readonly kind: "read"; readonly target: ProvisioningTarget; readonly grants: number }
  | { readonly kind: "write"; readonly target: ProvisioningTarget; readonly grants: number; readonly changed: boolean }
  | { readonly kind: "error"; readonly target: ProvisioningTarget; readonly reason: string };

export type ProvisionedRead =
  | { readonly ok: true; readonly grants: readonly PublishTrustGrant[] }
  | { readonly ok: false; readonly reason: string };

export type ProvisioningWrite =
  | {
      readonly ok: true;
      readonly grants: readonly PublishTrustGrant[];
      /** `false` when the config already said this — nothing to commit, nothing to deploy. */
      readonly changed: boolean;
      readonly target: ProvisioningTarget;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Getting a grant into (and out of) the deploy config the destination will boot with.
 *
 * Deliberately NOT a "deploy" port: it edits a file the operator commits, and stops. Provisioning
 * that could deploy on its own would need provider credentials on the developer's machine, which
 * is exactly the dependency this design exists to avoid.
 */
export interface PublishTrustProvisioningPort {
  readonly target: ProvisioningTarget;
  /** What the repo's deploy config carries today. */
  readProvisioned(): Promise<ProvisionedRead>;
  /** Add or replace one source's grant, leaving every other source untouched. */
  connect(input: { readonly grant: PublishTrustGrant }, optional?: {}): Promise<ProvisioningWrite>;
  /** Remove one source's grant. */
  disconnect(input: { readonly sourceInstallationId: string }, optional?: {}): Promise<ProvisioningWrite>;
}

/**
 * How one provider's config file carries the grant document.
 *
 * This is the ONLY thing that differs between providers, which is why there is no provider branch
 * anywhere above: a codec says where the value lives inside a file and how it is quoted, and
 * {@link createFileProvisioning} does the rest identically for all of them.
 */
export interface ProvisioningCodec {
  readonly kind: string;
  /** Repo-relative conventional path, for callers that have not chosen one. */
  readonly defaultPath: string;
  /** Compact JSON when the format needs the value on a single line. */
  readonly pretty: boolean;
  readonly nextStep: string;
  /** Extract the grant document from the config file's text; `null` when it carries none. */
  decode(required: { fileContents: string | null }, optional?: Record<string, never>): string | null;
  /** Put `document` back, preserving everything else in the file. */
  encode(input: { readonly fileContents: string | null; readonly document: string }, optional?: {}):
    | { readonly ok: true; readonly contents: string }
    | { readonly ok: false; readonly reason: string };
}

/** The whole grant document IS the file. The provider-agnostic default: a committed JSON file
 *  needs no provider format, no secret store and no console, so it is the one adapter that works
 *  on a bare VPS as readily as on a managed platform. */
export const COMMITTED_JSON_CODEC: ProvisioningCodec = {
  kind: "committed-json",
  defaultPath: PUBLISH_TRUST_CONFIG_PATH,
  pretty: true,
  nextStep: `Commit ${PUBLISH_TRUST_CONFIG_PATH} and deploy. It holds public keys only — there is nothing secret in it.`,
  decode: ({ fileContents }) => fileContents,
  encode: ({ document }) => ({ ok: true, contents: document }),
};

/**
 * Builds a provisioning port over one config file.
 *
 * Every adapter in this feature is this function plus a codec. Keeping the read/decode/parse/edit/
 * encode/write sequence in one place means a provider cannot accidentally get different merge
 * semantics from another — the bug that would show up as "connecting my desktop disconnected my
 * laptop, but only on the hosted server".
 *
 * @param deps - `path` overrides the codec's conventional location; callers pass an absolute path.
 * @complexity O(n) in the provisioned grant count per call; one file read and at most one write.
 */
export function createFileProvisioning(deps: {
  readonly io: ProvisioningFileIo;
  readonly codec: ProvisioningCodec;
  readonly path: string;
  readonly onEvent?: (event: ProvisioningEvent) => void;
}, _optional = {}): PublishTrustProvisioningPort {
  const { io, codec, path, onEvent } = deps;
  const target: ProvisioningTarget = { kind: codec.kind, path, nextStep: codec.nextStep };
  const file: ProvisioningFile = { io, codec, path, target, ...(onEvent ? { onEvent } : {}) };

  return {
    target,
    readProvisioned: () => readProvisionedGrants({ file }),
    connect: ({ grant }) => applyGrantEdit({ file, edit: (grants) => mergeGrant({ existing: grants, incoming: grant }) }),
    disconnect: ({ sourceInstallationId }) => applyGrantEdit({ file, edit: (grants) => removeGrant({ existing: grants, sourceInstallationId }) }),
  };
}

/** The one config file a provisioning port works on. Every field is fixed when the port is built,
 *  so the functions below read nothing that can change between two calls on the same port. */
interface ProvisioningFile {
  readonly io: ProvisioningFileIo;
  readonly codec: ProvisioningCodec;
  readonly path: string;
  readonly target: ProvisioningTarget;
  readonly onEvent?: (event: ProvisioningEvent) => void;
}

/** Decodes and parses the grant document out of the file's text; a parse failure is reported as an
 *  event and returned, never thrown. @complexity O(n) in the document length. */
function grantsInFile({ file, fileContents }: { file: ProvisioningFile; fileContents: string | null }, _optional = {}): ProvisionedRead {
  const parsed = parseGrantDocument({ text: file.codec.decode({ fileContents }) ?? "" });
  if (!parsed.ok) {
    file.onEvent?.({ kind: "error", target: file.target, reason: parsed.reason });
    return { ok: false, reason: parsed.reason };
  }
  return { ok: true, grants: parsed.grants };
}

/** Reads the provisioned grants and reports the read. @complexity One file read, O(n) parse. */
async function readProvisionedGrants({ file }: { file: ProvisioningFile }, _optional = {}): Promise<ProvisionedRead> {
  const current = grantsInFile({ file, fileContents: await file.io.read({ path: file.path }) });
  if (current.ok) file.onEvent?.({ kind: "read", target: file.target, grants: current.grants.length });
  return current;
}

/** Applies one edit to the grant list: read, decode, parse, edit, encode, write. An edit that
 *  changes nothing writes nothing. @complexity One file read and at most one write. */
async function applyGrantEdit({ file, edit }: {
  file: ProvisioningFile;
  edit: (grants: readonly PublishTrustGrant[]) => GrantListEdit;
}, _optional = {}): Promise<ProvisioningWrite> {
  const { io, codec, path, target, onEvent } = file;
  // One read, reused for both the parse and the re-encode: reading twice could decode one
  // version of the file and write its edit back into another.
  const fileContents = await io.read({ path });
  const current = grantsInFile({ file, fileContents });
  if (!current.ok) return current;

  const next = edit(current.grants);
  if (!next.ok) {
    onEvent?.({ kind: "error", target, reason: next.reason });
    return next;
  }
  if (!next.changed) {
    onEvent?.({ kind: "write", target, grants: next.grants.length, changed: false });
    return { ok: true, grants: next.grants, changed: false, target };
  }

  const encoded = codec.encode({
    fileContents,
    document: serializeGrantDocument({ grants: next.grants, options: { pretty: codec.pretty } }),
  });
  if (!encoded.ok) {
    onEvent?.({ kind: "error", target, reason: encoded.reason });
    return encoded;
  }
  await io.write({ path, contents: encoded.contents });
  onEvent?.({ kind: "write", target, grants: next.grants.length, changed: true });
  return { ok: true, grants: next.grants, changed: true, target };
}
