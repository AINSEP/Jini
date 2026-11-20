import { isNonArrayRecord } from "@jini-ai/core/records";
/**
 * @file `extractEntryRefs` — the chokepoint-side `entry_refs` extractor.
 *
 * Purpose:
 * Walks a written entry's `bodyJson`/`fields.ext.*` for `ref`-typed fields (the field-type
 * vocabulary) and widget-reference-shaped nodes (`widget_area` placements, `widgetEmbed` nodes),
 * producing the rows `EntryRefsRepoPort.replaceForSource` writes in the SAME transaction as the
 * triggering entry write (INV-06) — never a follow-up async job. Entry-target references (menu,
 * form definition, success-page) are fully covered; a config field whose target kind is a
 * taxonomy term is extracted as a documented soft reference only where the installed schema
 * supports that target kind (REQ-32) — not claimed as safe-delete-protected.
 *
 * Architectural role:
 * TDD-certified implementation (implementation outline C-009). Called from the single entries
 * chokepoint — this function performs no I/O; the caller writes the returned rows inside its own
 * transaction. `extractEntryRefs()` handles structured entry bodies/config, while the later
 * `extractHtmlEntryRefs()` sibling indexes supported markers in HTML page bodies.
 */
import type { UUID } from "@jini-ai/core/primitives";
import { describeRejection, scanEmbedMarkers, type EmbedMarkerRejection } from "./markers/marker.js";
import { galleryMediaReferences } from "./markers/gallery.js";
import type { EntryRefRow } from "./ports.js";

type EntryRefTargetKind = EntryRefRow["targetKind"];

export interface ExtractEntryRefsInput {
  readonly workspaceId: UUID;
  readonly sourceEntryId: UUID;
  readonly sourceEntryType: string;
  /** The entry's post-write `bodyJson`, already validated. */
  readonly bodyJson: unknown;
  /** The entry's post-write `fields.ext.*` bag, already validated against its type's registered schema. */
  readonly fieldsExt: Readonly<Record<string, unknown>>;
}

/**
 * REQ-31/32's ref-suffix convention: a config field's KEY (not its schema) decides whether its
 * string value is a reference and, if so, which target kind. Keys ending in `TermId` are
 * taxonomy-term-target soft references (REQ-32); keys ending in `RefId`, `Ref`, or `Id` are
 * entry-target references (REQ-31) — covers every v1 ref-typed field `registry.ts`
 * declares (`formDefinitionId`, `menuRef`, `categoryTermId`, each now also carrying a matching
 * `x-ref-target` JSON-schema annotation) without this pure function needing to import that
 * registry — `extractEntryRefs` deliberately takes no injected schema/registry dependency (see
 * the certified test suite, which calls it with plain data only), so a structural, key-name-based
 * convention is the only mechanism available that stays a pure function of its literal input. A
 * schema-driven extractor (consulting the registry's `x-ref-target` markers directly) would be a
 * reasonable future upgrade if this function's signature is ever widened.
 *
 * @complexity O(1).
 * @overallScore 100
 */
function classifyRefFieldKey({ key }: { key: string }, _options = {}): EntryRefTargetKind | null {
  if (key.endsWith("TermId")) return "term";
  if (key.endsWith("RefId") || key.endsWith("Ref") || key.endsWith("Id")) return "entry";
  return null;
}

/**
 * Walks a TipTap-shaped document tree (`{ type, content: [...] }`, arrays of such
 * nodes) looking for `widgetEmbed` atoms (REQ-18/30), regardless of nesting depth — matches
 * `embed-validation.ts`'s INV-04 stance that nesting depth never matters, only presence.
 *
 * @complexity O(n) over the document's total node count.
 * @overallScore 100
 */
function collectWidgetEmbedRefs({ root, rootPath, input, refs }: { root: unknown; rootPath: string; input: ExtractEntryRefsInput; refs: EntryRefRow[] }, _options = {}): void {
  // An explicit stack, not recursion: a saved document's nesting depth is caller/import-controlled
  // and a 5000-deep body overflowed the call stack here on save (same class as f646ba397's GET-path
  // walkers). Children are pushed in reverse so the walk stays pre-order — the same ref order and
  // `fieldPath` strings the recursive version produced.
  const stack: Array<{ node: unknown; path: string }> = [{ node: root, path: rootPath }];
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index--) stack.push({ node: node[index], path: `${path}[${index}]` });
      continue;
    }
    collectWidgetEmbedNode({ node, path, input, refs, stack });
  }
}

function collectWidgetEmbedNode(
  { node, path, input, refs, stack }: {
    node: unknown; path: string; input: ExtractEntryRefsInput; refs: EntryRefRow[];
    stack: Array<{ node: unknown; path: string }>;
  },
  _optional: Record<string, never> = {},
): void {
  const candidate = { value: node };
  if (!isNonArrayRecord(candidate)) return;
  const attrs = { value: candidate.value.type === "widgetEmbed" ? candidate.value.attrs : undefined };

  if (isNonArrayRecord(attrs) && typeof attrs.value.widgetEntryId === "string") {
    refs.push({
      workspaceId: input.workspaceId,
      sourceEntryId: input.sourceEntryId,
      sourceKind: "widget-embed",
      fieldPath: path,
      targetKind: "entry",
      targetId: attrs.value.widgetEntryId,
    });
  }

  if (isNonArrayRecord(attrs)) addMediaConfigRefs({ config: attrs.value.content, path: `${path}.attrs.content`, input, refs });
  if (Array.isArray(candidate.value.content)) stack.push({ node: candidate.value.content, path: `${path}.content` });
}

/**
 * REQ-30 (a): a widget_area's placement list — shape-detected, not type-gated (REQ-17 already
 * guarantees only a widget_area entry's bodyJson ever carries this shape).
 *
 * @complexity O(n) over the placement list's length.
 * @overallScore 100
 */
function collectPlacementRefs({ input, refs }: { input: ExtractEntryRefsInput; refs: EntryRefRow[] }, _options = {}): void {
  const body = { value: input.bodyJson };
  if (!isNonArrayRecord(body) || !Array.isArray(body.value.placements)) return;

  (body.value.placements as unknown[]).forEach((placement, index) => {
    const candidate = { value: placement };
    if (!isNonArrayRecord(candidate) || typeof candidate.value.widgetEntryId !== "string") return;

    addMediaConfigRefs({ config: candidate.value.content, path: `bodyJson.placements[${index}].content`, input, refs });
    refs.push({
      workspaceId: input.workspaceId,
      sourceEntryId: input.sourceEntryId,
      sourceKind: "widget-area-placement",
      fieldPath: `bodyJson.placements[${index}]`,
      targetKind: "entry",
      targetId: candidate.value.widgetEntryId,
    });
  });
}

/**
 * REQ-31/32 — one namespace's `config` bag: every string-valued, non-empty, ref-suffixed key
 * (per {@link classifyRefFieldKey}) becomes a `config-field` row.
 *
 * @complexity O(k) over the config bag's key count.
 * @overallScore 100
 */
function collectNamespaceConfigRefs(
  { namespace, config, input, refs }: { namespace: string; config: Record<string, unknown>; input: ExtractEntryRefsInput; refs: EntryRefRow[] },
  _options = {},
): void {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string" || value.length === 0) continue;
    const targetKind = classifyRefFieldKey({ key: key });
    if (targetKind) refs.push({
      workspaceId: input.workspaceId,
      sourceEntryId: input.sourceEntryId,
      sourceKind: "config-field",
      fieldPath: `fields.ext.${namespace}.config.${key}`,
      targetKind,
      targetId: value,
    });
  }
}

/** Media reference keys include authored slugs. Read services match both id and slug; this pure
 * extractor intentionally does no repository I/O inside the caller's write transaction. */
function addMediaConfigRefs({ config, path, input, refs }: { config: unknown; path: string; input: Pick<ExtractEntryRefsInput, 'workspaceId' | 'sourceEntryId'>; refs: EntryRefRow[] }): void {
  for (const [index, ref] of galleryMediaReferences({ config }).entries()) refs.push({
    workspaceId: input.workspaceId, sourceEntryId: input.sourceEntryId, sourceKind: 'config-field',
    fieldPath: `${path}.media[${index}]`, targetKind: 'asset', targetId: ref.mediaId,
  });
}

/**
 * REQ-31/32: ref-typed config fields inside fields.ext.<namespace>.config, across every
 * namespace in `fieldsExt`.
 *
 * @complexity O(n) over `fieldsExt`'s namespace count (per-namespace key scan delegated to
 *   {@link collectNamespaceConfigRefs}).
 * @overallScore 100
 */
function collectConfigFieldRefs({ input, refs }: { input: ExtractEntryRefsInput; refs: EntryRefRow[] }, _options = {}): void {
  // `fieldsExt` is a required bag: every caller (the widget/region/embed write services and
  // content-references) passes an object, `{}` when the entry has no ext fields.
  for (const [namespace, namespaceValue] of Object.entries(input.fieldsExt)) {
    const namespaceRecord = { value: namespaceValue };
    if (isNonArrayRecord(namespaceRecord)) {
      const config = { value: namespaceRecord.value.config };
      if (!isNonArrayRecord(config)) continue;

      collectNamespaceConfigRefs({ namespace: namespace, config: config.value, input: input, refs: refs });
      collectWidgetConfigMedia({ namespace, widgetType: namespaceRecord.value.widgetType, config: config.value, input, refs });
    }
  }
}

function collectWidgetConfigMedia(
  { namespace, widgetType, config, input, refs }: {
    namespace: string; widgetType: unknown; config: Record<string, unknown>;
    input: ExtractEntryRefsInput; refs: EntryRefRow[];
  },
  _optional: Record<string, never> = {},
): void {
  if (namespace === "widget" && (widgetType === "gallery" || widgetType === "media")) {
    for (const { mediaId, index } of galleryMediaReferences({ config })) refs.push({
      workspaceId: input.workspaceId, sourceEntryId: input.sourceEntryId, sourceKind: "config-field",
      fieldPath: `fields.ext.${namespace}.config.media[${index}]`, targetKind: "asset", targetId: mediaId,
    });
  }
}

/**
 * REQ-29..32 — extracts every `entry_refs` row implied by one entry's written state: a
 * `widget_area` placement list (REQ-30), any `widgetEmbed` node inside `bodyJson` (REQ-30/18), and
 * any ref-typed config field inside `fieldsExt` (REQ-31/32). Pure and idempotent (INV-06's
 * "same-transaction, re-extract on every write" discipline depends on this being a deterministic
 * function of the entry's own state, never accumulating hidden extractor-local state) — no I/O, no
 * side effects. The caller (the entries write chokepoint composition in `write-service.ts`/
 * `region-area-service.ts`) is responsible for writing the returned rows via
 * `EntryRefsRepoPort.replaceForSource`.
 *
 * @complexity O(n) over `bodyJson`'s node count plus O(k) over `fieldsExt`'s config keys.
 * @overallScore 100
 */
export function extractEntryRefs(input: ExtractEntryRefsInput, _optional: Record<string, never> = {}): readonly EntryRefRow[] {
  const refs: EntryRefRow[] = [];

  collectPlacementRefs({ input: input, refs: refs });
  // REQ-30 (b): widgetEmbed nodes anywhere inside bodyJson.
  collectWidgetEmbedRefs({ root: input.bodyJson, rootPath: "bodyJson", input: input, refs: refs });
  collectConfigFieldRefs({ input: input, refs: refs });

  return refs;
}

// ---------------------------------------------------------------------------
// `"html"`-format Page bodies (`body_html`, a plain string, not a `bodyJson`
// tree). A sibling entry point to `extractEntryRefs` above, not a mode of it: an html Page is
// written through the host's html page document store, a completely
// separate write path from the `entries` chokepoint `extractEntryRefs` is called from (
// Pages bypass that chokepoint entirely), so it needs its own call site, not a widened
// `ExtractEntryRefsInput`.
// ---------------------------------------------------------------------------

/**
 * Mirrors `html/html-embeds.ts`'s `MAX_HTML_EMBEDS_PER_PAGE` — the index must never grow past
 * what a render can actually resolve, so the same resource bound applies here too. */
const MAX_HTML_PAGE_EMBED_REFS = 50;

/** Mirrors `html/html-embeds.ts`'s id sanity bound. */
const MAX_HTML_EMBED_REF_ID_LENGTH = 200;

/**
 * Embed types this function currently knows how to target-map into `entry_refs`, and which
 * {@link EntryRefTargetKind} each maps to. `widget` -> `"entry"` (mirrors `MENU_REGISTRATION`'s
 * `menuRef`/`CONTACT_FORM_REGISTRATION`'s `formDefinitionId` both being extracted as
 * `"entry"`-target refs elsewhere in this codebase even though neither a menu nor a Forms definition
 * is a literal `entries`-table row; `targetKind` marks "a durable content object", not literal table
 * membership). `media` -> `"asset"`: a media asset lives in a different storage domain
 * than the generic `entries` graph, so it gets its own target kind rather
 * than overloading `"entry"`). A type absent from this map is still SCANNED (the shared parser
 * reports every marker regardless of type) but produces no row: an unrecognized/future type has no
 * known target-kind mapping yet, and guessing one would be actively wrong data, not just
 * incomplete. Widening this map is exactly the "one place to change" a new indexable type needs; the
 * parser never does.
 *
 * Forms definitions are referenced through persisted contact-form widget configuration:
 * `classifyRefFieldKey` indexes `config.formDefinitionId` as an entry-target config-field row.
 * Safe-delete therefore follows page -> widget -> form definition, with a persisted object at
 * each hop.
 */
const HTML_EMBED_TARGET_KINDS: ReadonlyMap<string, EntryRefTargetKind> = new Map([
  ["widget", "entry"],
  ["media", "asset"],
]);

/** Receives the UNINDEXED-reference warning of {@link extractHtmlEntryRefs}. */
export type EntryRefsReport = (required: { message: string; sourceEntryId: UUID }) => void;

/**
 * A marker that carries `data-embed-config` but could not be parsed. **This is the loudest failure
 * in this file, and deliberately so.**
 *
 * Every other skip here is a decision: an unmapped type has no `targetKind`, an absent id has
 * nothing to populate `targetId` with. A REJECTED marker is different — it is a reference that
 * exists in the markup and that this index cannot see. `entry_refs` is what safe-delete's where-used
 * check reads, so a dropped row does not degrade the feature, it INVERTS
 * it: the delete is reported safe precisely because the reference protecting the target went
 * missing. One stray character in one config is enough.
 *
 * This function is pure and contractually never throws, so it warns rather than refusing — the write
 * has already been validated and is in flight by the time extraction runs. Refusing the write is the
 * write chokepoint's job (migration contract step 2), and that gate is what makes this warning rare
 * rather than routine. Until it exists, this report is the only signal that an index is incomplete;
 * the host decides where it goes (no `report`: nothing is reported).
 */
function warnRejectedMarkers(rejected: readonly EmbedMarkerRejection[], sourceEntryId: UUID, report: EntryRefsReport | undefined): void {
  if (!report) return;
  for (const rejection of rejected) {
    report({
      message:
        `[entry-refs] extractHtmlEntryRefs: UNINDEXED reference — ${describeRejection({ rejection: rejection })}. ` +
        `Safe-delete cannot see it, so a target it references may be deleted as unused.`,
      sourceEntryId,
    });
  }
}

/**
 * REQ-30-style — extracts one `entry_refs` row per embed marker found in `html`, up to
 * {@link MAX_HTML_PAGE_EMBED_REFS}. `targetKind` is looked up per embed type via
 * {@link HTML_EMBED_TARGET_KINDS} — an embed type with no entry there (unrecognized/future type)
 * produces no row rather than a guessed `targetKind`. Pure, never throws, matching
 * `extractEntryRefs`'s own contract.
 *
 * Marker parsing belongs to Jini CMS's shared widget marker parser. Rendering and indexing
 * consume the same definition so their marker interpretations cannot drift.
 *
 * A reference whose `id` key is absent, empty, non-string, or beyond
 * {@link MAX_HTML_EMBED_REF_ID_LENGTH} produces no row — `EntryRefRow.targetId` is a required
 * `UUID`, so an unusable id has nothing to populate it with (mirrors `scanHtmlEmbeds`'s own
 * id-normalization, but this function drops the occurrence entirely rather than reporting a null-id
 * row, since an indexable-or-not decision is exactly what this function's contract already commits
 * to for every other ref kind it extracts).
 *
 * **Disclosed gap: a `slug`-only `{"type":"widget","slug":"..."}` marker — no `id` at
 * all — produces no `entry_refs` row either, for the same "no id" branch above, even though
 * `resolver-service.ts`'s `resolveWidgetTypeEmbeds` now resolves it to a real widget at render time.**
 * This function is deliberately pure (see this file's own header — no repo/resolver dependency), and
 * turning a `slug` into the `UUID` `EntryRefRow.targetId` requires exactly the I/O this function's
 * contract forbids itself, so the two cannot be reconciled without either widening this function's
 * signature (a real architectural change, not attempted here) or normalizing a marker's `slug` to a
 * real `id` at WRITE time instead (the host page store's write, not this pass's scope). Until
 * one of those lands, a page embedding a widget ONLY by slug is invisible to safe-delete's where-used
 * check — the exact "reference exists in the markup, index can't see it" hazard this function's own
 * `warnRejectedMarkers` was built to be loud about for a REJECTED marker, but a valid slug-only one
 * does not reach `rejected` (it parses fine), so no warning fires here today. Flagged prominently
 * rather than silently shipped; see this feature's handoff for the same disclosure.
 *
 * `fieldPath` counts every marker, not only indexable ones, so adding a target-kind mapping
 * cannot change an existing occurrence's locator. Nothing parses this human-readable locator;
 * existing stored rows retain their spelling until the next source-page write replaces them.
 *
 * **Indexes REFERENCES, never RESOLUTIONS — by construction, not by discipline.** This function
 * takes no repo/resolver dependency (only a plain `html` string), so it has no way to check whether
 * a placeholder's target currently exists, let alone resolves. A marker pointing at a deleted widget
 * produces a row here exactly like one pointing at a live widget does. This is required, not
 * incidental: `entry_refs`' whole purpose is catching "deleting a widget silently breaks a page",
 * and that is precisely the page whose reference has stopped resolving — indexing only what
 * currently resolves would make the one broken page the one page the integrity check silently
 * ignores. `resolver-service.ts`'s `resolveHtmlPageEmbeds` (a completely separate function, called
 * from the render path, never from here) is where "does this currently resolve" is answered — this
 * function never asks.
 *
 * @complexity O(n) over `html`'s length for the shared scan.
 * @overallScore 100
 */
export function extractHtmlEntryRefs(input: {
  readonly workspaceId: UUID;
  readonly sourceEntryId: UUID;
  readonly html: string;
}, optional: { report?: EntryRefsReport } = {}): readonly EntryRefRow[] {
  const { markers, rejected } = scanEmbedMarkers({ html: input.html });
  warnRejectedMarkers(rejected, input.sourceEntryId, optional.report);

  const refs: EntryRefRow[] = [];
  addMediaConfigRefs({ config: { html: input.html }, path: 'bodyHtml.raw', input, refs });
  let singleTargetRefs = 0;
  let galleryMarkers = 0;
  for (const marker of markers) {
    if (marker.type.toLowerCase() === "gallery") {
      galleryMarkers += 1;
      if (galleryMarkers <= MAX_HTML_PAGE_EMBED_REFS) collectHtmlGalleryRefs({ marker, input, refs });
    } else {
      // Gallery images do not consume unrelated markers' existing single-target reference budget.
      singleTargetRefs += collectHtmlSingleTargetRef({ marker, input, refs });
      if (singleTargetRefs >= MAX_HTML_PAGE_EMBED_REFS) break;
    }
  }

  return refs;
}

type HtmlMarker = ReturnType<typeof scanEmbedMarkers>["markers"][number];
type HtmlRefInput = Pick<ExtractEntryRefsInput, "workspaceId" | "sourceEntryId">;

function collectHtmlGalleryRefs(
  { marker, input, refs }: { marker: HtmlMarker; input: HtmlRefInput; refs: EntryRefRow[] },
  _optional: Record<string, never> = {},
): void {
  // Keep image-specific locators, including repeated media ids. Index authored references
  // even if layout/alt validation fails: safe-delete must still see the dependent page.
  for (const image of galleryMediaReferences({ config: marker.config })) {
    refs.push({
      workspaceId: input.workspaceId,
      sourceEntryId: input.sourceEntryId,
      sourceKind: "page-html-embed",
      fieldPath: `bodyHtml[embed:gallery#${marker.occurrence}].images[${image.index}].mediaId`,
      targetKind: "asset",
      targetId: image.mediaId,
    });
  }
}

function collectHtmlSingleTargetRef(
  { marker, input, refs }: { marker: HtmlMarker; input: HtmlRefInput; refs: EntryRefRow[] },
  _optional: Record<string, never> = {},
): number {
  addMediaConfigRefs({ config: marker.config, path: `bodyHtml[embed:${marker.type.toLowerCase()}#${marker.occurrence}]`, input, refs });
  const targetKind = HTML_EMBED_TARGET_KINDS.get(marker.type.toLowerCase());
  if (!targetKind) return 0;
  const id = marker.id;
  if (!id || id.length > MAX_HTML_EMBED_REF_ID_LENGTH) return 0;

  refs.push({
    workspaceId: input.workspaceId,
    sourceEntryId: input.sourceEntryId,
    sourceKind: "page-html-embed",
    fieldPath: `bodyHtml[embed:${marker.type.toLowerCase()}#${marker.occurrence}]`,
    targetKind,
    targetId: id,
  });
  return 1;
}
