/**
 * @file `AdminRedirectsPort` — manual URL redirect rules layered in front of a host's own content
 * resolution (a 404-fill pass by default, or an early override pass for retiring a live URL).
 *
 * ## `matchType: "regex"` is a real, typed, always-rejected request shape
 *
 * `RedirectMatchType` includes `"regex"` because the reference implementation's own API surface
 * accepts it as a well-formed request value — but its write chokepoint hard-rejects it
 * unconditionally in v1 (its own matcher source literally comments "never actually reachable — validatePattern always rejects it
 * at write time"). This is not a permission gate or a feature flag despite how it may look from the
 * type alone: every `createRedirect`/`updateRedirect`/`importRedirects` call carrying `"regex"`
 * fails validation, full stop, on the reference implementation. A panel must not offer `regex` as a
 * selectable match type unless it has independently confirmed the host it's talking to actually
 * implements it — do not infer support from this type accepting the literal.
 *
 * This is the "loudly-rejected input stays and gets documented" half of the rule `forms.ts`'s file
 * header states in full (its counterpart, a silently-ignored input, is why that port's update patch
 * has no `slug` field at all) — kept here because the union is OPEN and a different host may
 * legitimately implement `regex` even though the reference implementation refuses it.
 *
 * ## `tombstoneRedirect` is a soft delete
 *
 * Mirrors `AdminIntegrationsPort.deleteIntegrationSubscription`, not `AdminMediaPort.deleteMedia`:
 * the rule's `status` flips to `"disabled"` and the row is retained (audit trail, still readable
 * via `listRedirects`/`getRedirect`), never hard-purged. The method resolves to the updated record
 * (200-style), not `void` — a panel can render the new state without a re-fetch.
 *
 * ## `source: "auto_slug_change"` is read-only provenance
 *
 * Rows carrying this source are minted internally by the host's own content pipeline when a piece
 * of content's slug changes (never-break-links) — it is not a value a caller chooses. It appears
 * on `AdminRedirect.source` for display, but `AdminRedirectCreateInput` (used by both
 * `createRedirect` and each item of `importRedirects`) has no `source` field at all: there is
 * nothing to set. Do not offer `auto_slug_change` as a choice in a create/import form.
 *
 * ## `importRedirects` never fails as a whole
 *
 * The reference implementation's route always answers 207 Multi-Status: each rule is validated and written
 * independently through the same path `createRedirect` uses, so one bad item never aborts the
 * batch or rolls back already-written ones. Check `AdminRedirectImportResult.failed` for per-item
 * rejections — a resolved promise here does not mean every rule in the batch was created.
 *
 * ## Open vs. closed unions
 *
 * `RedirectStatusCode` is CLOSED (`301 | 302 | 307 | 308`) — this is the complete set the
 * reference implementation's write chokepoint accepts, and it is a subset of a real HTTP standard,
 * not the reference implementation's to extend (a 5th caller-supplied code would need a 5th value
 * here to be meaningful, and the reference server would reject it anyway). `RedirectMatchType`,
 * `RedirectSource`, and `RedirectStatus` are reference-implementation-specific vocabularies that
 * another host's routing engine will diverge from — OPEN, via the `T | (string & {})` idiom
 * `seo.ts`'s file header introduces for this port
 * set.
 */

/** How a rule's pattern is matched against an incoming path — open, see file header
 *  (`"regex"` is a real literal that is always rejected on the reference implementation). */
export type RedirectMatchType = "exact" | "prefix" | "wildcard" | "regex" | (string & {});

/** HTTP status a matched rule emits — closed, see file header. */
export type RedirectStatusCode = 301 | 302 | 307 | 308;

/** Provenance of a rule — open, see file header (`"auto_slug_change"` is read-only). */
export type RedirectSource = "manual" | "auto_slug_change" | "import" | (string & {});

/** Lifecycle of a rule — open, see file header. */
export type RedirectStatus = "active" | "disabled" | (string & {});

export interface AdminRedirect {
  readonly id: string;
  readonly matchType: RedirectMatchType;
  readonly fromPattern: string;
  /** A normalized site-relative path, or an absolute URL. */
  readonly toTarget: string;
  readonly statusCode: RedirectStatusCode;
  readonly status: RedirectStatus;
  /** When true, this rule is consulted before live content resolution (retires a live URL);
   *  when false (the default), it only fills the not-found path. */
  readonly override: boolean;
  /** Explicit tie-breaker within an equal-specificity band — higher wins. */
  readonly priority: number;
  readonly source: RedirectSource;
  /** The content item whose slug change minted this rule — set only for `source:
   *  "auto_slug_change"` rows. */
  readonly sourceEntryId: string | null;
  readonly fromPathAtCapture: string | null;
  readonly toPathAtCapture: string | null;
  readonly createdByPrincipal: string;
  readonly createdByPluginId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/** No `source` field — see file header, there is nothing for a caller to set. */
export interface AdminRedirectCreateInput {
  readonly matchType: RedirectMatchType;
  readonly fromPattern: string;
  readonly toTarget: string;
  readonly statusCode: RedirectStatusCode;
  readonly override?: boolean;
  readonly priority?: number;
}

export interface AdminRedirectUpdatePatch {
  readonly matchType?: RedirectMatchType;
  readonly fromPattern?: string;
  readonly toTarget?: string;
  readonly statusCode?: RedirectStatusCode;
  readonly status?: RedirectStatus;
  readonly override?: boolean;
  readonly priority?: number;
}

export interface AdminRedirectListFilter {
  readonly status?: RedirectStatus;
  readonly source?: RedirectSource;
  readonly matchType?: RedirectMatchType;
}

export interface AdminRedirectHitStats {
  readonly redirectId: string;
  readonly hitCount: number;
  readonly lastHitAt: string | null;
}

export interface AdminRedirectImportFailure {
  readonly index: number;
  readonly code: string;
  readonly message: string;
}

export interface AdminRedirectImportResult {
  readonly created: readonly AdminRedirect[];
  readonly failed: readonly AdminRedirectImportFailure[];
}

export interface AdminRedirectsPort {
  listRedirects(filter?: AdminRedirectListFilter): Promise<readonly AdminRedirect[]>;
  getRedirect(id: string): Promise<AdminRedirect>;
  createRedirect(input: AdminRedirectCreateInput): Promise<AdminRedirect>;
  updateRedirect(id: string, patch: AdminRedirectUpdatePatch): Promise<AdminRedirect>;
  /** Soft delete — returns the tombstoned record, not `void`. See file header. */
  tombstoneRedirect(id: string): Promise<AdminRedirect>;
  /** Resolves with `hitCount: 0`/`lastHitAt: null` when no hits have been recorded yet — distinct
   *  from the redirect itself not existing, which is a not-found-class rejection instead. */
  getRedirectHitStats(id: string): Promise<AdminRedirectHitStats>;
  /** Always a partial-success batch — see file header. Each item shares `AdminRedirectCreateInput`'s
   *  shape (provenance is stamped `"import"` automatically, not caller-supplied). */
  importRedirects(rules: readonly AdminRedirectCreateInput[]): Promise<AdminRedirectImportResult>;
}
