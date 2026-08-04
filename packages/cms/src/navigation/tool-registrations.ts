/**
 * @file Navigation's (Menus') half of the agent-tool authorization wiring: maps `agent-tools.ts`'s five
 * catalog entries onto `menu-service.ts`'s read/create/update/assign operations, as
 * `ToolRegistration`s. The entire catalog is wired — `deleteMenu` is deliberately absent from the
 * catalog rather than present-but-unwired; see `navigation/agent-tools.ts`'s own header.
 *
 * Authorization shape: like Media and unlike Forms/Identity/Widgets, `menu-service.ts`'s functions
 * perform NO internal `authorize()` call of their own — every admin HTTP route a host builds gates
 * inline. Every handler here does the same via the kit's `requireToolPermission`, which is the
 * single evaluation for these tools, located where the real route locates it.
 */
import type { AuthorizeFn } from "../core/commands/command.js";
import type { OutboxPort } from "../core/ports.js";
import {
  buildDomainRegistrations,
  indexCatalogById,
  requireInputRecord,
  requireNumber,
  requireString,
  requireToolPermission,
  withSchemaOnRejection,
  type AgentToolSideEffect,
  type DerivedRiskByToolId,
  type ToolHandler,
  type ToolRegistration,
} from "../core/tools/registration-kit.js";
import { menusAgentToolCatalog } from "./agent-tools.js";
import { assignLocation, createMenu, MenuNotFoundError, MenuValidationError, updateMenuTree } from "./menu-service.js";
import type { NavLocationBindingRepoPort } from "./ports.js";
import type { MenuRepoPort } from "./repo.memory.js";
import type { NavItemNode, NavMenuEntry } from "./types.js";

const CATALOG_BY_ID = indexCatalogById(menusAgentToolCatalog);

/**
 * The exact slice of the route-deps bag Menus' tool handlers read. Declared structurally (rather
 * than importing a host's own `RouteDeps`) so this module carries no back-edge into any host's
 * composition root. A host's `server/routes/*` satisfies this structurally by passing its existing
 * route-deps object; nothing there needs to change shape.
 */
export interface MenusToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: { nowIso(): string };
  idGen: { newId(): string };
  outbox: OutboxPort;
  menuRepo: MenuRepoPort;
  navLocationBindingRepo: NavLocationBindingRepoPort;
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const menusDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> menuRepo.list: reads only.
  ["menus_list_menus", "none"],
  // -> menuRepo.findById: reads only.
  ["menus_get_menu", "none"],
  // -> createMenu (menu-service.ts): repo.save + outbox.enqueue.
  ["menus_create_menu", "mutates-durable-state"],
  // -> updateMenuTree (menu-service.ts): repo.save + outbox.enqueue.
  ["menus_update_menu_tree", "mutates-durable-state"],
  // -> assignLocation (menu-service.ts): repo.save (maybe twice, on displacement) + bindingRepo.upsert
  //    + outbox.enqueue. Never a delete: deleteMenu is deliberately not exposed (see
  //    navigation/agent-tools.ts's file header).
  ["menus_assign_location", "mutates-durable-state"],
]);

/** The only Menus rejection worth decorating with the published schema — a shape problem a different input would fix. */
function isMenusShapeRejection(error: unknown): boolean {
  return error instanceof MenuValidationError;
}

/** What a Menus tool returns to the model — see {@link toMenuToolView}. */
interface MenuToolView {
  id: string;
  slug: string;
  title: string;
  status: NavMenuEntry["status"];
  items: NavItemNode[];
  locations: string[];
  version: number;
}

/**
 * Projects a `NavMenuEntry` into an explicit model-facing shape rather than returning the domain
 * record verbatim — the same discipline Forms' `toFormDefinitionView` applies. `items` is
 * deep-cloned via a JSON round-trip (the tree is JSON-serializable by construction, `types.ts`'s
 * `NavMenuDoc` doc comment) rather than shallow-copied, since a tool caller pushing onto a nested
 * `children` array must not be able to mutate domain state through the returned view the way a
 * single top-level spread could not protect against.
 */
function toMenuToolView(menu: NavMenuEntry): MenuToolView {
  return {
    id: menu.id,
    slug: menu.slug,
    title: menu.title,
    status: menu.status,
    items: JSON.parse(JSON.stringify(menu.doc.items)) as NavItemNode[],
    locations: [...menu.locations],
    version: menu.version,
  };
}

function menusDeps(routeDeps: MenusToolDeps) {
  return { repo: routeDeps.menuRepo, clock: routeDeps.clock, idGen: routeDeps.idGen, outbox: routeDeps.outbox };
}

export function buildMenusRegistrations(routeDeps: MenusToolDeps): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    menus_list_menus: async (ctx) => {
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "admin.menus.read", entityType: "menu" });
      const menus = await routeDeps.menuRepo.list({ workspaceId: routeDeps.workspaceId });
      return { menus: menus.map(toMenuToolView) };
    },

    menus_get_menu: async (ctx) => {
      const menuId = requireString(requireInputRecord(ctx.input), "menuId");
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "admin.menus.read", entityType: "menu", entityId: menuId });
      const menu = await routeDeps.menuRepo.findById({ workspaceId: routeDeps.workspaceId, id: menuId });
      if (!menu) throw new MenuNotFoundError(`menu '${menuId}' was not found`);
      return { menu: toMenuToolView(menu) };
    },

    menus_create_menu: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "admin.menus.create", entityType: "menu" });
      return withSchemaOnRejection({ toolId: "menus_create_menu", catalog: CATALOG_BY_ID, isShapeRejection: isMenusShapeRejection }, async () => {
        const { menu } = await createMenu({
          deps: menusDeps(routeDeps),
          input: {
            workspaceId: routeDeps.workspaceId,
            title: requireString(input, "title"),
            slug: requireString(input, "slug"),
            items: Array.isArray(input.items) ? (input.items as NavItemNode[]) : undefined,
          },
        });
        return { menu: toMenuToolView(menu) };
      });
    },

    menus_update_menu_tree: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      const menuId = requireString(input, "menuId");
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "admin.menus.update", entityType: "menu", entityId: menuId });
      if (!Array.isArray(input.items)) throw new Error("'items' (array) is required");
      return withSchemaOnRejection({ toolId: "menus_update_menu_tree", catalog: CATALOG_BY_ID, isShapeRejection: isMenusShapeRejection }, async () => {
        const { menu } = await updateMenuTree({
          deps: menusDeps(routeDeps),
          input: {
            workspaceId: routeDeps.workspaceId,
            id: menuId,
            expectedVersion: requireNumber(input, "expectedVersion"),
            title: typeof input.title === "string" ? input.title : undefined,
            slug: typeof input.slug === "string" ? input.slug : undefined,
            items: input.items as NavItemNode[],
          },
        });
        return { menu: toMenuToolView(menu) };
      });
    },

    menus_assign_location: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      const menuId = requireString(input, "menuId");
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "admin.menus.assign", entityType: "menu", entityId: menuId });
      const { menu, binding, displacedMenu } = await assignLocation({
        deps: { ...menusDeps(routeDeps), bindingRepo: routeDeps.navLocationBindingRepo },
        input: { workspaceId: routeDeps.workspaceId, menuId, locationKey: requireString(input, "locationKey") },
      });
      return {
        menu: toMenuToolView(menu),
        binding: { locationKey: binding.locationKey, menuId: binding.menuId },
        displacedMenu: displacedMenu ? toMenuToolView(displacedMenu) : null,
      };
    },
  };

  // No `unwiredToolIds`: Menus wires its ENTIRE catalog, same tripwire discipline as Forms.
  return buildDomainRegistrations({
    domain: "menus",
    catalogModule: "navigation/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    handlers,
    derivedRisk: menusDerivedRisk,
  });
}
