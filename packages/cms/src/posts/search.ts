import type { UUID } from "@jini-ai/core/primitives";
import { PostValidationError } from "./post.js";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import type { PostStatus } from "../core/index.js";
import { extractPlainTextFromHtml } from "../seo/html-plain-text.js";

/**
 * @file Ranked full-text search over Posts + Pages — the domain half (contract, input rules, and
 * the pure body -> plain text projection). The two adapters that actually rank live in
 * `search-index.sqlite.ts` (durable, the production one) and `search-index.memory.ts` (the
 * rule-of-two partner for the hermetic composition root).
 *
 * WHY this exists at all, given `listAdminPosts` already lists posts. `content_post_list`'s own
 * catalog description states its limits honestly: `kind` is required, there is no status/date/limit
 * filter, and it returns the FULL `bodyJson` of every row. That is fine as a mirror of an admin list
 * screen and unusable as a way for an agent to FIND something — on a real site it dumps the entire
 * corpus into the model's context to answer "where's the page about pricing". This module is the
 * find-shaped read: a query in, a short ranked list of summaries out, `bodyJson` never included.
 *
 * WHY the port is handed tokens and a clamped limit rather than a raw query string. Two reasons,
 * both about keeping the adapters honest:
 *  1. FTS5's MATCH argument is a QUERY LANGUAGE, not a string literal — `"`, `*`, `NOT`, `NEAR`, and
 *     `column:` all mean something. Tokenizing to alphanumeric runs here (the identical rule
 *     `@jini-ai/sqlite-chat`'s `searchToolCatalog` applies, and for the identical reason) means no
 *     adapter can be handed a string that reaches FTS5 as anything but plain terms. Doing it at the
 *     domain boundary rather than inside one adapter means the second adapter cannot forget.
 *  2. `limit` has a hard cap, and a cap enforced in the port's contract cannot be bypassed by a
 *     caller constructing the port call directly.
 *
 * WHAT this module does NOT decide: whether a row is visible. Workspace scoping, the soft-delete
 * (trash) exclusion, and the `kind`/`status` filters are applied by the adapter against the LIVE
 * `posts` row, never against indexed copies of those fields — see `search-index.sqlite.ts` for why
 * that placement is what makes a publish or a trash take effect with no index write at all.
 */

/**
 * One ranked result. Summary fields only — deliberately the same projection
 * `tool-registrations.ts`'s `toPostToolView` publishes, MINUS `bodyJson` and `version`.
 *
 * `bodyJson`'s absence is the whole point of the feature and is not a field anyone should add back:
 * a search that returns full documents has reintroduced exactly the context blowup it exists to
 * avoid. `snippet` is the bounded substitute — enough for a model to tell two similar hits apart,
 * not enough to be a document read. A caller that genuinely needs the body already has
 * `content_post_get` and now has the id to call it with.
 */
export interface PostSearchHit {
  id: UUID;
  kind: PostKind;
  title: string;
  slug: string;
  status: PostStatus;
  updatedAt: string;
  /** A short excerpt of the post's body text. Empty for a post whose body has no text at all. */
  snippet: string;
  /** Relevance, higher is better. Comparable only WITHIN one result set — BM25 scores are
   * corpus-relative, so there is no threshold at which a score means "good match" absolutely. */
  score: number;
}

/**
 * What an adapter is asked to rank. Every field is already validated and normalized by
 * {@link searchAdminPosts}; an adapter re-checking them would be a second evaluator of the same
 * rule, not defense in depth.
 */
export interface PostSearchQuery {
  workspaceId: UUID;
  /** Non-empty, lowercase, alphanumeric-only terms. OR'd by the adapter (see {@link toSearchTerms}). */
  terms: readonly string[];
  /** Absent means both kinds. */
  kind?: PostKind;
  /** Absent means both statuses (drafts included, matching `listAdminPosts`' admin-facing lens). */
  status?: PostStatus;
  /** Already clamped to `[1, MAX_POST_SEARCH_LIMIT]`. */
  limit: number;
}

/**
 * The ranking backend, as a port.
 *
 * A port rather than a method on `PostRepoPort`, even though both adapters end up sitting on the
 * same storage: `PostRepoPort` is a record store whose four reads are all exact lookups, and its
 * in-memory adapter satisfies it with three array scans. Search is a different capability with a
 * different backing structure (a durable inverted index that has to be migrated, kept in sync, and
 * backfilled), and folding it in would force `InMemoryPostRepo` — the hermetic test double every
 * post test in this repo constructs — to grow a ranking implementation it has no business owning.
 */
export interface PostSearchPort {
  search(required: PostSearchQuery): Promise<PostSearchHit[]>;
}

/** Returned when `limit` is omitted. Small on purpose: this feeds a model's context, and the
 * follow-up to "here are 8 candidates" is a `content_post_get`, not a wider net. */
export const DEFAULT_POST_SEARCH_LIMIT = 8;

/** Hard ceiling, applied by clamping rather than by rejecting — a model asking for 500 results
 * wants "as many as I can have", and failing its call teaches it nothing it can act on. */
export const MAX_POST_SEARCH_LIMIT = 50;

/** Ceiling on the plain text indexed per post (see {@link extractPostPlainText}). ~200k characters
 * is far past any real article and still trivially cheap to store; the point is that a pathological
 * or machine-generated document cannot make one row's index entry unbounded. */
export const MAX_INDEXED_BODY_CHARS = 200_000;

/** Ceiling on TipTap nesting depth walked by {@link extractPostPlainText}. Real documents nest a few
 * levels (list -> listItem -> paragraph -> text); this exists so a hand-crafted `bodyJson` cannot
 * turn an indexing write into a stack overflow. Content below the cap is skipped, never an error —
 * a post is still findable by everything above it. */
const MAX_BODY_DEPTH = 64;

/**
 * Splits a user query into the plain terms an FTS5 `MATCH` expression may safely be built from.
 *
 * Unicode letter and number runs only, normalized to NFC: a term produced by this function
 * cannot contain an FTS5 query-syntax
 * operator, so no caller-supplied string is ever interpreted as anything but literal terms. This is
 * the injection boundary for every adapter, which is why it lives here and not in one of them.
 *
 * @param required.query - The raw caller-supplied search string.
 * @returns Lowercased alphanumeric terms, in order, possibly empty.
 * @complexity O(n) in the query length.
 * @overallScore 100
 */
export function toSearchTerms({ query }: { query: string }, _optional: Record<string, never> = {}): string[] {
  return query.toLowerCase().normalize("NFC").match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** True for a plain JSON object (not an array, not null) — the shape every TipTap node has. */
function isNode(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Walks a TipTap/ProseMirror document and returns its readable text.
 *
 * Vocabulary-BLIND on purpose, and that is the difference from `server/http/site/render.ts`'s
 * `renderDocNode`, which switches on every known node type because it has to emit the right tag for
 * each. Search does not care which block a word sat in — it cares that the word is in the document.
 * So this collects `text` off any `{ type: "text", text }` node and recurses into any `content`
 * array, whatever the containing node calls itself. The practical payoff is that a node type
 * `renderDocNode` has not learned yet (or a plugin's own block) still contributes its text to the
 * index instead of silently disappearing from search, which is the failure mode a hardcoded node
 * list would have.
 *
 * Block boundaries become a single space, so "…end of paragraph" and "Start of next…" do not fuse
 * into one bogus token.
 *
 * @param required.bodyJson - A post's `bodyJson`. Any shape is tolerated: a non-document value yields "".
 * @returns The concatenated text, collapsed to single spaces and truncated at
 * {@link MAX_INDEXED_BODY_CHARS}.
 * @complexity O(n) in the node count, O(d) stack in the nesting depth (bounded by
 * {@link MAX_BODY_DEPTH}).
 * @overallScore 100
 */
export function extractPostPlainText({ bodyJson }: { bodyJson: unknown }, _optional: Record<string, never> = {}): string {
  const parts: string[] = [];
  let budget = MAX_INDEXED_BODY_CHARS;

  const visit = ({ node, depth }: { node: unknown; depth: number }, _optional: Record<string, never> = {}): void => {
    if (budget <= 0 || depth > MAX_BODY_DEPTH || !isNode(node)) return;

    if (node.type === "text" && typeof node.text === "string") {
      const text = node.text.slice(0, budget);
      budget -= text.length;
      parts.push(text);
      return;
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) visit({ node: child, depth: depth + 1 });
      // One separator per container, not per child: a paragraph's own text runs are adjacent by
      // construction (`"bold" + " word"`), so separating them would insert spaces mid-sentence.
      parts.push(" ");
    }
  };

  visit({ node: bodyJson, depth: 0 });
  // The budget above bounds the TEXT collected; the block separators are added on top of it, so the
  // final slice is what makes the documented cap exact rather than approximate.
  return parts.join("").replace(/\s+/g, " ").trim().slice(0, MAX_INDEXED_BODY_CHARS);
}

/** The projection of a post that the search index actually stores — see the 0022 migration's own
 * header for why the body is stored as extracted text rather than indexed as raw JSON. */
export interface PostSearchDocument {
  postId: UUID;
  title: string;
  slug: string;
  bodyText: string;
}

/**
 * Builds the indexable projection of one post. The single place a `PostRecord` becomes a search
 * document, so both adapters (and the backfill) index identical text for identical input.
 *
 * @param post - Any post-shaped record. Deliberately structural rather than `PostRecord`: the
 * backfill reads body columns straight out of the database and has no reason to inflate a whole record.
 * HTML records carry an empty doc placeholder, so their prose must come from bodyHtml instead.
 * @complexity O(n) in the body's node count or HTML length (plus the header scan).
 * @overallScore 100
 */
export function toPostSearchDocument(post: {
  id: UUID; title: string; slug: string; bodyJson: unknown;
  bodyFormat?: "doc" | "html"; bodyHtml?: string | null;
}, _optional: Record<string, never> = {}): PostSearchDocument {
  return {
    postId: post.id,
    title: post.title,
    slug: post.slug,
    bodyText: post.bodyFormat === "html"
      ? extractPlainTextFromHtml({ html: post.bodyHtml ?? "" }).replace(/\s+/g, " ").trim().slice(0, MAX_INDEXED_BODY_CHARS)
      : extractPostPlainText({ bodyJson: post.bodyJson }),
  };
}

export interface SearchAdminPostsRequired {
  deps: { search: PostSearchPort };
  input: {
    workspaceId: UUID;
    query: string;
    kind?: PostKind;
    status?: PostStatus;
    limit?: number;
  };
}

export interface SearchAdminPostsOptional {}

/**
 * Ranked search over one workspace's posts and pages, drafts included.
 *
 * Admin-facing, matching `listAdminPosts`/`listAdminPages`' lens rather than
 * `listPublishedPosts`': a draft is findable, because the operator asking "where's the page about
 * pricing" may well be looking for one they have not published yet. Callers wanting only live
 * content pass `status: "published"`.
 *
 * Validates, normalizes, and clamps; the adapter does the ranking and the visibility filtering (see
 * {@link PostSearchQuery}). A query containing no alphanumeric run at all is a
 * `PostValidationError` rather than an empty result set — "no results" and "you sent me punctuation"
 * are different facts, and only one of them is fixable by the caller.
 *
 * @param required.deps.search - The ranking backend.
 * @param required.input - Workspace, query, and the optional `kind`/`status`/`limit` filters.
 * @returns Up to `limit` hits, best match first.
 * @throws {PostValidationError} If `query` has no searchable term, or `limit` is not a finite number.
 * @complexity O(1) here; the search itself is the adapter's index cost.
 * @overallScore 100
 */
export async function searchAdminPosts(
  required: SearchAdminPostsRequired,
  _optional: SearchAdminPostsOptional = {}
): Promise<{ hits: PostSearchHit[] }> {
  const { deps, input } = required;

  const terms = toSearchTerms({ query: input.query });
  if (terms.length === 0) {
    throw new PostValidationError(
      "query must contain at least one letter or digit — punctuation-only queries match nothing"
    );
  }

  if (input.limit !== undefined && !Number.isFinite(input.limit)) {
    throw new PostValidationError("limit must be a finite number");
  }
  const limit = clampLimit({ limit: input.limit ?? DEFAULT_POST_SEARCH_LIMIT });

  const hits = await deps.search.search({
    workspaceId: input.workspaceId,
    terms,
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    limit,
  });

  return { hits };
}

/** Clamps into `[1, MAX_POST_SEARCH_LIMIT]`, flooring fractions — see {@link MAX_POST_SEARCH_LIMIT}
 * for why an out-of-range request is clamped rather than rejected. */
function clampLimit({ limit }: { limit: number }, _optional: Record<string, never> = {}): number {
  return Math.min(Math.max(Math.floor(limit), 1), MAX_POST_SEARCH_LIMIT);
}
