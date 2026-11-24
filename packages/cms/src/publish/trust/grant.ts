/**
 * @file Zero-setup publishing auth — the grant document.
 * Design note: `ADS-memory/reports/2026-09-19-publish-zero-setup-auth-design.md`.
 *
 * A grant is what the DESTINATION knows: which source installation may publish here, which public
 * keys currently speak for it, what it may touch, and until when. It is secret-free by
 * construction — every field below is either a public key, an identifier, or a policy bound — which
 * is what lets it travel as committed deploy config on any provider without a secret store, a
 * vendor CLI, or a human copying anything.
 *
 * TWO INDEPENDENT CEILINGS, and why neither alone is enough:
 *
 * - {@link PUBLISHING_CAPABILITIES} is a CLOSED allowlist this file owns. A grant that names any
 *   other capability — `content.write`, `admin.*`, `*` — is rejected at parse time, not filtered.
 *   This is the direct answer to Codex's finding that publishing rides the general auth path on
 *   ordinary `content.write`: a stolen publishing credential cannot reach `POST /posts`, because no
 *   grant claiming the capability that route needs can ever parse.
 * - {@link PUBLISH_TRUST_ROUTES} is likewise owned here, NOT by the grant. A grant cannot widen the
 *   route surface even by naming one, because it has no field to name one with. A route added to
 *   this codebase tomorrow is absent from this list, so it is unreachable by a publishing
 *   credential until someone deliberately adds it here — fail-closed against future growth, which
 *   an allowlist that lived in the credential could not be.
 *
 * Rejection is total: {@link parsePublishTrustGrant} returns a reason, never a repaired grant. A
 * parser that "fixed up" a grant would let a malformed or hostile document degrade into a valid one.
 */

/** The ONLY capabilities a publishing grant may carry. Closed set — see this file's header. */
export const DEFAULT_PUBLISHING_CAPABILITIES = ["publish_content.read", "publish_content.apply"] as const;
export const PUBLISHING_CAPABILITIES = [...DEFAULT_PUBLISHING_CAPABILITIES, "publish_content.backstop"] as const;

export type PublishingCapability = (typeof PUBLISHING_CAPABILITIES)[number];

/** Raw types are an opt-in trust boundary even for an otherwise privileged peer key. */
export function backstopGrantAllows(
  { grant, entityType }: { grant: { capabilities: readonly string[]; entityTypes: readonly string[] } | null; entityType: string },
  _optional: Record<string, never> = {},
): boolean {
  return grant !== null && grant.capabilities.includes("publish_content.apply") &&
    grant.capabilities.includes("publish_content.backstop") && grant.entityTypes.includes(entityType);
}

export function isBackstopEntityType(
  { entityType }: { entityType: string },
  _optional: Record<string, never> = {},
): boolean {
  return entityType === "raw-row" || entityType === "raw-file";
}

/**
 * Every `method + path` a publishing credential may reach on the destination, as express-style
 * path templates under the publish-content mount. Owned by this file, never by a grant.
 *
 * `peers` CRUD and every other admin route are deliberately absent: a publishing credential exists
 * to push content, not to enumerate or edit this install's own publishing configuration.
 */
export const PUBLISH_TRUST_ROUTES = [
  // A connected computer may host a ZIP on live; no share list/create/admin download authority.
  { method: "PUT", path: "/api/admin/v1/workspaces/:workspaceId/site-shares/artifacts/:token/:file" },
  { method: "DELETE", path: "/api/admin/v1/workspaces/:workspaceId/site-shares/artifacts/:token/:file" },
  { method: "GET", path: "/api/admin/v1/workspaces/:workspaceId/publish-content/export" },
  // S-F1: the push driver asks what this destination accepts before it stages anything.
  { method: "GET", path: "/api/admin/v1/workspaces/:workspaceId/publish-content/capabilities" },
  { method: "POST", path: "/api/admin/v1/workspaces/:workspaceId/publish-content/blobs/probe" },
  { method: "PUT", path: "/api/admin/v1/workspaces/:workspaceId/publish-content/blobs/:sha" },
  { method: "GET", path: "/api/admin/v1/workspaces/:workspaceId/publish-content/blobs/:sha" },
  { method: "POST", path: "/api/admin/v1/workspaces/:workspaceId/publish-content/bundles" },
  { method: "POST", path: "/api/admin/v1/workspaces/:workspaceId/publish-content/import/plan" },
  { method: "POST", path: "/api/admin/v1/workspaces/:workspaceId/publish-content/import/confirm" },
  { method: "POST", path: "/api/admin/v1/workspaces/:workspaceId/publish-content/import/execute" },
] as const;

/** The grant format version. A destination refuses a version it does not implement rather than
 *  guessing at an unknown shape (Codex §6 risk 3: protocol evolution must be explicit). */
export const PUBLISH_TRUST_GRANT_VERSION = 1;

/** Longest accepted value for any single string field — a bound on what one config value can push
 *  into memory, so a malformed or hostile publish-trust setting cannot be a memory amplifier. */
const MAX_FIELD_LENGTH = 512;

/** Most public keys one grant may carry. Rotation needs exactly two (outgoing + incoming); the
 *  headroom above that is for an interrupted rotation, not for a key hoard. */
const MAX_PUBLIC_KEYS = 4;

/** Most entity types one grant may enumerate. Bounded for the same reason as the key list. */
const MAX_ENTITY_TYPES = 64;

/** One public key that currently speaks for the source installation. */
export interface PublishTrustPublicKey {
  readonly publicKeyB64u: string;
  /** Rotation counter — audit metadata. NEVER identity: see `keys.ts`'s header. */
  readonly generation: number;
}

/** What the destination accepts a publish from. Secret-free: safe in git, CI logs and provider
 *  metadata. */
export interface PublishTrustGrant {
  readonly version: number;
  /** Stable identity of the source install (`keys.ts`'s `deriveInstallationId`). Survives key
   *  rotation, so baselines keyed on it do not reset when a key changes. */
  readonly sourceInstallationId: string;
  /** Public keys accepted right now. More than one only during a rotation overlap window. */
  readonly publicKeys: readonly PublishTrustPublicKey[];
  /** The destination workspace this grant is for. A grant is never workspace-agnostic. */
  readonly workspaceId: string;
  /** Entity types this source may publish. Empty is not "all" — it is a grant that can do nothing,
   *  which is the correct reading of an unstated permission. */
  readonly entityTypes: readonly string[];
  /** Always a subset of {@link PUBLISHING_CAPABILITIES}; enforced at parse. */
  readonly capabilities: readonly PublishingCapability[];
  /** ISO-8601. Past means revoked — revocation is target-side and needs no provider access. */
  readonly notAfter: string;
}

/** A parse outcome. Never a partially-valid grant — see this file's header. */
export type PublishTrustGrantParse =
  | { readonly ok: true; readonly grant: PublishTrustGrant }
  | { readonly ok: false; readonly reason: string };

/** @complexity O(1). */
function fail({ reason }: { reason: string }, _optional = {}): PublishTrustGrantParse {
  return { ok: false, reason };
}

/** @complexity O(1). */
function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}

/**
 * Validates one `publicKeys` entry on its own: an object with a bounded key string, then a
 * non-negative integer generation. Extra properties are dropped, never carried.
 *
 * @returns The key, or a reason string.
 * @complexity O(1).
 */
function parsePublicKeyEntry({ entry }: { entry: unknown }, _optional = {}): PublishTrustPublicKey | string {
  if (typeof entry !== "object" || entry === null) return "each 'publicKeys' entry must be an object";
  const { publicKeyB64u, generation } = entry as Record<string, unknown>;
  if (!isBoundedString(publicKeyB64u)) return "each 'publicKeys' entry needs a 'publicKeyB64u' string";
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) {
    return "each 'publicKeys' entry needs a non-negative integer 'generation'";
  }
  return { publicKeyB64u, generation };
}

/**
 * Validates the `publicKeys` array.
 *
 * @returns The keys, or a reason string. Duplicate generations are rejected rather than
 *   de-duplicated: two entries claiming the same generation means the provisioning step produced
 *   something incoherent, and silently picking one would hide that.
 * @complexity O(n²) in the key count, which is bounded by {@link MAX_PUBLIC_KEYS} — an explicit
 *   pairwise scan is clearer here than a set, at four elements.
 */
function parsePublicKeys({ raw }: { raw: unknown }, _optional = {}): readonly PublishTrustPublicKey[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "'publicKeys' must be a non-empty array";
  if (raw.length > MAX_PUBLIC_KEYS) return `'publicKeys' must hold at most ${MAX_PUBLIC_KEYS} keys`;

  const keys: PublishTrustPublicKey[] = [];
  for (const entry of raw) {
    const key = parsePublicKeyEntry({ entry });
    if (typeof key === "string") return key;
    if (keys.some((k) => k.generation === key.generation)) return `'publicKeys' repeats generation ${key.generation}`;
    keys.push(key);
  }
  return keys;
}

/**
 * Validates `capabilities` against the closed {@link PUBLISHING_CAPABILITIES} allowlist.
 *
 * REJECTS rather than filters. Filtering would turn a grant that asks for `content.write` into a
 * silently-narrower valid grant, which reads as success to whoever provisioned it and hides the
 * fact that something tried to widen publishing authority.
 *
 * @complexity O(n) in the claimed capability count.
 */
function parseCapabilities({ raw }: { raw: unknown }, _optional = {}): readonly PublishingCapability[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "'capabilities' must be a non-empty array";
  const capabilities: PublishingCapability[] = [];
  for (const entry of raw) {
    if (!PUBLISHING_CAPABILITIES.includes(entry as PublishingCapability)) {
      return `'${String(entry)}' is not a publishing capability; a publishing grant may only carry ${PUBLISHING_CAPABILITIES.join(", ")}`;
    }
    if (!capabilities.includes(entry as PublishingCapability)) capabilities.push(entry as PublishingCapability);
  }
  return capabilities;
}

/** @complexity O(n) in the entity-type count. */
function parseEntityTypes({ raw }: { raw: unknown }, _optional = {}): readonly string[] | string {
  if (!Array.isArray(raw)) return "'entityTypes' must be an array";
  if (raw.length > MAX_ENTITY_TYPES) return `'entityTypes' must hold at most ${MAX_ENTITY_TYPES} types`;
  for (const entry of raw) {
    if (!isBoundedString(entry)) return "each 'entityTypes' entry must be a non-empty string";
    if (entry === "*") return "'entityTypes' may not use '*'; a publishing grant enumerates its types";
  }
  return raw as readonly string[];
}

/**
 * Parses a grant document, typically `JSON.parse` of the host's publish-trust environment value.
 *
 * Every rejection reason is about the DOCUMENT, never about what a caller supplied at request time,
 * so surfacing it to an operator discloses nothing about a live credential.
 *
 * @complexity O(n) in the document's field count.
 */
export function parsePublishTrustGrant({ raw }: { raw: unknown }, _optional = {}): PublishTrustGrantParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail({ reason: "grant must be a JSON object" });
  const doc = raw as Record<string, unknown>;

  const scalars = parseScalarFields(doc);
  if (typeof scalars === "string") return fail({ reason: scalars });

  const publicKeys = parsePublicKeys({ raw: doc.publicKeys });
  if (typeof publicKeys === "string") return fail({ reason: publicKeys });
  const capabilities = parseCapabilities({ raw: doc.capabilities });
  if (typeof capabilities === "string") return fail({ reason: capabilities });
  const entityTypes = parseEntityTypes({ raw: doc.entityTypes });
  if (typeof entityTypes === "string") return fail({ reason: entityTypes });

  return {
    ok: true,
    grant: {
      version: PUBLISH_TRUST_GRANT_VERSION,
      sourceInstallationId: scalars.sourceInstallationId,
      publicKeys,
      workspaceId: scalars.workspaceId,
      entityTypes,
      capabilities,
      notAfter: scalars.notAfter,
    },
  };
}

/**
 * Validates the document's scalar fields in a fixed order — version, source installation,
 * workspace, expiry — so the first failing one is the reason.
 *
 * @complexity O(1) — every string is bounded by {@link MAX_FIELD_LENGTH}.
 */
function parseScalarFields(
  doc: Record<string, unknown>
): { sourceInstallationId: string; workspaceId: string; notAfter: string } | string {
  if (doc.version !== PUBLISH_TRUST_GRANT_VERSION) {
    return `unsupported grant version ${String(doc.version)}; this install implements version ${PUBLISH_TRUST_GRANT_VERSION}`;
  }
  const { sourceInstallationId, workspaceId, notAfter } = doc;
  if (!isBoundedString(sourceInstallationId)) return "'sourceInstallationId' must be a non-empty string";
  if (!isBoundedString(workspaceId)) return "'workspaceId' must be a non-empty string";
  if (!isBoundedString(notAfter) || Number.isNaN(Date.parse(notAfter))) {
    return "'notAfter' must be an ISO-8601 timestamp";
  }
  return { sourceInstallationId, workspaceId, notAfter };
}

/**
 * True when `grant` is still within its validity window at `nowIso`.
 *
 * Separate from parsing on purpose: a grant that has expired is well-formed, and the destination
 * should say "this grant expired" rather than "this grant is malformed".
 *
 * @complexity O(1).
 */
export function isGrantActive({ grant, nowIso }: { grant: PublishTrustGrant; nowIso: string }, _optional = {}): boolean {
  const now = Date.parse(nowIso);
  const notAfter = Date.parse(grant.notAfter);
  if (Number.isNaN(now) || Number.isNaN(notAfter)) return false;
  return now < notAfter;
}

/**
 * True when `grant` permits `capability`.
 *
 * @complexity O(n) in the grant's capability count (at most {@link PUBLISHING_CAPABILITIES}.length).
 */
export function grantAllowsCapability({ grant, capability }: { grant: PublishTrustGrant; capability: string }, _optional = {}): boolean {
  return grant.capabilities.includes(capability as PublishingCapability);
}

/**
 * True when `grant` permits publishing `entityType`.
 *
 * An empty `entityTypes` allows nothing. That is the deliberate reading: a grant that never said
 * which types it covers has not granted any, and treating silence as "all" is exactly the
 * fail-open default this feature must not have.
 *
 * @complexity O(n) in the grant's entity-type count.
 */
export function grantAllowsEntityType({ grant, entityType }: { grant: PublishTrustGrant; entityType: string }, _optional = {}): boolean {
  return grant.entityTypes.includes(entityType);
}

/**
 * True when `method`/`path` is one of {@link PUBLISH_TRUST_ROUTES}.
 *
 * Matching is segment-wise against the express template so a `:param` matches exactly one
 * non-empty segment — never `/` and never nothing. A looser match (prefix, or a regex built from
 * the template) would let `/publish-content/blobs/../../posts` or a path-traversing segment reach
 * beyond the publishing surface.
 *
 * @complexity O(n·m) in the route count and path segment count; both are small constants.
 */
export function isPublishTrustRoute({ method, path }: { method: string; path: string }, _optional = {}): boolean {
  const wanted = method.toUpperCase();
  const actual = (path.split("?")[0] ?? "").split("/");
  return PUBLISH_TRUST_ROUTES.some((route) => {
    if (route.method !== wanted) return false;
    const template = route.path.split("/");
    if (template.length !== actual.length) return false;
    return template.every((segment, i) => {
      const value = actual[i] ?? "";
      return segment.startsWith(":") ? value.length > 0 && value !== "." && value !== ".." : segment === value;
    });
  });
}
