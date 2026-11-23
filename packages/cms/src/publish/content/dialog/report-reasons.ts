/**
 * @file The Publish Content dialog's reason copy: turns a raw planner/handler skip reason into the
 * owner-facing sentence the report table shows. Split out of `report-rows.ts` so each file stays
 * one concern; `report-rows.ts` calls {@link friendlyPublishReason} for every row's reason cell.
 */

/** The one reason prefix that is already final, operator-facing copy — the host file-tree policy's
 *  reason wrapper (`file-tree-policy.ts`'s `wrapTreePolicyReason`). {@link friendlyPublishReason}
 *  must never rewrite it a second time. */
const ALREADY_FINAL_PREFIX = "Can't publish:";

/**
 * One raw-reason pattern this dialog is known to receive, and the owner-facing sentence it becomes.
 * Order matters: {@link friendlyPublishReason} returns the first match, so a narrower pattern (e.g.
 * the two conflict wordings) is listed before anything broader it could also satisfy.
 */
interface ReasonRewrite {
  readonly pattern: RegExp;
  readonly friendly: string;
}

/**
 * The closed set of reason strings `planner.ts` and its registered handlers (`post`, `media`,
 * `redirects`, `navigation`, `theme`, and the `repo-handler.ts` factory types) can currently produce
 * for a `skipped`, `forced` or `blocked` row, each
 * paired with the plain sentence a non-technical owner should read instead. Every raw string here is
 * quoted verbatim (minus the interpolated id/type) from where it is thrown, so this list is the
 * traceable map from "what the code says" to "what the dialog shows" — updating a handler's wording
 * means updating the matching pattern here, not guessing at a new regex blind.
 *
 * publish-content-copy-2026-09-25.md — every entry drops ids, "peer", "baseline" and "entity", and
 * names the available action ("tick Overwrite") only where the row that carries the reason actually
 * offers that control ({@link PublishReportRow.overwritable}).
 */
const REASON_REWRITES: readonly ReasonRewrite[] = [
  {
    pattern: /^no registered publish-content handler for entity type/,
    friendly: "This kind of content can't be published from here yet.",
  },
  {
    // Owner decision 2026-09-25: a push plans ON the live site, so "this instance"/"this destination"
    // in the raw text is LIVE — and the push driver uploads every required file before planning, so
    // a file still absent there is one this site could not send. The old "hasn't finished syncing
    // here yet" named the wrong side.
    pattern: /^required blob '.+' is not available/,
    friendly: "A file this item needs is missing on the live site, and couldn't be sent from here.",
  },
  // planner.ts's two conflict wordings (baseline recorded vs. none) — same cause to the operator
  // ("this destination row doesn't match what we agreed on last"), same action either way.
  {
    pattern: /has been edited on the destination since the last sync with this peer/,
    friendly: "Different version already on the live site. Tick Overwrite to replace it.",
  },
  {
    pattern: /no prior sync baseline for .+ with this peer — the destination already holds different content/,
    friendly: "Different version already on the live site. Tick Overwrite to replace it.",
  },
  {
    // `menu slug '...'` (navigation), bare `slug '...'` (post/media), and the factory's other
    // addresses (`name '...'` for taxonomy/term).
    pattern: /^(?:menu )?(?:slug|name|key) '.+' is already held by a different [\w-]+/,
    friendly: "Another item on the live site already uses this name.",
  },
  {
    // post.ts words it `<type> '<id>' is in the trash ...` — the type prefix is part of the real text,
    // and hyphenated for factory types (`collection-entry`, `content-type`).
    pattern: /^(?:[\w-]+ )?'.+' is in the trash at this destination/,
    friendly: "This item is in the trash on the live site. Restore it there before publishing.",
  },
  // Collections, entries, forms, taxonomies, terms, widgets (repo-handler.ts's factory types): the
  // `precheck-reasons.ts` builders, then each type's domain refusals that `errors.blocked` passes
  // through verbatim — quoted from `@jini-ai/cms` (content-types, entries, taxonomy) and
  // `features/{forms,widgets}` write paths.
  {
    // `tombstonedAtDestination("content-type", …)` — for a collection row AND for an entry whose
    // collection it is (`entries/publish-content.ts`'s validate), so the sentence fits both.
    pattern: /^(?:content-type '.+' is permanently removed at this destination|content type '.+' (?:is tombstoned|was permanently deleted)|ENTITY_TOMBSTONED: content type )/,
    friendly: "The collection was permanently deleted on the live site, so this can't be published.",
  },
  {
    pattern: /(?:is permanently removed at this destination|^ENTITY_TOMBSTONED: )/,
    friendly: "This item was permanently deleted on the live site, so it can't be published again.",
  },
  {
    pattern: /^ENTITY_IN_TRASH: /,
    friendly: "This item is in the trash on the live site. Restore it there before publishing.",
  },
  {
    pattern: /^[\w-]+ '.+' depends on [\w-]+ '.+', which is missing at this destination/,
    friendly: "This item uses something that isn't on the live site yet. Publish that too.",
  },
  {
    pattern: /^[\w-]+ '.+' changed on the destination during apply: /,
    friendly: "This item changed on the live site while publishing. Try again.",
  },
  {
    // Every authorize() refusal: entries/content types (`cannot …`), taxonomy (`is not authorized
    // for …`), widgets (`lacks permission …`).
    pattern: /^principal '.+' (?:cannot |is not authorized for |lacks permission )/,
    friendly: "The live site doesn't allow publishing this kind of content yet.",
  },
  {
    pattern: /^content type '.+' was not found in workspace/,
    friendly: "This entry's collection isn't on the live site yet. Publish the collection too.",
  },
  {
    pattern: /^content type '.+' is not active/,
    friendly: "This entry's collection is retired on the live site, so new entries can't be added to it.",
  },
  {
    pattern: /^content type '.+' already exists/,
    friendly: "This collection was just added on the live site. Try again.",
  },
  {
    pattern: /^fieldsJson failed schema validation: /,
    friendly: "This entry's fields don't match its collection on the live site. Publish the collection too.",
  },
  ...[
    /^(?:content-type key '.+' fails the identifier grammar gate|key '.+' is permanently reserved)/,
    /^field name '.+' (?:fails the identifier grammar gate|appears more than once)/,
    /^field '.+' has (?:kind '.+', not one of the closed field-kind enum|storage-only kind '.+' and cannot be queryable)/,
    /^content type '.+' (?:submits more than \d+ queryable fields|update submitted an empty fields array)/,
  ].map((pattern) => ({ pattern, friendly: "The live site can't accept this collection's fields. Update the live site, then try again." })),
  {
    // entries (`repo.sqlite.ts`, `trash-aware-memory-repo.ts`) and forms word a trashed slug holder alike.
    // (`trash-aware-memory-repo.ts` is now Jini's `TrashAwareInMemoryEntryRepo`, `@jini-ai/cms/entries`.)
    pattern: /^an? [\w-]+ with slug '.+' is in the Trash/,
    friendly: "An item in the live site's trash still uses this name. Restore or permanently delete it there first.",
  },
  {
    pattern: /^an? [\w-]+ with slug '.+' already exists/,
    friendly: "Another item on the live site already uses this name.",
  },
  {
    pattern: /^patch omits existing field id\(s\): /,
    friendly: "A field was removed from this form. The live site never removes form fields, so it can't be published over.",
  },
  {
    pattern: /^'.+' is not a valid email address$/,
    friendly: "A notification email on this form isn't a valid address.",
  },
  {
    pattern: /^slug '.+' is reserved$/,
    friendly: "This name is reserved on the live site. Rename it here first.",
  },
  {
    pattern: /^(?:notify\.\w+ must |name must be \d+-\d+ characters|slug must match |one or more field descriptors are invalid)/,
    friendly: "This form's settings aren't valid on the live site.",
  },
  {
    pattern: /^(?:widget '.+': widget type '.+' is not installed on the destination|widget type '.+' is not registered)/,
    friendly: "The live site doesn't have this kind of widget yet. Update the live site, then try again.",
  },
  {
    pattern: /^(?:widget '.+': its settings do not fit the destination's|config for widget type '.+' failed schema validation)/,
    friendly: "This widget's settings don't fit the live site's version of it. Update the live site, then try again.",
  },
  {
    pattern: /references widget '.+', which does not exist in workspace/,
    friendly: "This region uses a widget that isn't on the live site yet. Publish that widget too.",
  },
  {
    pattern: /references widget '.+', which is trashed/,
    friendly: "This region uses a widget that's in the trash on the live site. Restore it there first.",
  },
  {
    pattern: /^(?:widget instance '.+' was not found|widget_area '.+' was not found|region '.+' is not bound)/,
    friendly: "This item changed on the live site while publishing. Try again.",
  },
  {
    pattern: /^taxonomy '.+' is not hierarchical/,
    friendly: "This term has a parent, but its taxonomy on the live site doesn't allow nesting.",
  },
  {
    pattern: /^taxonomy '.+' was not found/,
    friendly: "This term's taxonomy isn't on the live site yet. Publish the taxonomy too.",
  },
  {
    pattern: /^parent term '.+' was not found/,
    friendly: "This term's parent isn't on the live site yet. Publish the parent too.",
  },
  {
    pattern: /^parent term '.+' belongs to taxonomy '.+', not /,
    friendly: "This term's parent belongs to a different taxonomy on the live site.",
  },
  {
    pattern: /would create a hierarchy cycle$/,
    friendly: "This term's parent would put it inside itself on the live site.",
  },
  {
    pattern: /^'.+' is a '.+' at this destination but a '.+' at the source/,
    friendly: "This item's type doesn't match the live site's version, so it can't be published over it.",
  },
  {
    pattern: /has no usable slug to check for a collision/,
    friendly: "This item has no name set, so it can't be checked against the live site.",
  },
  {
    // `\w+` (media/navigation's port name) and the factory's `notWired` (`<type> ports`).
    pattern: /cannot be prechecked — no .+ wired for this deps bag/,
    friendly: "Publishing isn't available for this item right now.",
  },
  {
    pattern: /has a malformed natural key/,
    friendly: "This item's data is incomplete and can't be published.",
  },
  {
    pattern: /is not a valid theme tree address/,
    friendly: "This theme's files aren't in a valid location.",
  },
  {
    pattern: /this site has no themes folder/,
    friendly: "This site doesn't have a themes folder set up.",
  },
  {
    pattern: /themes folder spans two disks/,
    friendly: "The site's themes folder isn't set up correctly.",
  },
  // Site settings and the active theme (`features/settings/publish-content.ts`,
  // `features/theme/active-theme-publish-content.ts`), then Jini's settings/presentation refusals.
  {
    pattern: /^site-setting '.+' is not one this site publishes/,
    friendly: "Only the site title and SEO basics can be published.",
  },
  {
    pattern: /^site-setting '.+' points at this computer/,
    friendly: "This image link only works on this computer. Pick an image from Media instead.",
  },
  {
    pattern: /^(?:active theme '.+' is not installed at this destination|theme '.+' is not supported)/,
    friendly: "This theme isn't on the live site yet. Publish the theme too.",
  },
  {
    pattern: /^presentation settings for workspace '.+' were not found/,
    friendly: "The live site isn't set up for themes yet. Update the live site, then try again.",
  },
  {
    pattern: /^(?:setting '.+' (?:was not found|has been tombstoned|does not allow scope)|secret:true definitions are not supported)/,
    friendly: "The live site doesn't have this setting yet. Update the live site, then try again.",
  },
  {
    pattern: /^value for '.+' (?:does not match the definition schema|must be \d+\.\.\d+ characters)/,
    friendly: "This setting's value isn't valid on the live site.",
  },
];

/** Matches `file-tree-policy.ts`'s generic `"<title> was not published: <detail>"` wrapping — every
 *  `checkTreeFiles` reason this module has no specific rewrite for yet (a path-shape or deny-list
 *  detail, all of which name a raw relative path). Kept last and generic on purpose: the title is
 *  real information ("Theme: static/basic") worth keeping, the raw path/segment detail after the
 *  colon is not. */
const GENERIC_TREE_WRAP_PATTERN = /^(.+) was not published: .+$/;

/**
 * Owner decision 2026-09-25 — a tree refusal that is about ONE file names that file, the way
 * `file-tree-policy.ts`'s already-final video reason does, instead of the generic "one of its files
 * isn't allowed". Each pattern matches a `wrapTreePolicyReason`-wrapped `checkTreeFiles`/
 * `checkTreePath` detail, quoted from that module, and captures the offending path; only the file's
 * own name is shown. The secret scan's pattern name (and so anything about what matched) is dropped.
 */
interface NamedFileRewrite {
  readonly pattern: RegExp;
  readonly friendly: (required: { name: string }, optional?: Record<string, never>) => string;
}

const TOO_LARGE = ({ name }: { name: string }, _optional = {}): string => `Can't publish: a file is too large (${name})`;
const LOOKS_SECRET = ({ name }: { name: string }, _optional = {}): string => `Can't publish: a file looks like it contains a key or password (${name})`;

const NAMED_FILE_REWRITES: readonly NamedFileRewrite[] = [
  { pattern: /^.+ was not published: "(.+)" is \d+ bytes, larger than the \d+-byte per-file limit$/, friendly: TOO_LARGE },
  {
    pattern:
      /^.+ was not published: "(.+)" (?:looks like it holds a key \(.+\)|looks like an environment file|is a package-manager credential file|is an MCP server configuration file, which can hold secrets|looks like a private SSH key|has a '\.(?:pem|key|p12|pfx)' extension, which is never published)$/,
    friendly: LOOKS_SECRET,
  },
];

/**
 * Rewrites one raw planner/handler reason into the sentence the dialog shows an owner — terse, free
 * of ids and sync-protocol terms ("baseline", "peer", "entity"), and naming the action when the
 * matched cause has one. `file-tree-policy.ts`'s own `"Can't publish: ..."` sentinel is already
 * exactly this (that module's header explains why it alone gets to skip the title wrapper) and is
 * returned unchanged rather than double-translated.
 *
 * Anything matching none of {@link REASON_REWRITES}, {@link NAMED_FILE_REWRITES} or {@link GENERIC_TREE_WRAP_PATTERN} — a future
 * handler's wording this file has not seen yet, or a test fixture that is not real handler text —
 * passes through unchanged rather than being mangled by a guess.
 *
 * @complexity O(1) — a fixed, small number of regex tests against one string.
 */
export function friendlyPublishReason({ reason }: { reason: string }, _optional = {}): string {
  if (reason.startsWith(ALREADY_FINAL_PREFIX)) return reason;
  for (const { pattern, friendly } of REASON_REWRITES) {
    if (pattern.test(reason)) return friendly;
  }
  for (const { pattern, friendly } of NAMED_FILE_REWRITES) {
    const path = reason.match(pattern)?.[1];
    if (path !== undefined) return friendly({ name: path.slice(path.lastIndexOf("/") + 1) });
  }
  const wrapped = reason.match(GENERIC_TREE_WRAP_PATTERN);
  if (wrapped) return `${wrapped[1]} can't be published — one of its files isn't allowed.`;
  return reason;
}
