import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
import { resolveCreatorKind } from "@jini-ai/core/primitives";

import { collectBodyReferences } from "@jini-ai/cms/publish/content/content-references";
import { PublishContentApplyRowError } from "@jini-ai/cms/publish/transfer";
import { addressHeldByOther, trashedAtDestination } from "@jini-ai/cms/publish/content/precheck-reasons";
import { createRepoPublishHandler, gatewayDeps } from "@jini-ai/cms/publish/content/repo-handler";
import type { PublishContentContributor, PublishContentDeps as EnginePublishContentDeps } from "@jini-ai/cms/publish/content/type-registry";
import type { CmsPublishPorts } from "@jini-ai/cms/publish/content/publish-ports";
import type { RemovePostFn } from "./post-trash.js";
import type { PublishContentReference } from "@jini-ai/cms/publish/content/type-registry";

import type { TaxonomyPublishPorts } from "@jini-ai/cms/taxonomy/publish-ports";
import { prepareTermSync, readTermIds, TERM_SYNC_PERMISSION, withTermIds } from "@jini-ai/cms/taxonomy/site/publish-term-ids";

import { importPostEntity } from "@jini-ai/cms/posts/post-import";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import { presentScheduleFields } from "@jini-ai/cms/posts/post-write-fields";
import { restorePostForward } from "./post-trash.js";

import { PostConflictError, PostNotFoundError, type PostRecord } from "@jini-ai/cms/posts/post";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import { postRetireMethods } from "./publish-content.retire.js";

/** The slice of the host's publish bag this file reads. The host registry (`features/publish-content/type-registry.ts`) is
 *  instantiated with the full product bag, which satisfies this slice, so this file names no other feature. */
export type PostBag = Pick<CmsPublishPorts, "term" | "hooks"> & {
  readonly post: CmsPublishPorts["post"] & {
    /** Apply-only — `retire()`'s address-clash overwrite (`retirePostForReplacement`). */
    readonly remove?: RemovePostFn;
    readonly reportRollbackError: (message: string, diagnostic: string) => void;
  };
};
export type PublishContentDeps = EnginePublishContentDeps<PostBag>;

/**
 * @file `post`'s and `page`'s publish-content contributions, built on `createRepoPublishHandler`
 * (`features/publish-content/repo-handler.ts`; M-POST of
 * `ADS-memory/.local-artifacts/plan-publish-all-types-2026-09-25.md`). One table, one config,
 * distinguished only by `PostKind`.
 *
 * Both contributors return DATA and import only `type-registry.ts`'s TYPES, never
 * `registerPublishContentContributor` — the composition root
 * (`server/runtime/composition/publish-content-manifest.ts`) registers them. See `type-registry.ts`'s
 * header for the module cycle a value edge would reopen, and
 * `__tests__/post-no-direct-registry-import.boundary.test.ts` for the check.
 *
 * ## The write
 *
 * `importPostEntity` (never the raw repo) inside `executeCommand` (`undo`), so an import is auditable
 * and revertible like an admin edit. Authorship (Task 15): `command.actor` is always the IMPORTING
 * operator (`executeCommand` authorizes that principal; a remote peer's author id is not a principal
 * here), while the SOURCE author travels on `record.createdByPrincipalId`, applied only on create
 * (`toImportableRecord`). `CommandActor.kind` has no `"api_key"`, so it is `"user"` like every admin route.
 *
 * ## Terms (plan §3.7, schemaVersion 2)
 *
 * `termIds` rides on the row NON-enumerably ({@link withTerms}): packed and hashed, left out when the
 * row has none (so an untagged row keeps its schemaVersion-1 hash), and never spread into a change
 * set's inverse or a restored row. The write syncs the assignments after the post lands; the gateway
 * rollback unassigns them first.
 *
 * ## Precheck
 *
 * Every refusal (empty slug, slug held, trashed destination, kind change) is enforced again inside
 * `importPostEntity`; precheck exists so an operator sees it in the plan. A body-format change (`doc`
 * vs `html`) is NOT refused (D2, 2026-09-24): it is an ordinary hashed change.
 */

/**
 * `post`'s and `page`'s declared prerequisite types. A page's body embeds media exactly like a post's;
 * `term` because the state carries `termIds`, and assigning one checks the term exists at write time.
 */
const POST_AND_PAGE_DEPENDS_ON: readonly string[] = ["media", "term"];

/**
 * Every `PostRecord` field, classified by what this transport DOES with it. This map is the single
 * place that decision is recorded, and `Record<keyof PostRecord, ...>` is what makes it a decision
 * rather than an omission: adding a field to `PostRecord` fails this file's typecheck until someone
 * classifies the new field here.
 *
 * ## The defect this exists to prevent
 *
 * This file used to hash `{...post}` — the WHOLE record — while `apply()` wrote back a hand-listed
 * subset of six or so fields. Everything in the gap (`bodyFormat`/`bodyHtml`, `seoExtJson`, `ext`,
 * `deletedAt`, `memberAccessJson`, and `templateChoice`/`overridesThemePage` on the create path) was
 * hashed but never applied, so publishing silently dropped or replaced it and still reported
 * success. `memberAccessJson` made that a SECURITY defect and not only a fidelity one: a
 * members-only post published to production as a publicly readable row.
 *
 * **"hashed but not applied" is the defect.** The reverse combination is safe: a field that is
 * applied but not hashed simply never triggers a publish on its own. So `"transferred"` is the only
 * disposition that participates in the content hash, and `"local"` fields are excluded from BOTH
 * sides — they are per-destination facts that a source instance has no standing to overwrite.
 *
 * @see `content-hash.ts`'s `EXCLUDED_KEYS`, which independently drops `id`/`workspaceId`/`version`/
 * `updatedAt`/`createdAt`/`createdByPrincipalId`. This map agrees with it by classifying those same
 * fields `"local"`; the two are belt and braces, not one relying on the other.
 */
const POST_FIELD_DISPOSITIONS: Record<keyof PostRecord, "transferred" | "provenance" | "local"> = {
  // Content — packed, hashed, and written verbatim by `importPostEntity` (`post.ts`).
  title: "transferred",
  slug: "transferred",
  bodyJson: "transferred",
  status: "transferred",
  kind: "transferred",
  bodyFormat: "transferred",
  bodyHtml: "transferred",
  seoExtJson: "transferred",
  templateChoice: "transferred",
  overridesThemePage: "transferred",
  memberAccessJson: "transferred",
  // The public byline is editable content, distinct from the write-once principal provenance below.
  // Unset bylines keep historical hashes; importing that absence clears the destination's byline.
  author: "transferred",
  showAuthor: "transferred",

  // Authorship PROVENANCE (Task 15) — packed and applied, but NOT hashed. The source is the
  // authority on who wrote a post and when, so an import copies both rather than re-stamping every
  // row with the importing operator's id; they are write-once, so only a row that does not exist at
  // the destination yet takes them. Excluded from the hash by `content-hash.ts`'s own
  // `EXCLUDED_KEYS` (which is why they can safely ride along in `state`): two instances that merely
  // disagree on a row's author or creation time must not read as a content edit.
  createdByPrincipalId: "provenance",
  createdByKind: "provenance",
  createdAt: "provenance",

  // Identity and per-database write bookkeeping. Two instances holding the same logical content
  // legitimately disagree on all of these — this feature's founding premise, see
  // `content-hash.ts`'s header.
  id: "local",
  workspaceId: "local",
  version: "local",
  updatedAt: "local",

  // Plugin-namespaced extension data (SPEC-005 CIC U-004), written only by the local
  // `content.entry.beforeSave` hook chain. Neither packed nor hashed: a plugin's namespace is a
  // fact about the instance the plugin is INSTALLED on, and a destination running a different
  // plugin set would otherwise repack to a different hash forever and report the row as eternally
  // "changed". The destination's own `ext` survives an import untouched (`toImportableRecord` hands
  // `importPostEntity` the destination's existing bag, and its `beforeSaveHook` merge runs on top),
  // so this exclusion loses nothing that belongs to this instance.
  ext: "local",

  // Trash. Never packed and never hashed: `pack()` skips trashed rows outright rather than shipping
  // them, and `precheck` refuses a trashed DESTINATION row, so publishing can neither export trash
  // nor resurrect it. OPEN PRODUCT QUESTION (2026-09-19): whether a locally-deleted post should
  // instead delete on production. This is the safe reading — it never resurrects trash as live
  // content and never deletes production content — until that is answered.
  deletedAt: "local",

  // Scheduled publishing / featured image (2026-10-05) — carried, so a scheduled post stays
  // scheduled at the destination instead of going live the moment it lands. Packed and hashed ONLY
  // WHEN SET (`omitWhenAbsent` below, and `toPublishableState`): repos keep both keys absent when
  // unset (`presentScheduleFields`), so a row without them keeps the exact state and hash it had
  // before these fields existed (`publish-content.characterization.test.ts` pins those hashes).
  publishAt: "transferred",
  featuredMediaId: "transferred",
};

/** Transferred fields left off the wire (and out of the hash) when the row has no value for them,
 *  so adding them did not move the hash of any row that never set them. */
const OMIT_WHEN_ABSENT: ReadonlySet<keyof PostRecord> = new Set(["publishAt", "featuredMediaId", "author", "showAuthor"]);

/** The keys {@link toPublishableState} puts on the wire: `"transferred"` plus `"provenance"`.
 *  Derived from {@link POST_FIELD_DISPOSITIONS} rather than re-listed, so the two cannot drift. */
const PACKED_POST_FIELDS = Object.freeze(
  (Object.keys(POST_FIELD_DISPOSITIONS) as Array<keyof PostRecord>).filter(
    (field) => POST_FIELD_DISPOSITIONS[field] !== "local"
  )
);

/** The wire shape of a packed `post`/`page`: exactly {@link PACKED_POST_FIELDS}, nothing else.
 *  Named so `pack`, `inspect` and `apply` read one contract instead of three hand-listed field sets
 *  that can drift apart. */
export type PublishablePostState = Pick<PostRecord, (typeof PACKED_POST_FIELDS)[number]>;

/**
 * Projects a `PostRecord` onto {@link PublishablePostState} — the ONE row projection behind the
 * packed state and the content hash (plus the row's `termIds`).
 *
 * Undefined optional fields are normalized to `null` so a row whose optional column was never set
 * and one whose column holds SQL `NULL` hash identically across two instances whose adapters
 * represent that difference differently. (`content-hash.ts`'s `normalize` collapses the same two
 * cases, but doing it here makes the WIRE shape unambiguous too, not just the hash input.)
 * The exception is {@link OMIT_WHEN_ABSENT}: those keys are left out when unset, matching the
 * factory's `omitWhenAbsent`, so this state and the packed hash stay one recipe.
 *
 * Exported so a test can assert against THE state builder rather than re-deriving the field list
 * on its own — a duplicated recipe in a test is the same drift this DTO exists to close, and it
 * is how four suites came to hash `{...post}` while production hashed something else.
 *
 * @complexity O(1) — a fixed field count, no iteration over anything caller-controlled.
 */
export function toPublishableState(post: PostRecord, _optional: Record<string, never> = {}): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const field of PACKED_POST_FIELDS) {
    const absent = OMIT_WHEN_ABSENT.has(field) && post[field] === undefined;
    const defaultValue = (field === "author" && post.author === null) || (field === "showAuthor" && post.showAuthor === false);
    if (absent || defaultValue) continue;
    state[field] = post[field] ?? null;
  }
  return state;
}

/** Source absence clears destination presentation fields instead of inheriting them. */
function importedPresentationFields(
  { packed }: { packed: Partial<PostRecord> },
  _options: Record<string, never> = {}
) {
  return {
    // Absent on the wire means "none": the destination's own schedule/featured image is CLEARED, not
    // kept, so a source that went live makes the destination live too.
    ...presentScheduleFields({ publishAt: packed.publishAt ?? null, featuredMediaId: packed.featuredMediaId ?? null }),
    author: packed.author ?? null,
    showAuthor: packed.showAuthor ?? false,
  };
}

/** Keep destination bookkeeping and write-once provenance separate from transferred content. */
function importedLocalFields(
  { existing, wire }: { existing: PostRecord | null; wire: Record<string, unknown> },
  _options: Record<string, never> = {}
) {
  return {
    // Recomputed by `importPostEntity` itself; present only because `PostRecord` requires them, and
    // never read off the wire.
    version: existing?.version ?? 0,
    updatedAt: existing?.updatedAt ?? "",
    // A packed entity is never trashed (`pack` skips trashed rows) and a trashed destination row is
    // refused before this point, so the only correct value here is "live".
    deletedAt: null,
    ...(existing?.ext !== undefined ? { ext: existing.ext } : {}),
    ...importedProvenanceFields({ existing, wire }),
  };
}

/** Existing rows keep write-once provenance, including absence; new rows default wire absence to null. */
function importedProvenanceFields(
  { existing, wire }: { existing: PostRecord | null; wire: Record<string, unknown> },
  _options: Record<string, never> = {}
) {
  return {
    createdByPrincipalId: existing ? existing.createdByPrincipalId : (wire.createdByPrincipalId as string | null) ?? null,
    createdAt: existing ? existing.createdAt : (wire.createdAt as string | null) ?? null,
    createdByKind: existing ? existing.createdByKind : resolveCreatorKind({ value: wire.createdByKind }),
  };
}

/**
 * Rebuilds the full `PostRecord` `importPostEntity` replicates, from a packed state plus whatever
 * the destination already holds.
 *
 * `"local"` fields are filled from the DESTINATION's own row (or a documented default when there is
 * none) and never from the wire; `"provenance"` fields come from the wire only for a row that does
 * not exist here yet, matching their write-once contract.
 *
 * @complexity O(1).
 */
function toImportableRecord(
  required: { state: Record<string, unknown>; workspaceId: string; id: string; existing: PostRecord | null }
): PostRecord {
  const { state, workspaceId, id, existing } = required;
  const packed = state as Partial<PostRecord>;
  const wire: Record<string, unknown> = {};
  for (const field of PACKED_POST_FIELDS) {
    if (OMIT_WHEN_ABSENT.has(field)) continue;
    wire[field] = packed[field] ?? null;
  }
  return {
    ...(wire as unknown as PublishablePostState),
    ...importedPresentationFields({ packed }),
    id,
    workspaceId,
    ...importedLocalFields({ existing, wire }),
  };
}

/** {@link collectBodyReferences} plus the featured image, so a scoped publish carries that media too. */
function postReferences(state: Readonly<Record<string, unknown>>): readonly PublishContentReference[] {
  const refs = collectBodyReferences({ state });
  const featured = state.featuredMediaId;
  if (typeof featured !== "string" || featured.length === 0) return refs;
  if (refs.some((ref) => ref.entityType === "media" && ref.key === featured)) return refs;
  return [...refs, { entityType: "media", key: featured }];
}

/** A row as this transport sees it: see this file's header for `termIds`. */
type PostRow = PostRecord & { readonly termIds?: readonly string[] };

/** The post port plus the taxonomy ports `termIds` needs. */
export type PostPorts = PostBag["post"] & { readonly term?: TaxonomyPublishPorts };

/** Attaches sorted `termIds`, non-enumerable (this file's header), without changing stored fields.
 * @returns A copy suitable for the gateway's compensation row as well as the transport.
 * @throws Taxonomy repository failures propagate before a publish write.
 * @complexity One indexed term read plus O(t log t) time/O(t) space for t assigned terms.
 */
async function withTerms({ termPorts, row }: { termPorts: TaxonomyPublishPorts | undefined; row: PostRecord }, _optional: Record<string, never> = {}): Promise<PostRow> {
  const termIds = await readTermIds({ ports: termPorts, contentType: row.kind, contentId: row.id });
  // The gateway captures this row as its inverse: preserve the stored byline defaults too.
  const publishRow = { ...row };
  return termIds ? Object.defineProperty(publishRow, "termIds", { value: termIds, enumerable: false }) : publishRow;
}

/** The packed state of `row` (what `pack` ships and hashes), for `planRetire`/`retire`'s hashes. */
export async function packedStateOf({ termPorts, row }: { termPorts: TaxonomyPublishPorts | undefined; row: PostRecord }, _optional: Record<string, never> = {}): Promise<Record<string, unknown>> {
  return withTermIds({ state: toPublishableState(row), termIds: await readTermIds({ ports: termPorts, contentType: row.kind, contentId: row.id }) });
}

/** The apply-time ports, or the error that names what is missing. */
function applyPorts({ ports, deps, kind }: { ports: PostPorts; deps: PublishContentDeps; kind: PostKind }, _optional: Record<string, never> = {}) {
  const { forgetRemoved } = ports;
  if (!forgetRemoved) {
    throw new Error(
      `publish-content: ${kind}.apply() requires PublishContentDeps.changeSets/authorize/` +
        "outbox and ports.post.repo/forgetRemoved — wire them from the real apply-loop composition " +
        "root (features/publish-content/apply-loop.ts)."
    );
  }
  return { repo: ports.repo, clock: deps.clock, outbox: gatewayDeps({ deps, entityType: kind }).outbox, forgetRemoved };
}

/**
 * Puts one post import back: the prior row is restored forward (see `restorePostForward`'s doc); a
 * created row has no pre-image, so it must never have existed, and `hardDelete` removes it with the
 * revision it appended and the slug it reserved (trashing it would leave a "restorable" row and keep
 * the slug reserved against the retry). Shared by the gateway's `undo` and `write`'s own catch.
 * @complexity O(1): one read plus one restore or delete.
 */
async function undoPostImport(
  { ports, deps, kind, workspaceId, id, prior, principalId }: {
    ports: PostPorts; deps: PublishContentDeps; kind: PostKind; workspaceId: string; id: string; prior: PostRow | null; principalId: string;
  },
  _options: Record<string, never> = {}
): Promise<void> {
  if (prior) {
    await restorePostForward({ deps: applyPorts({ ports, deps, kind }), input: { prior, actorId: principalId } });
    return;
  }
  if (await ports.repo.findById({ workspaceId, id })) await ports.repo.hardDelete({ workspaceId, id });
}

/** Why an entity of type `kind` is refused when its packed `kind` differs, or `null`. `kind` is
 *  transferred, so without this a `page` entity could create a post: a publishing grant limited to
 *  `page` authorizes through the `page` handler and would never see the post it wrote. */
function packedKindMismatch({ kind, id, state }: { kind: PostKind; id: string; state: Record<string, unknown> }, _optional: Record<string, never> = {}): string | null {
  return state.kind === kind ? null : `${kind} entity '${id}' is packed as a '${String(state.kind)}' — a ${kind} publish writes only ${kind}s`;
}

async function writePublishedPost({ kind, ports, deps, workspaceId, id, state, existing, expectedVersion, principalId, onRollback }: Parameters<Parameters<typeof createRepoPublishHandler<PostRow, PostPorts, PostBag>>[0]["write"]>[0] & { kind: PostKind }) {
      const wrongKind = packedKindMismatch({ kind, id, state });
      if (wrongKind) throw new PublishContentApplyRowError({ rowOutcome: "blocked", message: wrongKind });
      const { repo, outbox } = applyPorts({ ports, deps, kind });
      const terms = await prepareTermSync({ ports: ports.term, deps, entityType: kind, entityId: id, principalId, contentType: kind, wanted: state.termIds });
      // Terms first on rollback: Jini resolves the post to (un)assign, and a create's undo deletes it.
      onRollback({ undo: terms.revert });
      const imported = await importPostEntity({
        deps: { repo, clock: deps.clock, outbox, beforeSaveHook: deps.ports.hooks?.beforeSave },
        // The revision ledger's actor is the IMPORTING operator; the source author is on the record.
        input: { workspaceId, record: toImportableRecord({ state, workspaceId, id, existing }), expectedVersion, actorId: principalId },
      });
      try {
        await terms.apply();
      } catch (error) {
        // `executeCommand` compensates only a failed change-set record, never a failed `execute`, and
        // the import above is already committed: undo it here (terms first, as on rollback) and
        // rethrow. A revert failure must not hide the original error or skip the post's undo.
        await terms.revert().catch((rollbackError: unknown) => ports.reportRollbackError("[publish-content] Could not revert imported terms", describeErrorForLog({ err: rollbackError })));
        await undoPostImport({ ports, deps, kind, workspaceId, id, prior: existing, principalId });
        throw error;
      }
      return { version: imported.post.version };
}

    // Not the factory's `address`: a slug held by a trashed row keeps this sentence, and the slug
    // checks run before the kind check on an unfiltered read, as before the migration.
async function validatePublishedPost({ kind, ports, workspaceId, entity }: Omit<Parameters<NonNullable<Parameters<typeof createRepoPublishHandler<PostRow, PostPorts, PostBag>>[0]["validate"]>>[0], "existing"> & { kind: PostKind }) {
      const wrongKind = packedKindMismatch({ kind, id: entity.id, state: entity.state });
      if (wrongKind) return wrongKind;
      const slug = entity.state.slug;
      if (typeof slug !== "string" || slug.length === 0) return `${kind} entity '${entity.id}' has no usable slug to check for a collision`;
      const holder = await ports.repo.findBySlug({ workspaceId, slug });
      if (holder && holder.id !== entity.id) return addressHeldByOther({ entityType: kind, field: "slug", value: slug, holderId: holder.id });
      const existing = await ports.repo.findById({ workspaceId, id: entity.id });
      if (existing && isTrashed(existing)) return trashedAtDestination({ entityType: kind, id: entity.id });
      if (existing && existing.kind !== kind) {
        return `'${entity.id}' is a '${existing.kind}' at this destination but a '${kind}' at the source — kind is fixed at creation and cannot be changed by publishing`;
      }
      return null;
}

function contributePostKind(kind: PostKind): PublishContentContributor<PostBag> {
  return createRepoPublishHandler<PostRow, PostPorts, PostBag>({
    entityType: kind, // PostKind's two values are exactly this feature's two entityTypes
    coversTables: ["posts", "post_versions"],
    schemaVersion: 2,
    // The same permission `content_post_create`/`content_post_update` declare.
    permission: "content.write",
    // Carried `termIds` sync through the taxonomy chokepoint.
    alsoAuthorizes: [TERM_SYNC_PERMISSION],
    dependsOn: POST_AND_PAGE_DEPENDS_ON,
    ports: ({ deps }, _optional = {}) => deps.ports.post && { ...deps.ports.post, term: deps.ports.term },
    portsKey: "post",
    list: async ({ ports: p, workspaceId }, _optional = {}) => {
      const rows = (await p.repo.list({ workspaceId })).filter((row) => row.kind === kind && !isTrashed(row));
      // SQL supplies null/false defaults for older rows. Omit those defaults from the wire/hash;
      // import still clears a destination's old byline when the source leaves these fields absent.
      return Promise.all(rows.map((row) => withTerms({ termPorts: p.term, row: { ...row, author: row.author ?? undefined, showAuthor: row.showAuthor || undefined } })));
    },
    find: async ({ ports: p, workspaceId, id }, _optional = {}) => {
      const row = await p.repo.findById({ workspaceId, id });
      return row && row.kind === kind ? withTerms({ termPorts: p.term, row }) : null;
    },
    isTrashed: ({ row }) => isTrashed(row),
    fields: { ...POST_FIELD_DISPOSITIONS, termIds: "transferred" },
    omitWhenAbsent: ["termIds", ...OMIT_WHEN_ABSENT],
    // Hash the established transport projection while find() retains the full compensation row.
    legacyHashState: ({ row }) => withTermIds({ state: toPublishableState(row), termIds: row.termIds }),
    references: ({ entity }) => postReferences(entity.state),
    validate: async ({ ports, workspaceId, entity }) => validatePublishedPost({ kind, ports, workspaceId, entity }),
    write: async ({ ports, deps, workspaceId, id, state, existing, expectedVersion, principalId, onRollback }) =>
      writePublishedPost({ kind, ports, deps, workspaceId, id, state, existing, expectedVersion, principalId, onRollback }),
    undo: {
      // Forward, not verbatim: see `restorePostForward`'s doc. A create's undo removes the row.
      restore: async ({ ctx: { ports, deps, workspaceId, id, principalId }, prior }, _optional = {}) => {
        await undoPostImport({ ports, deps, kind, workspaceId, id, prior, principalId });
      },
      remove: async ({ ports, deps, workspaceId, id, principalId }) => {
        await undoPostImport({ ports, deps, kind, workspaceId, id, prior: null, principalId });
      },
    },
    errors: { conflict: [PostConflictError, PostNotFoundError] },
    extend: ({ deps }) => ({
      ...postRetireMethods(deps, kind),
      // `retire()`'s own conflicts reach the apply loop raw. `PostVersionConflictError` extends
      // `PostConflictError`.
      isApplyConflict: (error): error is Error => error instanceof PostConflictError || error instanceof PostNotFoundError,
    }),
  });
}

/** `post`'s publish-content contribution. */
export const contributePostPublish = (): PublishContentContributor<PostBag> => contributePostKind("post");

/** `page`'s publish-content contribution: same table, same repo, same config as {@link contributePostPublish}. */
export const contributePagePublish = (): PublishContentContributor<PostBag> => contributePostKind("page");