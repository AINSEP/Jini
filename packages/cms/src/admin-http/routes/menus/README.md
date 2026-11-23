# `admin-http/routes/menus`

Admin route specs for navigation menus (ADR-029): list, get-by-id, create, update-tree,
assign-location and delete (move to Trash). Response DTOs live in `../../http/menus.ts`.

## Wiring

**Outward error copy.** `create`, `update-tree`, `assign-location` and `delete` refuse a classified menu error (their module-level `mapMenuError` tables) with the status and code decided here, but take the `error` text from the REQUIRED `outwardErrorMessage` deps field (`../../http/outward-error-message.ts`), applied at handling time by `rejectMenuError`. The host binds it at the mount. The trashed-menu 409 (`MENU_NOT_LIVE_MAPPING`) still answers through the shared `entityNotLiveResponse`.

Architecture and the inject-everything rule: [`extraction-plan.md`](../../../../../../ADS-memory/reports/jini-port/extraction-plan.md).
The reference pattern these specs copy is `../redirects/`.

**Provides** (each a `defineJsonRoute` spec; principal type `MenuRoutePrincipal = { id }`):

| spec | file | deps type |
|---|---|---|
| `menuListRoute` | `list.ts` | `MenuListRouteDeps` (`workspaceId`, `menuRepo.list`) |
| `menuGetRoute` | `get-by-id.ts` | `MenuGetRouteDeps` (`workspaceId`, `menuRepo.findBySlug/findById`) |
| `menuCreateRoute` (201) | `create.ts` | `MenuCreateRouteDeps` (`workspaceId`, `menuRepo`, `clock`, `idGen`, `outbox`, `normalizeMenuHtml`) |
| `menuUpdateTreeRoute` | `update-tree.ts` | `MenuUpdateTreeRouteDeps` (same fields as create) |
| `menuAssignLocationRoute` | `assign-location.ts` | `MenuAssignLocationRouteDeps` (`workspaceId`, `menuRepo`, `navLocationBindingRepo`, `clock`, `idGen`, `outbox`) |
| `menuDeleteRoute` | `delete.ts` | `MenuDeleteRouteDeps` (`workspaceId`, `menuRepo`, `removeMenu`, `clock.nowIso`) |

**Injected by the host:** the ports (`workspace` guard, `authenticate`, `authorize`, `onError`),
`normalizeMenuHtml` (Node hosts pass `navigation/node`'s `normalizeMenuHtml`; it is required here so
submitted HTML is never stored unbalanced), and `removeMenu` (the host's Trash pipeline remove step).

```ts
import { menuCreateRoute } from "@jini-ai/cms/admin-http/routes/menus/create";
import { normalizeMenuHtml } from "@jini-ai/cms/navigation/node";

mountAdminJsonRoute({ app, spec: menuCreateRoute, deps: {
  workspaceId, authorize,                       // port fields
  menuRepo, clock, idGen, outbox, normalizeMenuHtml,
} }, { failure: { operation: "routes/menus/create", code: "INTERNAL_ERROR" } });
```

Refusals are thrown `rejectRoute` bodies (`{ error }`, plus `code` only where the old route sent one,
e.g. `VERSION_CONFLICT`); anything unmapped is rethrown for the host's `onError` port.

**Must never import:** `express`, `@jini-ai/http-kit`, any host code, or any non-core `@jini-ai/*`
package. Only `@jini-ai/core` and `@jini-ai/cms`'s own modules.
