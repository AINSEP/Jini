import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";

/**
 * @file The Pages domain's agent-tool catalog — how the assistant authors a bespoke HTML Page.
 *
 * **Why this is not part of the `post` domain's catalog.** `content_post_*` reads and writes
 * `bodyJson`, a Tiptap document. A Page's real content is `body_html`, which `content_post_update`
 * cannot write and now explicitly ignores. Handing the model one tool family whose behavior silently
 * changes depending on the row's format is exactly how it would spend turns writing Tiptap documents
 * into pages that discard them. Two content types, two tool families.
 *
 * `content_post_create` (kind: "page") is still how a Page is CREATED — that part is genuinely
 * shared, since a Page's title/slug/status are ordinary entry metadata. Everything about its body
 * lives here.
 */

export type AgentToolSideEffect =
  | "none"
  | "mutates-durable-state"
  | "deletes-durable-state"
  | "mints-token";

export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

const PAGE_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "The page's id, as returned by content_post_create (kind:'page') or content_read.content_post (kind:'page').",
} as const;


/**
 * The optimistic-concurrency basis, stated once for both writers.
 *
 * Deliberately the SAME vocabulary `content_post_update` already publishes (`VERSION_CONFLICT`,
 * "nothing is written", "re-read and reapply") rather than a second, page-flavored one. A model that
 * has learned what a version conflict means on one content tool must not have to learn it again on
 * the other; two spellings of one protocol is how one arm gets handled and its sibling does not.
 */
const EXPECTED_VERSION_SCHEMA = {
  type: "integer",
  minimum: 0,
  description:
    "Required optimistic-concurrency basis — the 'version' pages_read_html returned for this page. " +
    "Read the page first and send its version. The write is rejected with " +
    "VERSION_CONFLICT (nothing written) if anyone saved in the meantime.",
} as const;

export function createPagesAgentToolCatalog({ editHtmlPermission, authoringContract, editGuidance }: {
  editHtmlPermission: string; authoringContract: string; editGuidance: string;
}, _optional = {}): AgentToolDefinition[] {
/** Appended to both writers' descriptions so the conflict protocol is stated where it is used. */
const VERSION_CONFLICT_GUIDANCE =
  "\n\n" + editGuidance +
  "\n\nCONCURRENCY: read with pages_read_html and pass its version as expectedVersion before " +
  "editing it. On VERSION_CONFLICT nothing was written — read again and retry only if the affected content is unchanged. " +
  "If it changed, show the overlap and ask which edit to keep." +
  // Only a committed change-set record earns an Undo claim (P1-T2.T): the handler adds
  // `changeSetId` after the record commits, and an unchanged write records nothing.
  "\n\nUNDO: a result with changeSetId can be undone with change_sets_revert. No changeSetId means no recorded Undo " +
  "(for example, nothing changed).";

return [
  {
    name: "pages_read_html",
    description:
      "Reads the bespoke HTML body of a page by id OR slug (including '/'). Send exactly one target. " +
      "Optional regionId returns only that region's HTML, including its outer element; omit it for the full body. " +
      "Also returns the list of editable region handles currently " +
      "present in it, the page's current version, and `theme`: the resolved active theme's id, tokens " +
      "and tokensLight overrides (null when unstyled). Call this before authoring ANY page, including " +
      "a new empty page, to get the site's actual token vocabulary instead of guessing names.\n\n" +
      "The 'regions' it returns are the addresses pages_write_region takes: if the section you need to " +
      "change is listed there, edit THAT region rather than rewriting the whole page with " +
      "pages_write_html. Pass the returned 'version' back as expectedVersion on whichever write you " +
      "make.\n\n" +
      "Without regionId, a page that has never been given HTML reads back as an empty string with no regions " +
      "and its current version. An empty HTML read can be a rich-text page. Check its format before choosing a writer. " +
      "An absent, duplicate or unclosed region is refused. Example: {slug:'/',regionId:'page-hero'}.",
    sideEffects: "none",
    authorization: { permission: "content.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      // The shared batch wrapper retains root oneOf constraints; enforce the alternative in the handler.
      properties: {
        id: PAGE_ID_SCHEMA,
        slug: { type: "string", minLength: 1, description: "The page's slug, including '/' for the home page. Send id OR slug, never both." },
        regionId: { type: "string", minLength: 1, description: "Optional data-agent-element handle. Returns this region's outer HTML; version, theme and regions still describe the page." },
      },
    },
  },
  {
    name: "pages_write_html",
    description:
      "Replaces a page's ENTIRE HTML body with the markup you supply, and converts the page to " +
      "HTML format if it is not one already. This is the tool for 'build me a landing page' and for " +
      "any rewrite substantial enough that patching would be worse than starting over.\n\n" +
      "It overwrites everything — there is no merge. To change ONE section of an existing page, do " +
      "not use this tool: call pages_read_html, find the section's handle in the 'regions' it " +
      "returns, and call pages_write_region. A real page is tens of kilobytes; re-emitting all of it " +
      "to change a headline puts every other section at risk on every turn.\n\n" +
      "REFUSED, not warned: a top-level element with no data-agent-element handle is rejected and " +
      "NOTHING is written. Untagged markup produces a page no later turn can edit a piece of, so it " +
      "is treated as malformed input rather than accepted with a note. Only <style> (and other " +
      "metadata elements) may sit at the top level untagged.\n\n" +
      authoringContract +
      VERSION_CONFLICT_GUIDANCE,
    sideEffects: "mutates-durable-state",
    // Declaration only — `buildDomainRegistrations` sets every registration's `policy.authorize` to a
    // pass-through so each permission is evaluated exactly once, by the handler's own
    // `requireToolPermission` call. Kept in lockstep with that call anyway: this is the entry an
    // audit of "what does this tool require" reads, and a stale value here would be a false answer.
    authorization: { permission: editHtmlPermission },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "html", "expectedVersion"],
      properties: {
        id: PAGE_ID_SCHEMA,
        html: {
          type: "string",
          description:
            "The complete inner HTML for this page, following the contract in this tool's description.",
        },
        expectedVersion: EXPECTED_VERSION_SCHEMA,
      },
    },
  },
  {
    name: "pages_write_region",
    description:
      "Edit or update one section of a page — a hero headline, pricing block, or call to action — " +
      "without rewriting it. Replaces that editable region's CONTENTS, leaving the rest of the page " +
      "alone and every other byte exactly as it was.\n\n" +
      "Send regionId with the handle from pages_read_html's 'regions' list (the value of that " +
      "section's data-agent-element attribute). A handle that is not in the page, or that two " +
      "elements both carry, is REJECTED rather than guessed at — nothing is written and the error " +
      "tells you which handles the page actually has.\n\n" +
      "INNER CONTENT ONLY. The html you send replaces what is INSIDE the region element; the element " +
      "itself — its tag, its data-agent-element handle, its class — is kept for you and must NOT be " +
      "re-emitted. Sending `<section data-agent-element=\"page-hero\">…</section>` would nest a second " +
      "section inside the first, not replace it. Send only what goes inside: `<h1>New headline</h1>`.\n\n" +
      "Editing a region that CONTAINS other regions replaces those too — the result reports the " +
      "handles that still exist afterwards, so check them before targeting one again.\n\n" +
      "To reorder sections, use pages_move_region. To add a section or remove one, use pages_write_html " +
      "instead: this tool cannot change a region's own tag or attributes, and cannot create or delete a region.\n\n" +
      authoringContract +
      VERSION_CONFLICT_GUIDANCE,
    sideEffects: "mutates-durable-state",
    // Same declaration-only note as `pages_write_html` above: writing part of a page stores exactly
    // the same unsanitized markup into exactly the same public surface as writing all of it, so it
    // is gated on the identical permission. A narrower gate here would be a gap, not a refinement.
    authorization: { permission: editHtmlPermission },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "regionId", "html", "expectedVersion"],
      properties: {
        id: PAGE_ID_SCHEMA,
        regionId: {
          type: "string",
          minLength: 1,
          description:
            "The region's data-agent-element handle, exactly as pages_read_html reported it in 'regions'. " +
            "Do not invent one — a handle you did not read back is an address that does not exist.",
        },
        html: {
          type: "string",
          description:
            "The new INNER content for that region — what goes between its open and close tags. Do not " +
            "include the region element itself. Follows the same contract as this tool's description.",
        },
        expectedVersion: EXPECTED_VERSION_SCHEMA,
      },
    },
  },
  {
    name: "pages_move_region",
    description:
      "Moves one whole section (region) of a page to sit immediately before or after another section — " +
      "reorder, swap, or rearrange the page's sections in place. The section moves as one " +
      "piece: its tag, handle, contents and any regions nested inside it all travel together, and every other " +
      "byte of the page stays exactly as it was.\n\n" +
      "Send regionId for the section to move, and before or after for its destination, using the handles in pages_read_html's 'regions' list (in page order). Send " +
      "exactly one of 'before' or 'after'. To swap two adjacent sections, move the second one before the " +
      "first. The result lists the handles in their new order.\n\n" +
      "This only reorders; to change what a section says use pages_write_region, and to add or remove a " +
      "section use pages_write_html." +
      VERSION_CONFLICT_GUIDANCE,
    sideEffects: "mutates-durable-state",
    // Same gate as the other two writers: it rewrites the same `body_html` of the same public page.
    authorization: { permission: editHtmlPermission },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "regionId", "expectedVersion"],
      properties: {
        id: PAGE_ID_SCHEMA,
        regionId: {
          type: "string",
          minLength: 1,
          description: "The handle of the section to move, exactly as pages_read_html reported it in 'regions'.",
        },
        before: {
          type: "string",
          minLength: 1,
          description: "Place the moved section immediately BEFORE the section with this handle. Send this or 'after', not both.",
        },
        after: {
          type: "string",
          minLength: 1,
          description: "Place the moved section immediately AFTER the section with this handle. Send this or 'before', not both.",
        },
        expectedVersion: EXPECTED_VERSION_SCHEMA,
      },
    },
  },
];
}
