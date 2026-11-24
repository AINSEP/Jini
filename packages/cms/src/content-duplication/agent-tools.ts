/**
 * @file The `content-duplication` domain's agent-tool catalog — ONE tool, `content_duplicate`,
 * generic over a `resource` parameter rather than one bespoke `*_duplicate` tool per resource.
 *
 * Owner's explicit design correction (`ADS-memory/reports/2026-09-07-page-tool-gap.md`'s follow-up,
 * her own words): *"if we had, like, a copy tool and then we could pass arguments to copy a post,
 * copy a media provider, copy a form… We're not collapsing a bunch of tools into one thing. We are
 * having, like, a category of a tool and then having it flexible enough to do multiple things, like
 * copying different things."* The transpose of merging verbs-per-entity (which the coverage audit's
 * `comments_*` finding correctly flags as a bad merge — different VERBS sharing one permission):
 * this is ONE verb (`duplicate`) generic over resource, with permission resolved PER resource, never
 * a single flat permission for the whole tool. See `tool-registrations.ts`'s own header for how.
 *
 * `resource` is deliberately NOT a closed enum here: the set of duplicable resources grows as more
 * features register into `assistant/duplicate-resource-registry.ts` (today: `post`, `page`, `form`;
 * the coverage audit named `collections/entries`, `media`, `redirects`, `taxonomy terms`, and
 * `menus` as the same gap, not yet wired — `widgets` is deliberately NOT on that path: a widget
 * instance is meant to be SHARED across documents, so "copy a widget" is an open product question,
 * not a wiring gap). A static JSON-Schema enum authored
 * once at module load could not reflect a registry populated at boot, so an unsupported `resource`
 * is instead rejected at CALL time with the live, enumerated list of what IS supported — see
 * `tool-registrations.ts`'s handler.
 */

import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
export type AgentToolSideEffect = "none" | "mutates-durable-state" | "deletes-durable-state" | "mints-token";

export type AgentToolDefinition = SharedAgentToolDefinition;

export const contentDuplicationAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "content_duplicate",
    description:
      "Creates a copy of an existing resource — a post, a page, a form, a media asset, and (as more resource " +
      "types are wired) other content this workspace holds. The tool for 'copy X and name it Y', 'duplicate this " +
      "page', or 'use this as a starting point for a new one'. One call: reads the source, then creates a new one " +
      "with a fresh id, never touching the source. " +
      "resource names WHICH kind of thing to copy — currently 'post', 'page', 'form', or 'media'. An unrecognized " +
      "resource is rejected with the exact list of resources this workspace currently supports; if what you need " +
      "is not on that list, this tool cannot copy it yet and no spelling of it will work. " +
      "id is the source resource's own id (for post/page, as returned by content_read.content_post; for " +
      "form, as returned by content_read.form_definition; for media, as returned by content_read.media_asset — a media slug " +
      "works there too). " +
      "overrides carries optional fields for the copy — title, slug, status — and not every resource type honors " +
      "every field; a resource rejects an override it cannot honor rather than ignoring it. " +
      "For post/page: title defaults to the source's own title with a numeric suffix — '<source title> 2', then " +
      "'3' for a further copy of the SAME source, and so on — never 'Copy of <source title>'; slug defaults to a " +
      "fresh one derived from that title; status ALWAYS defaults to 'draft' even when the source is published — a " +
      "copy must never silently go live unless you explicitly override it. " +
      "For form: title is the copy's NAME and defaults the same numbered way ('<source name> 2', '3', ...), never " +
      "'Copy of <source name>'; slug defaults to a fresh one derived from that (possibly numbered) name; every " +
      "field and the notify config are copied; status is NOT accepted (a form is active/disabled, not " +
      "draft/published — the copy inherits the source's own state, so a copy of a disabled form is disabled; use " +
      "forms_set_definition_status to change it). " +
      "For media: you get a NEW LIBRARY ENTRY POINTING AT THE SAME FILE, not a second copy of the file. Title " +
      "defaults the same numbered way as post/page and form ('<source title> 2', '3', ...), never 'Copy of " +
      "<source title>'. The copy has its own id, slug, title, alt text, caption, credit, width/height, CSS class " +
      "and HTML attributes — all seeded from the source and independently editable afterwards — but the " +
      "underlying image or video bytes are shared, because media storage is content-addressed and identical " +
      "bytes are always one stored object. " +
      "Deleting one of the two does not break the other. Use it when you want the same picture described or sized " +
      "differently in a different place; it will NOT give you a separate file to alter independently. A trashed " +
      "asset is refused rather than copied, and status is NOT accepted (media is active/trashed; a copy is always " +
      "created active — use media_trash_asset afterwards). " +
      "Permission to duplicate is resolved from the RESOURCE you named, not one flat grant for this whole tool: " +
      "being able to copy a post does not by itself mean you can copy a resource of a different type. " +
      "Each resource type's own detailed behavior (for post/page: widget-embed handling, bespoke-HTML pages) is " +
      "owned by that resource's own domain — see content_post_* for the full detail on post/page specifically.",
    sideEffects: "mutates-durable-state",
    // Declaration only, and DELIBERATELY not a real permission name: this tool spans multiple
    // resources, each with its OWN declared permission (content.write for post/page today), resolved
    // and enforced per call by the handler — see tool-registrations.ts's own header for why a single
    // flat permission here would be actively wrong for a cross-resource tool. `buildDomainRegistrations`
    // never evaluates this field as a real gate (it always sets `policy.authorize` to a pass-through
    // and leaves enforcement to the handler) — same "declaration only" contract `pages_write_html`'s
    // own catalog entry already documents.
    authorization: { permission: "resolved-per-resource" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["resource", "id"],
      properties: {
        resource: {
          type: "string",
          minLength: 1,
          description:
            "Which kind of thing to copy, e.g. 'post', 'page', or 'form'. An unrecognized value is rejected, " +
            "naming every resource this workspace currently supports.",
        },
        id: { type: "string", minLength: 1, description: "The source resource's own id." },
        overrides: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", description: "Optional. Defaults to the source's own title/name with a numeric suffix — '<source title> 2', then '3' for a further copy of the same source — for post/page, form (where it is the copy's name), and media alike. Never 'Copy of <source title>'." },
            slug: { type: "string", description: "Optional. Defaults to a fresh one derived from the (possibly numbered) title, for post/page and form. For post/page, explicit 'admin' or 'api' is refused case-insensitively; title-derived reserved slugs get a numeric suffix." },
            status: { type: "string", enum: ["draft", "published"], description: "Optional. Defaults to 'draft' for post/page, regardless of the source's own status. NOT accepted for form, which is active/disabled rather than draft/published — the copy inherits the source's state." },
          },
          description: "Optional resource-specific overrides for the copy. Omit for the resource's own defaults.",
        },
      },
    },
  },
];
