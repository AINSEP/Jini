/**
 * @file The v1 widget-type registry (SPEC-043 REQ-07..10, ADR-047 Debate Fold-In Amendment 3).
 *
 * Purpose:
 * Each `WidgetTypeRegistration` below is plain, JSON-serializable data — schema, capability
 * class, placement contexts, cost clamps, and (for dynamic types) a `resolverId` string. No
 * registration record imports or references executable behavior directly; `resolverId` is a
 * pointer that only ever resolves through `resolvers/index.ts`'s closed `CORE_RESOLVERS` map
 * (REQ-08) — never a dynamic import, `eval`, or arbitrary function reference. This is the split
 * Amendment 3 requires: type *registration* is data (Tier-1-safe, this file); type *behavior* is
 * core-owned code in v1, ADR-024 Tier-2/3-gated for any future plugin-contributed dynamic type
 * (`resolvers/`).
 *
 * `getWidgetTypeRegistration`/`findWidgetTypeRegistration` are the two lookup accessors over this
 * data — pure, O(1) functions with no I/O and no reference to resolver code, kept here (unlike
 * `forms/manifest.ts`'s stricter zero-function convention, which exists specifically for a
 * hypothetical future loader retrofit this file has no equivalent of) because every other registry
 * in this codebase (`identity/permissions.ts`) pairs its data with a plain accessor the same way.
 * The split is deliberate, not incidental: `getWidgetTypeRegistration` is total and only accepts a
 * `typeKey` the type system has actually proven is one of the five registered keys; a caller
 * holding a merely-asserted `WidgetTypeKey` (cast from an HTTP body or decoded JSON, not narrowed)
 * must use the partial `findWidgetTypeRegistration` instead — see each function's own doc.
 *
 * How it relates to the project:
 * - Read by `resolvers/index.ts` (dispatch), `write-service.ts` (config validation, REQ-02/03),
 *   and any admin/AI surface that needs to know what a widget type declares.
 * - Static/type-only until the registry itself is imported and iterated — no side effects at
 *   module load time.
 */
import type { WidgetTypeKey, WidgetTypeRegistration } from "./types.js";

/** `text` — static, no resolver (REQ-10). A single free-form rich-text field. */
const TEXT_REGISTRATION = {
  typeKey: "text",
  capability: "static",
  configSchema: {
    type: "object",
    properties: { body: { type: "string" } },
    required: ["body"],
    additionalProperties: false,
  },
  placementContexts: ["region", "inline"],
  clamps: { timeoutMs: 0 },
} satisfies WidgetTypeRegistration;

/** `social-links` — static, no resolver. An ordered list of `{ platform, url }` pairs. */
const SOCIAL_LINKS_REGISTRATION = {
  typeKey: "social-links",
  capability: "static",
  configSchema: {
    type: "object",
    properties: {
      links: {
        type: "array",
        items: {
          type: "object",
          properties: { platform: { type: "string" }, url: { type: "string" } },
          required: ["platform", "url"],
          additionalProperties: false,
        },
        maxItems: 20,
      },
    },
    required: ["links"],
    additionalProperties: false,
  },
  placementContexts: ["region", "inline"],
  clamps: { timeoutMs: 0 },
} satisfies WidgetTypeRegistration;

/**
 * `recent-entries` — dynamic, `query` capability. `maxItems` is clamped at the
 * REGISTRATION level (the ceiling any instance's own config may request) AND
 * re-enforced at the orchestration layer (REQ-25) — defense in depth, not
 * redundant: this value is what a resolver *may* return at most; the
 * orchestrator enforces it independent of the resolver's own discipline.
 *
 * Declared with `satisfies` rather than a `: WidgetTypeRegistration` annotation so this constant
 * keeps its own literal shape — `clamps.maxItems: number`, not the shared interface's
 * `maxItems?: number` — letting `getWidgetTypeRegistration("recent-entries")` (registry.ts) return
 * a type that's honestly non-optional for THIS registration, without lying for the other four
 * (`text`/`social-links`/`menu`/`contact-form`) that genuinely have no maxItems clamp.
 *
 * Collections plan R1 (2026-09-23): this widget becomes "Collection list" — it now accepts the
 * same `collection`/`where`/`sort`/`fields`/`layout`/`columns` config keys the `{"type":"collection"}`
 * marker does (`resolvers/recent-entries.ts` shares C1's `parseCollectionListConfig` parser for
 * them). `maxItems` stays required and the type key stays `"recent-entries"` — no data migration —
 * so every existing config (just `{maxItems}`, optionally `categoryTermId`) still validates and
 * still means exactly what it meant before (D7): no `collection` set means "every user content
 * type", `sort` defaults to `"updated"`. This write-time schema only checks shape (type/bounds);
 * `parseCollectionListConfig` does the real field-name/value validation at resolve time.
 */
const RECENT_ENTRIES_REGISTRATION = {
  typeKey: "recent-entries",
  capability: "query",
  configSchema: {
    type: "object",
    properties: {
      maxItems: { type: "integer", minimum: 1, maximum: 20 },
      // REQ-32/EC-03: a taxonomy-term-target soft reference, extracted into entry_refs with
      // targetKind 'term' (no safe-delete guarantee) — see core/entry-refs/extractor.ts.
      categoryTermId: { type: "string", "x-ref-target": "term" },
      // Collections plan R1 additions — shape-only here; `parseCollectionListConfig` (shared with
      // the `collection` marker, C1) validates field names/values against the named content type.
      collection: { type: "string" },
      where: { type: "object" },
      sort: { type: "string" },
      fields: { type: "array", maxItems: 20, items: { type: "string" } },
      layout: { type: "string" },
      columns: { type: "integer", minimum: 1, maximum: 6 },
      // AW-7: opt-in schema.org block ("faq-page"); shape-only like `layout`, parsed in public-list.ts.
      structuredData: { type: "string" },
    },
    required: ["maxItems"],
    additionalProperties: false,
  },
  placementContexts: ["region", "inline"],
  clamps: { maxItems: 20, timeoutMs: 500 },
  resolverId: "recent-entries",
} satisfies WidgetTypeRegistration;

/** `menu` — dynamic, `entry-reference` capability. Delegates entirely to `navigation/resolver.ts`. */
const MENU_REGISTRATION = {
  typeKey: "menu",
  capability: "entry-reference",
  configSchema: {
    type: "object",
    // REQ-31: menuRef is an entry-target ref, extracted into entry_refs — see
    // core/entry-refs/extractor.ts (matches the CONTACT_FORM_REGISTRATION 'x-ref-target' pattern
    // below).
    properties: { menuRef: { type: "string", "x-ref-target": "entry" } },
    required: ["menuRef"],
    additionalProperties: false,
  },
  placementContexts: ["region", "inline"],
  clamps: { timeoutMs: 500 },
  resolverId: "menu",
} satisfies WidgetTypeRegistration;

/**
 * `contact-form` — dynamic, `form` capability. A thin adapter over `src/forms/`
 * (REQ-36..39) — this registration carries no submission/rate-limit/mail
 * config of its own; `formDefinitionId` is a ref-typed field extracted into
 * `entry_refs` (REQ-31).
 */
const CONTACT_FORM_REGISTRATION = {
  typeKey: "contact-form",
  capability: "form",
  configSchema: {
    type: "object",
    properties: {
      formDefinitionId: { type: "string", "x-ref-target": "entry" },
      successMessage: { type: "string" },
    },
    required: ["formDefinitionId"],
    additionalProperties: false,
  },
  placementContexts: ["region", "inline"],
  clamps: { timeoutMs: 500 },
  resolverId: "contact-form",
} satisfies WidgetTypeRegistration;

/**
 * The complete v1 widget-type registry (REQ-09), keyed by the closed `WidgetTypeKey` union rather
 * than held as an array. Declared with `satisfies` rather than a `: Readonly<Record<...>>`
 * annotation — a `:` annotation would widen every entry back to the shared `WidgetTypeRegistration`
 * interface (losing e.g. `RECENT_ENTRIES_REGISTRATION`'s own non-optional `clamps.maxItems`);
 * `satisfies` checks the same shape constraint (every `WidgetTypeKey` has an entry, which is what
 * makes `getWidgetTypeRegistration` below total) while keeping each entry's own literal type intact.
 * Iterate with `Object.values(...)` where the whole table is needed (e.g. `agent-tools.ts`'s
 * published-type-list).
 */
export const WIDGET_TYPE_REGISTRATIONS = {
  text: TEXT_REGISTRATION,
  "social-links": SOCIAL_LINKS_REGISTRATION,
  "recent-entries": RECENT_ENTRIES_REGISTRATION,
  menu: MENU_REGISTRATION,
  "contact-form": CONTACT_FORM_REGISTRATION,
} satisfies Readonly<Record<WidgetTypeKey, WidgetTypeRegistration>>;

/**
 * The total lookup accessor — pure, O(1), no I/O. Only valid for a `typeKey` already narrowed to
 * `WidgetTypeKey` by the type system itself (a literal, or a value whose type was proven, not
 * asserted). For a raw/untrusted string that merely claims to be a `WidgetTypeKey` (an HTTP body
 * field cast at the boundary, e.g. `server/routes/admin/widgets/create.ts`, or a value decoded out
 * of stored JSON via `entry-payload.ts`'s `parseWidgetInstancePayload`), `undefined` is genuinely
 * reachable — use `findWidgetTypeRegistration` instead; do not smuggle an unverified string past
 * this signature with a cast.
 *
 * Generic over the specific key, rather than fixed to the `WidgetTypeRegistration` interface, so a
 * literal call site (`getWidgetTypeRegistration("recent-entries")`) gets back
 * `WIDGET_TYPE_REGISTRATIONS`'s own entry type for that key — e.g. with `clamps.maxItems: number`,
 * not the interface's shared `maxItems?: number` — instead of forcing an artificial fallback
 * (`?? 20`) that coverage could never actually exercise for that one call site.
 */
export function getWidgetTypeRegistration<K extends WidgetTypeKey>({ typeKey }: { typeKey: K }, _optional: Record<string, never> = {}): (typeof WIDGET_TYPE_REGISTRATIONS)[K] {
  return WIDGET_TYPE_REGISTRATIONS[typeKey];
}

/**
 * The partial lookup accessor for a raw, untrusted string that has not been proven to be a
 * `WidgetTypeKey` — only asserted to be one at some upstream boundary (an HTTP body field, or a
 * value decoded out of stored JSON). Returns `undefined` for any string that isn't one of the five
 * registered keys, which callers at those boundaries must handle for real (see
 * `write-service.ts`'s `WidgetTypeUnregisteredError`, `resolvers/index.ts`'s `"unknown-type"`).
 */
export function findWidgetTypeRegistration({ raw }: { raw: string }, _optional: Record<string, never> = {}): WidgetTypeRegistration | undefined {
  return Object.values(WIDGET_TYPE_REGISTRATIONS).find((registration) => registration.typeKey === raw);
}
