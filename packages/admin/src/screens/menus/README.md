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
