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

| Old string | New string(s) | Status | Point of No Return gate |
|---|---|---|---|
| `settings.write` | `settings.workspace.write` + `settings.definitions.manage` | Deprecated, fan-out registered | Data migration must map every existing `settings.write` grant to both new strings (including the admin-tier role) and be verified **before** `authorize()` begins gating settings writes on the new strings. Only then may `settings.write` be removed from the base catalog and seed data. |
| `media.write` | Flat `media.*` set (`media.read`, `.upload`, `.update`, `.delete`, `.delete.force`, `.download_original`, `.upload_svg`) | Deprecated, fan-out registered | Same deprecate-not-delete contract; no removal until a follow-up confirms zero live dependence on the coarse string. |
| `navigation.manage` | `admin.menus.*` (7-entry catalog: `.read`, `.create`, `.update`, `.delete`, `.delete.force`, `.assign`, `.manage`) | Deprecated, fan-out registered, route cutover done | Explicitly deferred pending (a) a persistent identity store shipping and a real deprecation window passing with observed zero reliance, which requires (b) `authorize()`'s decision reason being logged first so that reliance can actually be measured. Scheduling this follow-up is an explicit open item, not silently dropped. |
| `integration.manage` | `admin.integrations.manage` | Deprecated, fan-out registered | Mirrors the `navigation.manage` contract: old grants are inert-but-not-deleted until a follow-up confirms zero live dependence. |
| `storage.read` | `database.read` | Deprecated, fan-out registered | Renamed because "Storage" read as ambiguous next to the Media/Assets subsystem's own file/blob storage. Same deprecate-not-delete contract as the other entries in this table. |
| `storage.migrate` | `database.migrate` | Deprecated, fan-out registered | Same rename and same contract as `storage.read` → `database.read`. |

## Why this belongs here, not inline

Every `DEPRECATED` permission description in `identity/permissions.ts` used to cite the
product-specific architecture decision record that authorized its rename or split. Those citations
were product-specific vocabulary from the host this engine was originally extracted from and have
been removed from the code; this document is where the underlying migration state — what superseded
what, and what has to be true before the old string can actually be deleted — now lives, so that
state remains discoverable without carrying a product's citation scheme into a product-neutral
engine. When a migration in the table above reaches its Point of No Return and the old string is
removed, update this table rather than leaving a stale row.
