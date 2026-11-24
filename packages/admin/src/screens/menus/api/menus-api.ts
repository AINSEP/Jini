import type { AdminMenu, AdminMenuAuthoring, AdminMenuItem } from "./menus-api.types.js";

/** The host's authenticated admin request — it owns the base URL, authentication, retries and
 *  error decoding, so this client only names paths, methods and bodies. */
export type MenusRequestFn = <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;

/** The admin API calls of the menus feature, bound to the host's injected collaborators.
 *  @example const menusApi = createMenusApi({ request, workspaceId }); */
export function createMenusApi({ request, workspaceId }: { request: MenusRequestFn; workspaceId: string }, _optional: Record<string, never> = {}) {
  return {
    listMenus: () =>
      request<{ menus: AdminMenu[] }>({ path: `/workspaces/${workspaceId}/menus` }),
    getMenu: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{ menu: AdminMenu }>({ path: `/workspaces/${workspaceId}/menus/${encodeURIComponent(id)}` }),
    createMenu: (
      { title, slug }: { title: string; slug: string },
      options: { items?: AdminMenuItem[] } & AdminMenuAuthoring = {}
    ) =>
      request<{ menu: AdminMenu }>({ path: `/workspaces/${workspaceId}/menus` }, { init: {
        method: "POST",
        body: JSON.stringify({ title, slug, items: options.items, mode: options.mode, html: options.html }),
      } }),
    updateMenuTree: (
      { id, expectedVersion, items }: { id: string; expectedVersion: number; items: AdminMenuItem[] },
      options: { title?: string; slug?: string } & AdminMenuAuthoring = {}
    ) =>
      request<{ menu: AdminMenu }>({ path: `/workspaces/${workspaceId}/menus/${encodeURIComponent(id)}` }, { init: {
        method: "PUT",
        body: JSON.stringify({ expectedVersion, items, title: options.title, slug: options.slug, mode: options.mode, html: options.html }),
      } }),
  };
}

/** The menus API client {@link createMenusApi} builds. */
export type MenusApi = ReturnType<typeof createMenusApi>;
