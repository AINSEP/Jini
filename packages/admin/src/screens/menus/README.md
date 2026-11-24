# screens/menus

## Wiring

- `hooks/menus-dependencies.hooks.ts` — `createMenusPort({ api, trash, listPages })`: `api` is the
  host-bound menus API client, `trash` the host's generic single-item Trash client and `listPages`
  the host's page catalogue reader (it owns its pages client and public-path rule). Built once at the
  host's composition root; `createFakeMenusPort` is the in-memory test double.
- `api/menus-api.ts` — the menus admin API client. The host injects its authenticated admin
  `request` (it owns the base URL, auth, retries and error decoding) and the `workspaceId` every menus path is scoped to and builds the client once at its
  composition root.
- `MenuPageLinkFields.tsx` takes its state hook as the REQUIRED `useMenuPageLinkFields` prop; the host passes `MenuPageLinkFields.hooks`' `useMenuPageLinkFields` (or a test double). It emits only `jini-menu-page-link-*` classes.
- `menus-host-kit.ts` — `MenusHostKit`: `isApiError` (the host's admin request error class as a
  predicate; the trash classifier's 404 / `TRASH_VERSION_CHANGED` branches narrow on it),
  `isVersionConflict` + `versionConflictMessage` (a lost compare-and-set and its untranslated copy
  key), `toSlug` (the host's browser-safe slug rule), `slugRedirectPath` (the admin shell's rule, bound
  by the host) and `failures` (`getGeneration`, `isClipboardRefusal`, `publishLocal` over the host's
  admin failure channel).
- `hooks/use-menus.hooks.ts` — `useMenus({ port, t, kit }, _optional = {})`: the host passes its
  menus port, a bound menus-dictionary translator and its `MenusHostKit`.
- `hooks/use-menu-editor.hooks.ts` — `useMenuEditor({ menuId, dependencies: { port, navigate, t, kit, clipboard?, itemIdSource? } }, _optional = {})`:
  the host passes its menus port, its router `navigate`, a bound menus-dictionary translator and its
  `MenusHostKit`; `clipboard`/`itemIdSource` default to the browser's. Data goes through the admin
  kit (`useCachedLoader`, `useFetchQuery`, `useFetchMutation`, `useDirtyGuard`), so the host mounts
  `AdminKitProvider`. Sub-hooks: `use-menu-editor-state.hooks.ts` (state + setters),
  `use-menu-editor-writes.hooks.ts` (Copy HTML embed, Save), `menu-tree.ts` (pure tree ops).
- `Menus.tsx` — the list screen. REQUIRED props: `useMenusHook` (the host's wired `useMenus`),
  `publishAction` (the host's section publish control), `newMenuHref` and `menuHref({ slug })` (the
  host's routes). Emits only `jini-*` classes (`jini-page*`, `jini-notice`, `jini-card`,
  `jini-empty-state`, `jini-btn-primary`).
