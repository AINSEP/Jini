import type { AdminMenu } from "../api/menus-api.types.js";
import type { MenusApi } from "../api/menus-api.js";
import type { MenusPort } from "./menus-port.hooks.js";

/**
 * @file The only place in the menus screen that reaches the host-bound menus API client for the
 * `MenusPort` routes — see `menus-port.hooks.ts` for why the split exists.
 *
 * `trash` goes through the host Trash client's `trash({ type: "menu", id })`, the generic single-item Trash route
 * every admin delete button now shares. The Trash screen owns restoration and permanent removal
 * from here.
 */

/** The host's generic single-item Trash client, as the menus delete reads it. */
export interface MenusTrashClient {
  trash(target: { type: "menu"; id: string }): Promise<{ ok: true; version: number | null }>;
}

/** The live implementation over the host-injected {@link MenusApi}, Trash client and page catalogue
 *  reader (`listPages` — the host owns its pages client and public-path rule). The host builds it once
 *  at its composition root as a module-level singleton. */
export function createMenusPort(
  { api, trash, listPages }: { api: MenusApi; trash: MenusTrashClient; listPages: NonNullable<MenusPort["listPages"]> },
  _optional: Record<string, never> = {}
): MenusPort {
  return {
    listPages,
    listMenus: () => api.listMenus(),
    getMenu: ({ id }, _optional = {}) => api.getMenu({ id }),
    createMenu: ({ input, options }, _optional = {}) => api.createMenu(input, options),
    updateMenuTree: ({ target, options }, _optional = {}) => api.updateMenuTree(target, options),
    trash: ({ id }) => trash.trash({ type: "menu", id }),
  };
}

/** Seed state for {@link createFakeMenusPort}. */
export interface FakeMenusPortOptions {
  menus?: AdminMenu[];
}

/**
 * An in-memory {@link MenusPort} for tests — lets a test describe "there are these two menus"
 * directly, instead of hand-building `Response` objects and stubbing global `fetch`. Shipped
 * alongside the real binding per the pattern's "every port gets a fake" rule.
 */
export function createFakeMenusPort(options: FakeMenusPortOptions = {}): MenusPort & {
  /** Every menu currently in the fake's store, in list order. */
  readonly menus: AdminMenu[];
} {
  const menus = [...(options.menus ?? [])];

  return {
    menus,

    async listMenus() {
      return { menus: [...menus] };
    },

    async getMenu({ id }, _optional = {}) {
      // Id or slug, same fallback as the real server route (readable-slugs S6b) — a test that loads
      // by slug shouldn't need to fake out a whole HTTP layer to see that behavior.
      const menu = menus.find((m) => m.id === id || m.slug === id);
      if (!menu) throw new Error(`fake menu not found: ${id}`);
      return { menu };
    },

    async createMenu({ input, options: createOptions }, _optional = {}) {
      const created: AdminMenu = {
        id: `fake-${menus.length + 1}`,
        workspaceId: "fake-ws",
        slug: input.slug,
        title: input.title,
        status: "draft",
        items: createOptions.items ?? [],
        ...(createOptions.mode ? { mode: createOptions.mode } : {}),
        ...(createOptions.html !== undefined ? { html: createOptions.html } : {}),
        locations: [],
        updatedAt: new Date(0).toISOString(),
        version: 1,
      };
      menus.push(created);
      return { menu: created };
    },

    async updateMenuTree({ target: { id, items }, options: updateOptions }, _optional = {}) {
      const index = menus.findIndex((m) => m.id === id);
      const current = menus[index];
      if (index < 0 || !current) throw new Error(`fake menu not found: ${id}`);
      const updated: AdminMenu = {
        ...current,
        items,
        title: updateOptions.title ?? current.title,
        slug: updateOptions.slug ?? current.slug,
        // Same keep-when-omitted rule as the server's `updateMenuTree`.
        // (`...current` above already carries the kept value when the update omits one.)
        ...(updateOptions.mode === undefined ? {} : { mode: updateOptions.mode }),
        ...(updateOptions.html === undefined ? {} : { html: updateOptions.html }),
        version: current.version + 1,
      };
      menus[index] = updated;
      return { menu: updated };
    },

    async trash({ id }) {
      const index = menus.findIndex((m) => m.id === id);
      const current = menus[index];
      if (index < 0 || !current) throw new Error(`fake menu not found: ${id}`);
      const trashed: AdminMenu = { ...current, status: "trash" };
      menus[index] = trashed;
      return { ok: true, version: trashed.version };
    },
  };
}
