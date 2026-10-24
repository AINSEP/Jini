Spec ID: SPEC-JINI-VIBECODING-BEHAVIOR
Version: 2.1.0
Last Edited: 2026-10-24
Hash: sha256:0cee8296a14b7ddab0e59ea9476fcffadd0dc030683908564ea45d6a08b9115c
spec_mode: reverse_spec


# Behavior contract: vibecoding

## Edit ordering and authority

- WHEN applying an edit, the loop shall await validation before replacing content. Rejected edits shall make no replace call. Validation and replace exceptions shall become failed outcomes with an Error; a validation exception shall make no replace call.
- The universal `applyEdits` API remains sequential and is unsuitable for atomic file-tree turns; use Node project `applyTurn`.
- WHEN applying a batch, the loop shall process proposals sequentially and return aligned outcomes; rejected/failed outcomes, including validation failures, shall not halt later edits. The loop shall not enforce a separate part allowlist beyond the supplied target's validation.
- WHEN a history transaction finishes, it shall record actual successful changes, including repeated IDs, omit unchanged writes and clear redo only for a nonempty entry. Successful partial writes shall remain undoable when work throws.
- WHEN undoing, history shall replay before-content in reverse change order; redo shall replay after-content in original order. Both shall bypass validation and move stacks only after successful replay. Failure can leave partial target changes with the entry still retryable.
- WHEN restoring through history, history shall capture before-content and record the entry before replay; parts absent from the snapshot shall be left alone. Undoing creation shall write empty content because the target has no delete verb.

## HTML guards and limits

- The region target shall accept handles matching `[a-z0-9]+(?:-[a-z0-9]+)*`, at most 128 characters. It shall default to a 262144-character replacement cap; this measures JavaScript string length, not UTF-8 bytes.
- WHEN validating a replacement, the target shall splice the prospective document, apply the optional structural check and require identical handle multisets before/after. It shall reject invented, removed or duplicated handles.
- WHEN replacing directly, the target shall splice only the region's inner range and preserve surrounding string content. Direct replace does not invoke validation. The consumer must route new proposals through apply APIs.
- WHEN reading/replacing, the HTML target shall require exactly one matching handle; it shall not create missing regions, despite the general port's upsert description. Restore shall reparse between writes and skip missing/ambiguous regions.
- WHEN the strict parse5 adapter cannot locate every tagged region safely, it shall throw on find and reject on structural check. Tagged void/unclosed/dropped nodes shall fail there. Comments and literal-text bodies shall not inflate the raw-handle cross-check.
- WHEN listing/snapshotting duplicate HTML handles, the target shall omit every occurrence of each ambiguous handle. Unique valid handles shall retain document order and metadata; read/replace shall reject ambiguity.

## HTML region scan + pure edits

- `scanHtmlRegions` shall never throw because markup is malformed. It shall retain every tree-discovered handle, including duplicates, empty values and legacy grammar, and attach `problem` to regions without safe explicit boundaries. A tagged void element or an implicitly closed tagged element shall remain discoverable but not replaceable. A source handle lost by parser recovery shall yield `documentProblem`; parse errors shall be diagnostic reasons. Other safely located regions shall remain readable/editable.
- Comments and raw-text/RCDATA bodies shall be masked using parser locations before the dropped-handle count. This includes script, style, xmp, iframe, noembed, noframes, noscript, plaintext, textarea and title bodies; their opening-tag attributes still count. With scripting enabled, `<noscript>` contains literal text, so markup-looking handles inside it shall not be regions.
- Regions and direct fragment-child elements shall be ordered by original source offset, even after table foster-parenting. Offsets shall index the unchanged UTF-16 source, preserving CRLF, BOM and astral characters. Top-level advice may use recovered EOF/implied-close boundaries; safe edits require explicitly located closing tags. No synthetic region depth shall be exposed.
- WHEN parse5 reconstructs formatting clones with the same authored start offset, the scan shall collapse them to one address and mark it unsafe. A clone acquiring a later closing tag shall not make that address safely replaceable. Adding unrelated text shall not count these clones as newly duplicated handles.
- `locateRegion` shall return absent (with available handles), ambiguous (with count), or not-replaceable (with tag), instead of throwing. Duplicate detection shall precede the per-region safety check. `documentProblem` and parse-error diagnostics shall not globally refuse otherwise safe lookup.
- `replaceRegionInner` shall splice only the supplied inner range. `moveRegion` shall move the whole supplied element, carrying trailing whitespace or leading whitespace when no trailing run exists, and refuse self/descendant destinations. Both require safe regions from the exact source; neither shall parse, validate offsets or commit storage. Unchanged source outside the splice/move shall retain its exact content.
- `handlesMadeAmbiguous` shall report each handle once when its after-count exceeds both one and its before-count, in after source order. Unchanged/reduced existing ambiguity shall not be reported. `regionHandlesIn` shall retain all discovered occurrences without grammar filtering.
- `suggestRegionHandle` shall use the first heading only, replace inline tags with spaces, call the injected host slugifier, truncate to 48 code units and remove trailing hyphens. Missing headings, empty slugs and collisions shall yield no suggestion; no positional fallback shall be invented. `untaggedTopLevelSections` shall examine only untagged direct content elements, skip style/script/template/link/meta/base/title and reserve successful suggestions across the batch.
- Hosts shall scan each distinct source string once and reuse that scan across helpers. The pure path shall permit adding/removing descendant handles and shall leave storage, authorization, concurrency checks and write policy to its host. The strict target's identical-handle-multiset rule shall remain unchanged.

Intentional differences from Tovu's former lexical scanner (the helpers' origin), recorded in the scan/edit test headers:

- A non-void `<div … />` remains open and may contain following siblings until closed. The slash does not create an empty region; `<section data-agent-element="hero"/>body</section>` has an explicit closing tag and shall remain editable.
- Unclosed top-level elements shall use parse5's recovered boundaries for tagging advice. Malformed opening tags and unterminated declarations shall follow HTML5 recovery rather than lexical skip rules; dropped unfinished handles shall be document diagnostics while safe regions remain usable.
- Unquoted values and upper-case attribute names shall be recognized according to browser parsing. `noscript` shall be a text body, and formatting reconstruction shall collapse clones as described above.

For Tovu Pages, the approved integration uses the scan and pure helpers directly: read → compute →
write against the original captured version. It shall not use `EditTarget`/`createHtmlRegionTarget`,
whose additional reads would recapture that version and weaken the host's compare-and-swap guard.
The Pages handle policy permits additions/removals and refuses newly worsened ambiguity; it is
not an authorization boundary, since `pages.edit_html` already permits whole-page replacement.
Malformed HTML shall produce warnings per region/document and shall not itself refuse a Pages
read or write; unsafe individual regions still cannot be spliced on guessed boundaries. Do not
add a whole-document `checkWellFormed` refusal there. Pages undo restores a saved `post_revisions`
revision; it shall not use an in-memory undo stack. No Pages save rate limit is required. These are
host decisions; the universal history and strict target APIs retain their existing contracts.

## Session and tools

- Sessions/tools are universal through `./session`, with identical re-exports from `./react`. Injected `{history, applyTurn}` delegates whole-turn recording to the project. Project sessions clear cached content, relist after mutation/replay, and read through to detect external drift; the default HTML session retains lazy caching.
- The default session shall lazily cache content, update cache from successful edit/history data and relist on refresh/apply/restore. Refresh shall drop removed IDs but shall not reread changed content for retained IDs.
- WHEN session work rejects, the session shall expose error/lastError and rethrow. The hook shall catch mount-refresh errors; consumers calling actions directly must handle rejection.
- Tool registrations shall follow fixed list/read/propose/undo/redo order, default to allow policy, and declare 10000ms timeouts except propose at 15000ms. The direct runner shall not enforce these deadlines or authorization.
- WHEN proposing via tools, handlers shall require 1–50 edits, nonempty string IDs and string content; empty replacement content is valid. Runtime handlers do not reject every additional property advertised as forbidden by JSON Schema; the consumer registry owns full schema enforcement.
- History default retention shall be 50 entries. The implementation does not validate limit; consumers must supply a finite nonnegative integer. A negative value can make trimming loop indefinitely.

No request idempotency, process runner, package installer, build manager, model transport, persistent history, HTML sanitizer or CSS theme service is supplied. Preview isolation is defined in `ui.spec.md`.

Evidence: core/apply/history, html/regions, html/node parser, React session/tools and their source tests. Known contradictions are current-source observations, not execution results.

Decision rationale: [Per-region diagnostics and strict adapter safety](../decisions/DR-001-conservative-region-detection.md).

Node project validation, path authority, crash recovery and drift semantics are defined together in [API: Node projects](api.spec.md#node-projects).
