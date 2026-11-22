/**
 * @file `TRASHABLE` — the one place a domain opts into the generic Trash. Design of record:
 * `ADS-memory/.local-artifacts/handoffs/2026-09-21-t8f-trash-more-plan.md` §1/§4.
 *
 * Adding a type to the Trash means adding one entry here — no new adapter file, no new route. Each
 * entry names its own table, marker column and display columns; `createTableTrashAdapter` (written
 * once, `table-adapter.ts`) and `notTrashed`/`isTrashedRecord` (`not-trashed.ts`) read the registry
 * rather than switching on `entityType` themselves.
 *
 * Every table and column is named by its SQL (snake_case) name, never a driver's column object, so
 * the one Kysely body in `table-adapter.ts`/`entry-sql.ts` runs the same on every dialect the storage
 * kernel drives. Names here are module constants, never caller input. A column on the entry's own
 * table is a bare name (`deleted_at`); a display column is qualified (`form_definitions.name`)
 * because a display `join` can bring a second table into the query.
 *
 * Registered today: `form`, `form_submission`, `widget` (an `entries` row scoped to
 * `type = 'widget'`), `menu`, `term`, `taxonomy` (T1). `taxonomy` has no `subtitle`: unlike the plan's
 * entry table suggests, `taxonomies` (`schema.sqlite.ts`) has no `slug` column (only `id`/`name`/
 * `hierarchical`/`status`/`updatedAt`/`version`) — verified by reading the table, not assumed from
 * the plan. `TrashDisplaySpec.subtitle` is optional for exactly this reason.
 */
import type { TrashEntityType, TrashEntry, TrashRegistry } from "../index.js";

/**
 * Builds `TRASHABLE`. Called once at composition (`deps.ts`) and resolved at CALL time thereafter by
 * every consumer (`createTableTrashAdapter`, `notTrashed`, `moveToTrash`) — the returned `Map` is
 * never mutated after this returns, so "resolved at call time" here means "read fresh from the Map
 * on every lookup", not "rebuilt every call".
 *
 * @complexity O(1) — a fixed handful of entries.
 */
export function buildTrashRegistry(): TrashRegistry {
  return new Map<TrashEntityType, TrashEntry>([
    createEmailTemplateTrashEntry(),
    createMemberTrashEntry(),
    createFormTrashEntry(),
    createFormSubmissionTrashEntry(),
    createWidgetTrashEntry(),
    createMenuTrashEntry(),
    createTermTrashEntry(),
    createTaxonomyTrashEntry(),
  ]);
}

function createEmailTemplateTrashEntry(): [TrashEntityType, TrashEntry] {
  return [
      "email-template",
      {
        entityType: "email-template",
        label: "Email template",
        permission: "pages.edit_html",
        table: "posts",
        idColumn: "id",
        workspaceColumn: "workspace_id",
        // MOVE: Templates share Pages storage, but must never trash a page or article by id.
        scope: { column: "kind", equals: "email-template" },
        marker: { kind: "timestamp", column: "deleted_at" },
        versionColumn: "version",
        touchColumn: "updated_at",
        display: { title: "posts.title" },
        purgeFirst: [
          { table: "post_revisions", parentIdColumn: "post_id" },
          { table: "post_search_document", parentIdColumn: "post_id" },
        ],
      },
    ];
}

function createMemberTrashEntry(): [TrashEntityType, TrashEntry] {
  return [
      "member",
      {
        entityType: "member",
        label: "Member",
        permission: "member.manage",
        table: "members",
        idColumn: "id",
        workspaceColumn: "workspace_id",
        marker: { kind: "status", column: "status", trashed: "trash", restoreFallback: "disabled" },
        versionColumn: "version",
        touchColumn: "updated_at",
        display: { title: "members.email" },
        // Financial truth must survive account removal. The former core-order blocker guarded
        // a RESTRICT FK, but that catalog is unwired and retiring; plugin orders remain owned
        // by the store and are never part of this member cascade.
        purgeFirst: [
          { table: "member_sessions", parentIdColumn: "member_id" },
          { table: "member_magic_tokens", parentIdColumn: "member_id" },
          { table: "member_subscriptions", parentIdColumn: "member_id" },
          { table: "member_consents", parentIdColumn: "member_id" },
        ],
        // member_revisions is an append-only audit ledger, not an account's disposable child.
      },
    ];
}

function createFormTrashEntry(): [TrashEntityType, TrashEntry] {
  return [
      "form",
      {
        entityType: "form",
        label: "Form",
        permission: "admin.forms.manage",
        table: "form_definitions",
        idColumn: "id",
        workspaceColumn: "workspace_id",
        marker: { kind: "timestamp", column: "deleted_at" },
        versionColumn: "version",
        display: { title: "form_definitions.name", subtitle: "form_definitions.slug" },
        // `entityType`/`idColumn`: `form_submission` is itself a `TRASHABLE` entry (below), so a purge
        // also cleans up the phantom `trashed_items` row of any submission that was trashed
        // independently first (T1 item 5) — the doc comment on `TrashCascadeSpec.entityType` names
        // this exact case as its example; it was missing here (RED-first regression test).
        purgeFirst: [{ table: "form_submissions", parentIdColumn: "form_definition_id", idColumn: "id", entityType: "form_submission" }],
      },
    ];
}

function createFormSubmissionTrashEntry(): [TrashEntityType, TrashEntry] {
  return [
      "form_submission",
      {
        entityType: "form_submission",
        label: "Form submission",
        permission: "admin.forms.submissions.delete",
        table: "form_submissions",
        idColumn: "id",
        workspaceColumn: "workspace_id",
        marker: { kind: "timestamp", column: "deleted_at" },
        versionColumn: "version",
        // The form's name and when it was sent — never `data_json`: the Trash list is not a place
        // to show a visitor's data. `form_submissions.form_definition_id` is a real FK, so the
        // inner join always finds the form (trashed or not).
        display: {
          title: "form_definitions.name",
          subtitle: "form_submissions.submitted_at",
          join: { table: "form_definitions", on: ["form_definitions.id", "form_submissions.form_definition_id"] },
        },
      },
    ];
}

function createWidgetTrashEntry(): [TrashEntityType, TrashEntry] {
  return [
      "widget",
      {
        entityType: "widget",
        label: "Widget",
        permission: "widgets.delete",
        table: "entries",
        idColumn: "id",
        workspaceColumn: "workspace_id",
        // `entries` holds every entry type; only widgets go to the Trash this way, so a collection
        // entry's id can never be hidden or purged through this entry.
        scope: { column: "type", equals: "widget" },
        // `deleted_at`, not `entries.status` (typed `draft|published|unpublished`) and not the
        // widget payload's own status (changing that needs a parse, which fails on corrupt rows).
        marker: { kind: "timestamp", column: "deleted_at" },
        versionColumn: "version",
        display: { title: "entries.title", subtitle: "entries.slug" },
        // Its own outgoing refs (e.g. a menu widget's `menuRef`) and its revisions. Refs OTHER
        // entries hold to it (a region placement, an embed) stay and render as dangling (REQ-43).
        purgeFirst: [
          { table: "entry_refs", parentIdColumn: "source_entry_id" },
          { table: "entry_revisions", parentIdColumn: "entry_id" },
        ],
      },
    ];
}

function createMenuTrashEntry(): [TrashEntityType, TrashEntry] {
  return [
      "menu",
      {
        entityType: "menu",
        label: "Menu",
        // Verified against `routes/menus/delete.ts:76` — NOT `admin.menus.delete.force`, which T5
        // removes (the plan's decision: purge unassigns bindings instead of refusing).
        permission: "admin.menus.delete",
        table: "menus",
        idColumn: "id",
        workspaceColumn: "workspace_id",
        // `status` already carries draft/published for a live menu; `trash` is a new value alongside
        // them, same pattern the test-only harness in `table-adapter.test.ts` already exercises.
        marker: { kind: "status", column: "status", trashed: "trash", restoreFallback: "published" },
        versionColumn: "version",
        touchColumn: "updated_at",
        display: { title: "menus.title", subtitle: "menus.slug" },
        // A trashed menu's location bindings are removed at PURGE — decision 1 in
        // `2026-09-21-trash-parallel-plan.md` §6 Q1 (recommendation accepted): purge is already the
        // explicit, confirmed permanent step, so "Delete permanently" on a bound menu unassigns it
        // rather than refusing. No `entityType`: bindings are not a `TRASHABLE` kind of their own.
        purgeFirst: [{ table: "nav_location_bindings", parentIdColumn: "menu_id" }],
      },
    ];
}

function createTermTrashEntry(): [TrashEntityType, TrashEntry] {
  return [
      "term",
      {
        entityType: "term",
        label: "Term",
        // Verified against every `routes/taxonomy/*.ts` route: `admin.taxonomy.manage` is the one
        // permission ADR-044 registers for every taxonomy write.
        permission: "admin.taxonomy.manage",
        table: "terms",
        idColumn: "id",
        workspaceColumn: "workspace_id",
        marker: { kind: "status", column: "status", trashed: "trash", restoreFallback: "active" },
        versionColumn: "version",
        touchColumn: "updated_at",
        // The term's own name, plus its taxonomy's name so the Trash list can tell "Red" (Colors)
        // apart from "Red" (Tags) — an inner join, since `terms.taxonomy_id` is a real FK.
        display: {
          title: "terms.name",
          subtitle: "taxonomies.name",
          join: { table: "taxonomies", on: ["taxonomies.id", "terms.taxonomy_id"] },
        },
        // A term's own content assignments — purge deletes them; trash/restore never touch them
        // (decision 5: tags/categories stay assigned while trashed, hidden from reads, restored back).
        purgeFirst: [{ table: "entry_terms", parentIdColumn: "term_id" }],
        // Counts live AND trashed children: a parent can never be trashed while a child (of either
        // state) still points at it, so a purge — which only ever runs on an already-trashed row —
        // can never leave a dangling `parent_id` either.
        blocker: { table: "terms", parentIdColumn: "parent_id", code: "TERM_HAS_CHILDREN" },
        hiddenWithParent: {
          parentTable: "taxonomies",
          parentIdColumn: "taxonomy_id",
          parentPkColumn: "id",
          parentMarker: { kind: "status", column: "status", trashed: "trash", restoreFallback: "active" },
        },
      },
    ];
}

function createTaxonomyTrashEntry(): [TrashEntityType, TrashEntry] {
  return [
      "taxonomy",
      {
        entityType: "taxonomy",
        label: "Taxonomy",
        permission: "admin.taxonomy.manage",
        table: "taxonomies",
        idColumn: "id",
        workspaceColumn: "workspace_id",
        marker: { kind: "status", column: "status", trashed: "trash", restoreFallback: "active" },
        versionColumn: "version",
        touchColumn: "updated_at",
        // No `subtitle` — `taxonomies` has no `slug` column, see the file header.
        display: { title: "taxonomies.name" },
        // Two-hop: `entry_terms` has no `taxonomy_id` column, so its rows are resolved through
        // `terms` first (`term_id IN (SELECT id FROM terms WHERE taxonomy_id = ?)`), THEN the terms
        // themselves are removed (`entityType: "term"` cleans up their `trashed_items` phantom rows
        // too — a term trashed on its own before its taxonomy was purged).
        purgeFirst: [
          {
            table: "entry_terms",
            via: { matchColumn: "term_id", throughTable: "terms", throughIdColumn: "id", throughParentIdColumn: "taxonomy_id" },
          },
          { table: "terms", parentIdColumn: "taxonomy_id", idColumn: "id", entityType: "term" },
        ],
      },
    ];
}
