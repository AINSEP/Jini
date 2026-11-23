# navigation

Menus as editable content (ADR-029): the whole-tree write service, the derived
location→menu binding index, the render-time read model and resolver. The
universal surface is `@jini-ai/cms/navigation`; `@jini-ai/cms/navigation/node`
adds parse5 menu-HTML normalization; `sql/` holds the SQL adapters; `site/`
holds the site-level integrations a host composes.

## Wiring

- `site/import-menu.ts` — `importMenuEntity({ deps: { clock, idGen, repo, bindingRepo, outbox }, input })`:
  id-preserving, OCC-gated replication of one menu from another instance, plus
  location rebinding without the redundant per-location resaves `assignLocation`
  would cause. The host's publish-content adapter calls it from `apply()`.
- `site/repoint-menu-refs.ts` — `repointMenuItems` / `menuHoldersReferencing`:
  pure tree helpers that rewrite `entryRef` targets after an import changes ids
  (keeping `entryType` and `lastKnownHref`). No repo access.
- `site/trash-menu.ts`, `site/trash-aware-memory-menu-repo.ts`,
  `site/menu-trash-follow-ups.ts`, `site/menu-html-permission.ts` — trash and
  permission integrations.

All `site/` modules import only `@jini-ai/core` and this package's own
navigation modules; host collaborators are injected, never imported.
