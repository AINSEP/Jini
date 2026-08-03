/**
 * @file The Navigation (Menus) agent-tool catalog (ADR-029) — this domain's instance of the
 * per-domain `agent-tools.ts` convention `forms/agent-tools.ts` and `identity/agent-tools.ts`
 * already use.
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes and the
 * permission each carries. Every entry maps 1:1 onto a real exported function of
 * `navigation/menu-service.ts` (plus two pure reads over `MenuRepoPort`) — this catalog never names
 * an operation the domain cannot perform.
 *
 * Precedent already in this library: `navigation/contracts.ts` declares `NAVIGATION_AI_TOOLS` — a
 * design-note list of an intended future AI tool surface (`navigation.search`/`.get`/`.where_used`/
 * `.update`/`.assign`) for a DIFFERENT, not-yet-built delivery mechanism (a "change-set review
 * layer" HITL gateway; the list itself is unused anywhere in this build today). Two of its five
 * names do not correspond to any real, callable capability in this build: `navigation.search` has
 * no implementation beyond `MenuRepoPort.list` (folded into `menus_list_menus` below — there is no
 * separate text-search capability, matching how `identity_user_list`/`identity_role_list` are
 * likewise this library's "search" for their own domains), and `navigation.where_used` has no
 * implementation anywhere (`NavWhereUsedResult` is declared in `contracts.ts` but no function in
 * `navigation/` computes it — `entry_refs`-backed where-used, unlike `widgets`/`media`, was never
 * built for menus). Wrapping either literally would invent backend capability this catalog's own
 * discipline forbids; `menus_list_menus` + `menus_get_menu` are this build's honest equivalents of
 * "search"/"get".
 *
 * Deliberate absence (the point of a catalog, not an oversight):
 * - There is NO `menus_delete_menu` (nor a separate trash-only tool). `deleteMenu` is ONE function
 *   that performs BOTH steps of the ADR-029 §6 deletion ladder, keyed off the menu's CURRENT status:
 *   a first call trashes (safe, unconditional), but a second call against an already-trashed menu
 *   PURGES it — a hard, irreversible delete, blocked only by a still-bound-location guard that
 *   itself can be bypassed with `force` (gated behind the separate `admin.menus.delete.force`
 *   permission). Unlike `widgets`/`media` (which expose trash and purge as two SEPARATE domain
 *   functions, letting a catalog safely wire trash alone), navigation has no decomposed trash-only
 *   entrypoint to call — the very same tool call, made twice, silently escalates from a reversible
 *   soft-delete into a permanent one. That is exactly the shape of risk `identity/agent-tools.ts`
 *   excludes `resetUserPassword` for: a single lever whose second pull does something categorically
 *   more dangerous than its first, reachable by an agent re-invoking a tool it already called once
 *   (e.g. after losing track of a prior call, or via prompt injection through ordinary operator
 *   content). Left human-UI-only.
 *
 * How it relates to the project:
 * A host's own tool-registration layer maps these entries into `ToolRegistration`s (see
 * `tool-registrations.ts`). Unlike Forms/Identity/Widgets, `menu-service.ts`'s functions perform NO
 * internal `authorize()` call of their own (confirmed: `CreateMenuDeps`/`UpdateMenuTreeDeps`/
 * `AssignLocationDeps` carry no `authorize` field) — every admin HTTP route a host builds is expected
 * to check `deps.authorize(...)` inline, before calling the service function (mirrors `media`'s
 * identical gap, see `media/agent-tools.ts`'s header). `tool-registrations.ts` therefore performs
 * that SAME inline `authorize()` call itself (the identical permission string and `entityType:
 * "menu"` the HTTP route uses) rather than relying on a domain-layer gate that does not exist for
 * this library.
 *
 * Architectural role:
 * `navigation` domain declaration. Imports only `VALID_TARGET_KINDS`-equivalent constants are not
 * exported from `menu-service.ts` as public data (the target-kind allowlist is enforced, not
 * published, there), so the target schema below is hand-authored against `types.ts`'s `NavTarget`
 * union and cross-checked by this catalog's own contract test rather than imported.
 */

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

export type AgentToolActorClassRule = "confirmer-must-equal-own-delegatedBy" | "user-only" | "none";

export interface AgentToolDefinition {
  name: string;
  description: string;
  sideEffects: AgentToolSideEffect;
  authorization: { permission: string };
  actorClassRule?: AgentToolActorClassRule;
  /**
   * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
   * (a host's own tool-registration layer, which refuses to wire any tool lacking one).
   *
   * Deliberately not widened to `| undefined` (unlike most optional fields in this port) — this
   * type flows into `core/tools/registration-kit.ts`'s `WirableToolDefinition`, which declares both
   * this field and `actorClassRule` below without `| undefined`. Widening only this catalog's copy
   * would make it structurally incompatible with that shared interface under
   * `exactOptionalPropertyTypes`, which is exactly what identity's own `agent-tools.ts` avoids for
   * the same reason.
   */
  inputSchema?: Readonly<Record<string, unknown>>;
}

const MENU_ID_SCHEMA = {
  type: "string",
  description: "The menu's id, as returned by menus_list_menus, menus_get_menu, or menus_create_menu.",
} as const;

/**
 * A link target, published as a `oneOf` over the 4 v1 kinds `menu-service.ts`'s `validateTarget`
 * accepts (`entryRef`/`termRef`/`url`/`route`) — `dynamicQuery`/`content` are named-but-rejected
 * reserved seams (ADR-029 §8) and are deliberately absent from this enum so the model is never
 * invited to try them.
 */
const NAV_TARGET_SCHEMA = {
  description: "The item's link target — exactly one of the 4 supported kinds below.",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "entryId"],
      properties: { kind: { const: "entryRef" }, entryId: { type: "string", description: "Target entry id (e.g. a page or post)." } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "termId", "taxonomy"],
      properties: {
        kind: { const: "termRef" },
        termId: { type: "string", description: "Target taxonomy term id." },
        taxonomy: { type: "string", description: "The taxonomy the term belongs to." },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "href"],
      properties: {
        kind: { const: "url" },
        href: { type: "string", description: "An absolute or site-relative URL. 'javascript:', 'data:', and 'vbscript:' schemes are rejected." },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "route"],
      properties: {
        kind: { const: "route" },
        route: { type: "string", description: "A named core route (e.g. 'home', 'search')." },
        params: { type: "object", description: "Optional static params passed to the route resolver." },
      },
    },
  ],
} as const;

/**
 * One node of a menu's item tree, published as a `$ref`-recursive JSON Schema (`$defs.navItem`) —
 * the tree nests via `children`, so this is the one catalog schema in this task that is genuinely
 * recursive. Enforcement of depth/count/id-uniqueness bounds happens server-side in
 * `validateAndCloneTree`, not by this published schema; the schema documents the accepted shape,
 * the domain function is still the authority.
 */
const NAV_ITEM_NODE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "target"],
  properties: {
    id: { type: "string", minLength: 1, description: "Stable id, minted once and preserved across edits. Required and unique within the whole tree." },
    label: { type: "string", description: "Display label. Omit to fall back to an empty string (target-title fallback is not implemented)." },
    target: NAV_TARGET_SCHEMA,
    attrs: {
      type: "object",
      description: "Optional presentational attributes: openInNewTab (boolean), rel (string), cssClass (string), description (string), icon (string).",
    },
    children: { type: "array", items: { $ref: "#/$defs/navItem" }, description: "Nested child items. Max nesting depth 5 (root = depth 1); max 500 total items across the whole tree." },
  },
} as const;

/** The `items` property shared by create and update — the complete tree, per node above. */
const ITEMS_TREE_SCHEMA = {
  type: "array",
  items: { $ref: "#/$defs/navItem" },
  description: "The COMPLETE item tree (whole-document replace — there is no per-item patch operation). Every node's id must be unique within the tree.",
  $defs: { navItem: NAV_ITEM_NODE_SCHEMA },
} as const;

/**
 * The Navigation domain's fixed agent-tool catalog — the 5 operations a host's admin HTTP surface
 * (`server/routes/admin/menus/*.ts`) exposes that are safe to wrap, out of its 6 total (see file
 * header for why `delete` is the one exclusion).
 *
 * Ordered read-first, matching `identity/agent-tools.ts`'s convention: a model needs a `menuId`
 * before it can update or assign one, and `menus_list_menus` is how it learns one for an existing menu.
 */
export const menusAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "menus_list_menus",
    description: "Lists every menu in the workspace (id, slug, title, status, item tree, locations, version). Read-only.",
    sideEffects: "none",
    authorization: { permission: "admin.menus.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
  },
  {
    name: "menus_get_menu",
    description: "Reads one menu by id, including its full item tree and current version.",
    sideEffects: "none",
    authorization: { permission: "admin.menus.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["menuId"],
      properties: { menuId: MENU_ID_SCHEMA },
    },
  },
  {
    name: "menus_create_menu",
    description:
      "Creates a new menu in 'draft' status with no location assigned yet — it has no effect on the live site until " +
      "menus_assign_location binds it somewhere. Rejects a duplicate slug within the workspace.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.menus.create" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "slug"],
      properties: {
        title: { type: "string", minLength: 1, description: "Human-readable menu name." },
        slug: { type: "string", pattern: "^[a-z0-9-]+$", description: "Stable machine handle. Lowercase letters, digits, and hyphens only." },
        items: { ...ITEMS_TREE_SCHEMA, description: "Optional initial item tree. Defaults to an empty menu if omitted." },
      },
    },
  },
  {
    name: "menus_update_menu_tree",
    description:
      "Replaces an existing menu's whole item tree (and optionally its title/slug) in one version-guarded write. " +
      "Always a whole-tree replace — there is no per-item patch operation, so the submitted tree must include every " +
      "item the menu keeps.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.menus.update" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["menuId", "expectedVersion", "items"],
      properties: {
        menuId: MENU_ID_SCHEMA,
        expectedVersion: { type: "integer", description: "The menu's current 'version', as last returned by a read or write on it — the optimistic-concurrency guard. A stale value is rejected with a conflict naming the current version." },
        title: { type: "string", description: "New title. Omit to leave unchanged." },
        slug: { type: "string", pattern: "^[a-z0-9-]+$", description: "New slug. Omit to leave unchanged. Must not collide with another menu's slug." },
        items: ITEMS_TREE_SCHEMA,
      },
    },
  },
  {
    name: "menus_assign_location",
    description:
      "Assigns a menu to a theme location, making it appear on the live site at that location. If the location was " +
      "already bound to a DIFFERENT menu, that menu is displaced (last-writer-wins) — its own 'locations' field loses " +
      "the key, returned as displacedMenu so the caller can see what changed.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.menus.assign" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["menuId", "locationKey"],
      properties: {
        menuId: MENU_ID_SCHEMA,
        locationKey: { type: "string", minLength: 1, description: "A theme-registered location key (e.g. 'primary', 'footer', 'social'). An unregistered key is still accepted (assignments survive a theme switch)." },
      },
    },
  },
];
