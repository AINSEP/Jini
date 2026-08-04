# Permission catalog migrations: deprecate, don't delete

## The mechanism

`identity/permissions.ts`'s registered permission catalog is append-only in practice: renaming or
splitting a permission string is a **breaking grant migration**, not a simple edit, because existing
role/policy data may already hold the old string. The catalog therefore never deletes a superseded
string outright. Instead:

1. The new string(s) are registered alongside the old one (expand).
2. `permission-migrations.ts`'s `registerPermissionMigration({ from, to, reason })` records a fan-out:
   for every policy holding `from`, add each missing string in `to`. This is additive-only — it never
   removes `from` from a policy.
3. The old string stays registered, marked `DEPRECATED` in its `description`, with a comment
   directing readers not to register any new dependency on it.
4. Only once a deprecation window has passed with **observed zero reliance** on the old string —
   which requires `authorize()`'s decision (which string actually matched) to be logged somewhere,
   so that reliance can actually be measured — can the old string be removed from the catalog and
   from seed/role data (contract). This point is referred to below as the **Point of No Return**.

Removing a deprecated string before its Point of No Return risks silently fail-closed-locking-out any
principal whose grant was never migrated. Reusing a deprecated string's name for something unrelated
after removal would silently resurrect stale grants under a new meaning. Both are why the comment
beside each `DEPRECATED` entry says "do not reuse this string."

As of this writing, no permission string has reached its Point of No Return — every migration below
is still in the expand phase (both strings registered, fan-out migration in place, cutover of
`authorize()` call sites either done or pending, deletion deferred).

## Migrations currently represented in the catalog

Not every row below is the same *kind* of migration. The first four are breaking grant migrations —
the meaning or shape of the permission changed, existing grant data must be walked forward, and
"complete" means the walk-forward is verified and the old string has reached its Point of No Return.
The last two are a **terminology correction** — the permission's meaning and gating behavior are
unchanged, only the string's spelling changed — and are broken out into their own subsection below so
a reader doesn't conflate "renamed for clarity" with "grant data needs migrating."

### Breaking grant migrations (old and new strings differ in meaning or shape)

| Old string | New string(s) | Status | Point of No Return gate |
|---|---|---|---|
| `settings.write` | `settings.workspace.write` + `settings.definitions.manage` | Deprecated, fan-out registered | Data migration must map every existing `settings.write` grant to both new strings (including the admin-tier role) and be verified **before** `authorize()` begins gating settings writes on the new strings. Only then may `settings.write` be removed from the base catalog and seed data. |
| `media.write` | Flat `media.*` set (`media.read`, `.upload`, `.update`, `.delete`, `.delete.force`, `.download_original`, `.upload_svg`) | Deprecated, fan-out registered | Same deprecate-not-delete contract; no removal until a follow-up confirms zero live dependence on the coarse string. |
| `navigation.manage` | `admin.menus.*` (7-entry catalog: `.read`, `.create`, `.update`, `.delete`, `.delete.force`, `.assign`, `.manage`) | Deprecated, fan-out registered, route cutover done | Explicitly deferred pending (a) a persistent identity store shipping and a real deprecation window passing with observed zero reliance, which requires (b) `authorize()`'s decision reason being logged first so that reliance can actually be measured. Scheduling this follow-up is an explicit open item, not silently dropped. |
| `integration.manage` | `admin.integrations.manage` | Deprecated, fan-out registered | Mirrors the `navigation.manage` contract: old grants are inert-but-not-deleted until a follow-up confirms zero live dependence. |

### Terminology correction (old and new strings mean exactly the same thing)

| Old string | New string(s) | Status | Nature |
|---|---|---|---|
| `storage.read` | `database.read` | Deprecated, fan-out registered | Rename only — see below. |
| `storage.migrate` | `database.migrate` | Deprecated, fan-out registered | Rename only — see below. |

These two are carried through the same expand/fan-out/deprecate mechanism as the table above purely
for catalog consistency (one convention for every superseded string), not because there is unresolved
grant data to walk forward or a reliance measurement to take — a terminology-only rename has no
"meaning drift" for a stale grant to fall into, so there is no fail-closed-lockout risk the way there
is for the breaking migrations above. The source is the owner-authorized naming correction (2026-07-20)
recorded in the "Storage" surface's originating architecture decision: the nav label, routes,
`storage.read`/`storage.migrate` permissions, `features/storage`, the `storage-journal.db` sidecar, and
`storage_write_watermark` were all renamed to their `database`-prefixed equivalents because "Storage"
read as ambiguous next to the separate file/blob storage subsystem (Media/Assets). The decision record
is explicit that this is **"a terminology correction, not a redesign"** — every mechanism the owning
decision defines (the read-first Timeline, the single forward-migrate write op, snapshot-anchored
restore points, the sidecar journal, the watermark) is unchanged; only the name changes. Because the
underlying behavior never changed, "completion" for this pair means the old `storage.*` strings can be
removed once callers have migrated to the `database.*` spelling — there is no data-migration gate to
clear first, unlike the entries in the table above.

## Why this belongs here, not inline

Every `DEPRECATED` permission description in `identity/permissions.ts` used to cite the
product-specific architecture decision record that authorized its rename or split. Those citations
were product-specific vocabulary from the host this engine was originally extracted from and have
been removed from the code; this document is where the underlying migration state — what superseded
what, and what has to be true before the old string can actually be deleted — now lives, so that
state remains discoverable without carrying a product's citation scheme into a product-neutral
engine. When a migration in the table above reaches its Point of No Return and the old string is
removed, update this table rather than leaving a stale row.
