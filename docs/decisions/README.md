# `docs/decisions/`: Jini's own decision records

This engine was extracted from a host product (the code still calls it "a host" or "the host
application" throughout) whose source once carried that product's own `ADR-nnn`/`SPEC-nnn`/
`ADR-PIPE-nnn` architecture-decision citations directly in comments, docstrings, and a handful of
runtime strings. An engine meant to be reused by other hosts must not carry one particular host's
internal citation scheme — a reader with no access to that host's decision archive couldn't follow
the pointer, and the citation style itself implied a product coupling this package doesn't have.

The sweep that removed those citations left two kinds of trace, by design:

- **Most citations were pure decoration.** The comment's own prose already carried the full
  reasoning; the citation just named where the decision happened to be filed. Those were dropped in
  place — Table 2 below lists them, so the audit trail back to "why does this code say what it
  says" survives even without the citation.
- **A minority gated something a reader genuinely needs**, not just decoration: a `DEPRECATED`
  marker pending an unfinished migration, a reserved value whose reservation only makes sense with
  its rationale, an invariant that would look like a bug to a refactorer without it, or a guard that
  looks redundant but isn't. Those were re-homed into this directory instead — new, product-neutral
  documents written from the originating decision's real content, not a paraphrase of the code
  comment that cited it. Table 1 below maps each to where it now lives.

This directory holds **Jini's own** decision records, not a copy of the host's archive. Provenance
back to the originating host decision is kept deliberately, in each document's own "Source" section,
so an invariant can still be traced to the decision that created it if that's ever needed — the
documents themselves describe only Jini's code, never the host by name.

## Table 1 — Re-homed

Citations whose rationale was load-bearing enough to move into a document here, rather than just
dropped.

| Originating citation | What it gated | Now lives in |
|---|---|---|
| `ADR-027` | `media.write` → flat `media.*` permission split | `permission-catalog-migration.md` |
| `ADR-028 §7` | `settings.write` → `settings.workspace.write` + `settings.definitions.manage` split | `permission-catalog-migration.md` |
| `ADR-PIPE-012` (D-1/D-2/D-9) | `navigation.manage` → `admin.menus.*` 7-entry split | `permission-catalog-migration.md` |
| `ADR-PIPE-015` Phase 3 | `integration.manage` → `admin.integrations.manage` rename | `permission-catalog-migration.md` |
| `ADR-041` naming-correction note | `storage.read`/`storage.migrate` → `database.read`/`database.migrate` (terminology-only) | `permission-catalog-migration.md` |
| `ADR-044` | Why the `post`/`page` taxonomy allow-list is permanent, not a stopgap pending a general content-type registry | `taxonomy-content-type-allow-list.md` |
| `ADR-046` (production-readiness design record) | Why `assignTerms`'s workspace-mismatch branch stays even though every current adapter makes it unreachable — single-node is the deliberate scaling target, not a stopgap | `taxonomy-content-type-allow-list.md` |
| `ADR-PIPE-008` Decision §3 | Why `{type:"json"}` is the one non-scalar `SettingValueSchema` variant, and why it must stay narrow/policed | `settings-json-schema-variant.md` |
| `ADR-008` | Change-set vocabulary and persistence contract; reserved `DomainEvent.actorId`/`changeSetId` fields | `change-set-outbox-transaction-boundary.md` |
| `ADR-046` BR-04 resolution (Phase 1, pending Phase 3) | Why `ChangeSetRepoPort.insert()` takes an optional third `event` argument instead of a threaded transaction handle, and why the domain-write compensating-rollback path is not dead code | `change-set-outbox-transaction-boundary.md` |

## Table 2 — Neutralized (dropped in place)

Citations where the surrounding prose already carried the full reasoning — the citation named a
source, it wasn't the source. Restated product-neutrally (e.g. "the host's single content-write
chokepoint", "a module-boundary convention") and the specific `ADR-nnn`/`SPEC-nnn` token removed. No
document was created for these; this table is the record that they existed and roughly what they
were about.

### Cross-cutting architectural conventions (cited across most domains)

| Citation | What it named |
|---|---|
| `ADR-006` | The rule-of-two convention: a port needs a real second adapter (or an explicit reason it doesn't) before it's trusted as a seam. Cited in content-types, media, navigation, settings, identity, and elsewhere. |
| `ADR-009` | "A module's public contract is its `index.ts`" (§1, barrel convention) and the outbox/async/workspace-scoped domain-event shape (§2). Cited in nearly every domain's barrel file. |
| `ADR-021` | The single-evaluator `authorize()` rule (§2), the flat `domain.verb` permission-string convention (§3), and the identity/RBAC port contracts generally. Cited throughout identity, content-types, entries, taxonomy, and `core/tools`. |
| `ADR-022` | The single write chokepoint discipline for `taxonomies`/`terms`/`entry_terms`/content entities. Cited in taxonomy, content-types, entries. |
| `ADR-029` | Barrel/public-surface convention and domain-specific decisions for the `navigation`, `content-types`, and `entries` libraries. |
| `ADR-042` | The closed-union-dispatch convention applied to content-type/entry lifecycle `op` handling. |
| `ADR-043` | Shared vocabulary between the `content-types` and `entries` packages (paired with `SPEC-020`). |
| `ADR-049` Decision 4 | The cross-domain agent-tool wiring split (`agent-tools.ts` catalog + `tool-registrations.ts` wiring), used identically by every domain. |
| `SPEC-006` | The identity (users/roles/policies) specification — REQ numbers behind authorization gates and admin CRUD transitions. |
| `SPEC-007` | The settings ledger specification — REQ numbers behind the write chokepoint, definition cache, and agent-tool catalog. |
| `SPEC-016` | The gated-mutation gateway contract (token/plan-staleness rules, actor-identity envelope) shared by content-types' destructive-cleanup ceremony and other domains' agent tools. |
| `SPEC-018` | The taxonomy behavior specification — C-nnn/REQ numbers behind write-service ordering and the agent-tool catalog. |
| `SPEC-020` | Shared vocabulary and REQ numbers between the `content-types` and `entries` packages (paired with `ADR-022`/`ADR-043`). |
| `SPEC-044` | The workspace-administration specification — REQ numbers behind `create`/`update`/`delete`/`list` and the agent-tool catalog. |

### Domain- or decision-specific (single citation or a small cluster)

| Citation | What it named |
|---|---|
| `ADR-003` (GOV-ADR-003) | Governance rule making the identifier grammar load-bearing for DDL safety. |
| `ADR-005` / `SPEC-005` | Permission-catalog conventions applied to authorization generally. |
| `ADR-007` | Tenant/workspace scoping — every domain event and adapter row is scoped by `workspaceId`. |
| `ADR-012` | Workspace-prefixed storage keys (the `uploads/` convention). |
| `ADR-014` | The host's server-side tool filter that consumes agent-tool catalogs. |
| `ADR-015` | Transaction rule-of-two. |
| `ADR-020` §6 | The render-IR boundary — a theme receives resolved data and never resolves refs itself. |
| `ADR-024` | Tree-validation totality/bounded-depth amendment (paired with `ADR-029` §6). |
| `ADR-031` §6 / `SPEC-033` | The flat `comments.*` permission catalog, mirroring the `analytics.read` precedent. |
| `ADR-035` | Historical note about a never-implemented `admin.analytics.view` permission string. |
| `ADR-036` | Webhooks' `read`/`redeliver` granularity precedent; integrations' `authorize()` route wiring. |
| `ADR-045` | Paired with `ADR-041` — the "Storage" → "Database" naming correction. |
| `ADR-047` §5/§8 / `SPEC-043` | The Widgets flat `widgets.*` permission catalog and its Debate Fold-In amendments. |
| `ADR-PIPE-007` | Settings port contract, boot-safety precedent. |
| `ADR-PIPE-008` (other aspect) | `SPEC-008`: the single umbrella permission every freshly-seeded workspace's built-in admin role gets. |
| `ADR-PIPE-009` / `SPEC-009` | Permission gate for all 7 admin `redirects` endpoints. |
| `ADR-PIPE-010` / `SPEC-010` | Forms' `admin.forms.*` capability split and PII-split precedent. |
| `ADR-PIPE-011` / `SPEC-011` | Newsletter's `admin.newsletter.*` permission catalog. |
| `ADR-PIPE-014` | Registration of the `analytics.read` permission (closing a standing authorization gap). |
| `ADR-PIPE-018` | A content-types index-provisioning composition unit (CIC U-001). |
| `ADR-PIPE-020` | The `onBeforeCleanupExecute` hook's rejection-surface description. |
| `SPEC-001` | The command gateway calling `authorize()` before every mutation. |
| `SPEC-004` | Presentation: discovered theme ids replacing the legacy hardcoded fallback set. |
| `SPEC-021` | Media permission migration clause, paired with `ADR-027`. |
| `SPEC-030` | The module-status admin route's authorization gate (`ADR-046` Phase 2). |

## If you're re-homing something new

Follow the shape of the four documents already here: state the invariant or decision, explain why
it exists and why it's still needed, and — if the citation traced back to a real host document —
record that provenance in a "Source" section without naming the host product. Add a row to Table 1
above and drop the corresponding row from wherever it currently sits (or from Table 2, if it was
previously recorded there as neutralized).
