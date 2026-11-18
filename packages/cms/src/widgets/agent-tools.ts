import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
/**
 * @file The Widgets agent-tool catalog — this domain's instance of the per-domain `agent-tools.ts`
 * convention the other domain catalogs follow.
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes and the
 * permission each carries. Every entry maps 1:1 onto a real exported function of
 * `write-service.ts`, `region-area-service.ts`, or `embed-service.ts` (plus two pure reads over
 * `read-service.ts` and `widgetBindingRepo`) — this catalog never names an operation the domain
 * cannot perform.
 *
 * Precedent: a host can also ship its OWN bespoke "AI tool surface" as HTTP routes (place / create /
 * remove / diagnose), a DIFFERENT delivery mechanism than this catalog's tool-registration path.
 * That surface's reasoning — every call maps 1:1 to the SAME domain functions the human admin
 * routes use, gated by the SAME `widgets.*` permission check — is exactly this catalog's discipline
 * too, just delivered through the registration mechanism. Notably, that surface deliberately ships
 * NO delete/purge tool at all; this catalog's own exclusion below independently arrives at the same
 * boundary.
 *
 * Deliberate absences (the point of a catalog, not an oversight):
 * - There is NO `widgets_purge_instance`. A permanent delete exists only as the Trash screen's purge
 *   (a human action); the old `purgeWidgetInstance` rung was retired with the generic Trash.
 * - There is NO widget-type "delete"/"unregister" tool. `registry.ts`'s `WIDGET_TYPE_REGISTRATIONS`
 *   is core-declared, static data with no admin HTTP surface at all — wrapping it would invent
 *   capability beyond what the human admin UI exposes.
 *
 * What IS included, and why it is safe: `widgets_trash_instance` (`trashWidgetInstance`) is
 * UNCONDITIONAL and non-destructive to data (a status flip only, exactly what a human gets from one
 * click on the admin "trash" button — no additional agent-reachable capability). Region placement
 * and embed mutations (`widgets_set_region_placements`, `widgets_insert_embed`, `widgets_remove_embed`,
 * `widgets_reorder_embeds`) all route through the SAME existence/liveness/recursion/count
 * guardrails a human editor's calls do — nothing here bypasses them.
 *
 * How it relates to the rest of the package:
 * `tool-registrations.ts` maps these entries into `@jini-ai/core` `ToolRegistration`s. Every
 * mutating entry's underlying function calls `requireWidgetPermission` as its own first line (the
 * SAME check applies whether the caller is a human route or an AI tool route), so the host's
 * `ToolPolicy.authorize` stays a pass-through exactly as it does for the other domains ("one
 * evaluator"). The two read tools (`widgets_get_region`/`widgets_list_regions`, which a host may
 * publish as one combined read card) have no such service-layer wrapper to delegate to — the human
 * region routes gate inline instead — so the registration layer performs that same inline
 * `widgets.read` check itself for those two, mirroring the HTTP route exactly.
 *
 * Architectural role:
 * `widgets` domain declaration. Imports only `WIDGET_TYPE_REGISTRATIONS` from its own registry, so
 * the published `widgetType` enum cannot drift from what the domain actually accepts.
 */

import { WIDGET_TYPE_REGISTRATIONS } from "./registry.js";

const MUTATES_DURABLE_STATE = "mutates-durable-state";
const PLACE_WIDGET_PERMISSION = "widgets.place";

type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

/**
 * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
 * (`buildDomainRegistrations` in `@jini-ai/core` refuses to wire any tool lacking one).
 */
type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

const WIDGET_TYPE_KEYS = Object.values(WIDGET_TYPE_REGISTRATIONS).map((registration) => registration.typeKey);

const WIDGET_INSTANCE_ID_SCHEMA = {
  type: "string",
  description: "The widget instance's entry id, as returned by widgets_create_instance or content_read.widget_instance.",
} as const;

const HOST_ENTRY_ID_SCHEMA = {
  type: "string",
  description:
    "The id of the host whose rich-text body holds the embed: a post or page (as returned by content_post_create or " +
    "content_read.content_post) or a custom content entry. Use that host's own 'version' as baseVersion. An " +
    "HTML-format page is not a valid host — embed widgets there with a data-embed-config marker via " +
    "pages_write_region instead.",
} as const;

const BASE_VERSION_SCHEMA = {
  type: "integer",
  description: "The entry's current 'version', as last returned by a read or write on it — the optimistic-concurrency guard. A stale value is rejected with a conflict naming the current version.",
} as const;

const REGION_KEY_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "A theme-declared widget region key (e.g. 'header', 'footer', 'sidebar'). Call content_read.widget_region to see which are currently bound.",
} as const;

/** One placement in a region's ordered list, as published to the model. */
const PLACEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["widgetEntryId", "enabled"],
  properties: {
    placementId: {
      type: "string",
      description: "Stable id for this placement slot. Omit when adding a NEW placement — one is minted automatically. Supply an EXISTING placementId (from content_read.widget_region) to keep editing the same slot rather than creating a new one.",
    },
    widgetEntryId: WIDGET_INSTANCE_ID_SCHEMA,
    content: { type: "object", description: "Optional per-placement Media config overlay: slug items or raw HTML; omitted display settings inherit saved config." },
    enabled: { type: "boolean", description: "Whether this placement renders. A disabled placement stays in the list but is skipped at render time." },
  },
} as const;

/**
 * The Widgets domain's fixed agent-tool catalog — 12 operations across widget-instance CRUD, region
 * placement, and inline embeds, out of the 13 the admin HTTP surface exposes (see file header for
 * why `purge` is the one exclusion).
 *
 * Ordered read-first, matching the other domain catalogs' convention: a model needs a
 * `widgetInstanceId` before it can update, trash, place, or embed one, and `content_read.widget_instance`
 * (or `widgets_create_instance`'s own result) is how it learns one.
 */
export const widgetsAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "widgets_list_instances",
    description:
      "Lists widget instances in the workspace (id, slug, title, status, widgetType, config, version). " +
      "Defaults to active-only; set includeInactive to also see trashed/purged instances. Narrow by widgetType.",
    sideEffects: "none",
    authorization: { permission: "widgets.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        widgetType: { type: "string", enum: WIDGET_TYPE_KEYS, description: "Narrow the list to one widget type. Omit to list every type." },
        includeInactive: { type: "boolean", description: "Include trash/purged instances too. Defaults to false (active-only)." },
      },
    },
  },
  {
    name: "widgets_get_instance",
    description:
      "Reads one widget instance's current state (id, slug, title, status, widgetType, config, version) plus its " +
      "where-used disclosure: every region placement and inline embed currently referencing it.",
    sideEffects: "none",
    authorization: { permission: "widgets.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["widgetInstanceId"],
      properties: { widgetInstanceId: WIDGET_INSTANCE_ID_SCHEMA },
    },
  },
  {
    name: "widgets_list_regions",
    description:
      "Lists every currently-bound widget region (regionKey, the widget_area entry id it fills, and its placement count). " +
      "Only actively-bound regions appear — a region a theme switch orphaned is not listed.",
    sideEffects: "none",
    authorization: { permission: "widgets.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
  },
  {
    name: "widgets_get_region",
    description:
      "Reads one region's full placement list, each entry resolved with the widget's title/type and whether it is " +
      "broken (its target widget is missing, wrong-type, or not active). Use this before widgets_set_region_placements " +
      "to see the current baseVersion and existing placementIds.",
    sideEffects: "none",
    authorization: { permission: "widgets.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["regionKey"],
      properties: { regionKey: REGION_KEY_SCHEMA },
    },
  },
  {
    name: "widgets_create_instance",
    description:
      "Creates a new widget instance of a given type with a validated config bag (validated against that type's own " +
      "registered schema). The instance is NOT placed anywhere by this call — use widgets_set_region_placements or " +
      "widgets_insert_embed afterward to make it appear on the site.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "widgets.create" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["widgetType", "title", "config"],
      properties: {
        widgetType: { type: "string", enum: WIDGET_TYPE_KEYS, description: "One of the registered widget types. An unregistered type is rejected." },
        title: { type: "string", minLength: 1, description: "Human-readable instance title, shown in the admin library." },
        config: { type: "object", description: "Media config: {mode:media,items:[{slug,alt?,caption?}],layout:single|grid|carousel|masonry,columns:1..6,aspectRatio:16/9,htmlAttributes?} or {mode:html,html}. Use media library slugs only; Raw HTML supports {{media:slug}} and data-media-slug. At most 50 items; HTML at most 65536 characters. Placement content overrides saved config. Legacy Gallery images/mediaId still read. Other types: their config shape depends on widgetType — see that type's own registered schema; a rejection names every failing field." },
        slug: { type: "string", description: "Optional stable slug. Auto-derived from title if omitted." },
      },
    },
  },
  {
    name: "widgets_update_instance",
    description: "Replaces an existing widget instance's config bag (re-validated against its type's registered schema). The widgetType itself cannot be changed.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "widgets.update" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["widgetInstanceId", "baseVersion", "config"],
      properties: {
        widgetInstanceId: WIDGET_INSTANCE_ID_SCHEMA,
        baseVersion: BASE_VERSION_SCHEMA,
        config: { type: "object", description: "The COMPLETE replacement config bag. Media: {mode:media,items:[{slug,alt?,caption?}],layout:single|grid|carousel|masonry,columns:1..6,aspectRatio?,htmlAttributes?} or {mode:html,html} with {{media:slug}} / data-media-slug. Maximum 50 items or 65536 HTML characters; empty items allowed. Raw HTML is sanitized by the page-body policy. Legacy Gallery images/mediaId still read." },
      },
    },
  },
  {
    name: "widgets_trash_instance",
    description:
      "Moves a widget instance to the Trash, where it can be restored for 60 days. UNCONDITIONAL: never blocked by references, even if " +
      "the instance is currently placed somewhere (every referencing placement degrades to a placeholder at render " +
      "time rather than this call being rejected). This is the only delete-adjacent tool in this catalog — there is no " +
      "purge/force-delete tool (see this file's header for why).",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "widgets.delete" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["widgetInstanceId"],
      properties: { widgetInstanceId: WIDGET_INSTANCE_ID_SCHEMA },
    },
  },
  {
    name: "widgets_bind_region",
    description:
      "Binds a new region key to a fresh, empty placement list. Idempotent — a region key already bound returns its " +
      "existing area entry rather than creating a duplicate.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: PLACE_WIDGET_PERMISSION },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["regionKey"],
      properties: { regionKey: REGION_KEY_SCHEMA },
    },
  },
  {
    name: "widgets_set_region_placements",
    description:
      "Replaces a bound region's WHOLE placement list in one atomic, version-guarded write (never a partial patch). " +
      "Every widgetEntryId referenced must be an existing, active widget instance in this workspace — a nonexistent, " +
      "trashed, or purged target is rejected before anything is written. Call content_read.widget_region first to see the " +
      "current baseVersion and existing placements to preserve.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: PLACE_WIDGET_PERMISSION },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["regionKey", "baseVersion", "placements"],
      properties: {
        regionKey: REGION_KEY_SCHEMA,
        baseVersion: BASE_VERSION_SCHEMA,
        placements: { type: "array", items: PLACEMENT_SCHEMA, description: "The COMPLETE ordered replacement placement list for this region." },
      },
    },
  },
  {
    name: "widgets_insert_embed",
    description:
      "Inserts one new inline widgetEmbed node, referencing an existing widget instance, appended to the end of a " +
      "host's rich-text body (a post, a page, or a custom content entry). Rejects if the host does not exist, is " +
      "trashed, or is an HTML-format page; if the target widget does not exist or is trashed; if the host is itself " +
      "a widget instance (no widget-in-widget recursion); or if the resulting embed count would exceed the " +
      "per-document cap. Writing into a post or page also requires content.write on it. Returns the newly-minted " +
      "placementId and the host's new version.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: PLACE_WIDGET_PERMISSION },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["hostEntryId", "baseVersion", "widgetEntryId"],
      properties: {
        hostEntryId: HOST_ENTRY_ID_SCHEMA,
        baseVersion: BASE_VERSION_SCHEMA,
        widgetEntryId: WIDGET_INSTANCE_ID_SCHEMA,
      },
    },
  },
  {
    name: "widgets_remove_embed",
    description:
      "Removes one inline widgetEmbed node (by placementId) from a host entry's body. The referenced widget " +
      "instance itself is untouched. The host may be a post, a page, or a custom content entry (not an HTML-format " +
      "page); writing into a post or page also requires content.write.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: PLACE_WIDGET_PERMISSION },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["hostEntryId", "baseVersion", "placementId"],
      properties: {
        hostEntryId: HOST_ENTRY_ID_SCHEMA,
        baseVersion: BASE_VERSION_SCHEMA,
        placementId: { type: "string", description: "The embed placement's id, as returned by widgets_insert_embed or seen in the host entry's body." },
      },
    },
  },
  {
    name: "widgets_reorder_embeds",
    description:
      "Reassigns which widget occupies which EXISTING inline embed slot, in document order. The document's own shape " +
      "(surrounding content, slot count/position) is unchanged — only each slot's target widget changes. Must supply " +
      "exactly one widgetEntryId per embed slot currently present, or the call is rejected before writing anything. " +
      "The host may be a post, a page, or a custom content entry (not an HTML-format page); writing into a post or " +
      "page also requires content.write.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: PLACE_WIDGET_PERMISSION },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["hostEntryId", "baseVersion", "orderedWidgetEntryIds"],
      properties: {
        hostEntryId: HOST_ENTRY_ID_SCHEMA,
        baseVersion: BASE_VERSION_SCHEMA,
        orderedWidgetEntryIds: {
          type: "array",
          items: { type: "string" },
          description: "One widgetEntryId per existing embed slot, in document order. Length must exactly match the current embed count.",
        },
      },
    },
  },
];
