import type { JsonObject } from "@jini-ai/core/primitives";
import type { NavMenuReadModel, ResolvedNavItem, ResolveTargetHrefFn } from "../../navigation/index.js";
import type { MenusPort } from "./ports.js";
import type { WidgetResolveResult, WidgetResolver } from "../types.js";

/**
 * @file `menu` (menu-as-widget) resolver (SPEC-043 REQ-09, ADR-047 §1/§9 — "the primary menu as a
 * widget in the footer region costs nothing new").
 *
 * Purpose:
 * Delegates to `navigation`'s own read model — zero menu STORAGE logic duplicated in `widgets/`
 * (`getMenu`, a real `NavMenuReadModel` call, not a reimplementation of `MenuRepoPort`) — and now
 * also zero menu-HREF-RESOLUTION logic duplicated, via `navigation/resolver.ts`'s exported
 * `resolveMenuDoc` (the doc-level building block `resolveForLocation` itself composes on top of).
 * `resolveItemList`/`resolveItem` stay module-private in `navigation/resolver.ts`; `resolveMenuDoc`
 * is the one exported entry point to their behavior, added specifically so this resolver would not
 * need either an export-widening of those internals or a location-shaped call it doesn't have.
 *
 * Historical limitation (retained to explain the fallback): real href resolution for non-`url` targets (`entryRef`/`termRef`/
 * `route`) needs `src/platform/routing` (ADR-039), which is being built in parallel and is not running code
 * yet anywhere in this codebase — not even `navigation`'s own production callers have a real
 * `ResolveTargetHrefFn` today (`resolveForLocation` takes it as an injected dependency precisely so
 * a fake can stand in until routing lands, per `navigation/resolver.ts`'s own header). This resolver
 * is in the same honest position as the rest of the system, not a special-cased worse one: `url`-kind
 * targets (already-resolved hrefs, no injected dependency needed) now resolve to real, concrete
 * `href`/`available`/`isActive` data; `entryRef`/`termRef`/`route` targets resolve to
 * `available: false, href: null` via the placeholder `resolveTargetHref` below, exactly the outcome
 * `navigation/resolver.ts`'s own doc describes for "cannot resolve" — swap the placeholder for the
 * real routing-backed implementation in one place (`DEFAULT_RESOLVE_TARGET_HREF` below) once
 * `src/platform/routing` ships; no other change needed here.
 * 2026-10-04: runtime roots now inject the routing-backed page/entry resolver. The default remains
 * useful for diagnostics; public widget assembly omits unavailable leaves while retaining parents
 * that still contain visible descendants, matching the static menu's availability contract.
 */
export interface MenuResolverDeps {
  menus: MenusPort;
  navMenuReadModel: NavMenuReadModel;
  /** Public widgets omit unavailable leaves; diagnostics may retain the complete resolved tree. */
  publicOnly?: boolean;
  /** Host routing injection; callers without it retain the diagnostic placeholder documented above. */
  resolveTargetHref?: ResolveTargetHrefFn;
}

/** Before host routing was wired every non-URL target was unresolved; retain that safe null fallback. */
const DEFAULT_RESOLVE_TARGET_HREF: ResolveTargetHrefFn = async () => null;

function toMenuItemProps(items: readonly ResolvedNavItem[], publicOnly: boolean): JsonObject {
  // Cast: ResolvedNavItem is a plain, JSON-serializable read model (navigation/types.ts) with no
  // index signature of its own — the resolved IR contract only requires structural JSON-compatibility.
  const visible = publicOnly ? items.flatMap((item) => {
    const children = toMenuItemProps(item.children, true) as unknown as ResolvedNavItem[];
    return item.available || children.length ? [{ ...item, children }] : [];
  }) : items;
  return visible as unknown as JsonObject;
}

export function createMenuResolver(deps: MenuResolverDeps, _optional: Record<string, never> = {}): WidgetResolver {
  const resolveTargetHref = deps.resolveTargetHref ?? DEFAULT_RESOLVE_TARGET_HREF;

  return {
    async resolveMany(instances, context) {
      const results = new Map<string, WidgetResolveResult>();
      for (const instance of instances) {
        const menuRef = typeof instance.config.menuRef === "string" ? instance.config.menuRef : undefined;
        if (!menuRef) {
          results.set(instance.id, { ok: false, reason: "invalid-config" });
          continue;
        }

        const menu = await deps.navMenuReadModel.getMenu({ workspaceId: context.workspaceId, menuId: menuRef });
        if (!menu) {
          results.set(instance.id, { ok: false, reason: "target-disabled" });
          continue;
        }

        const items = await deps.menus.resolveMenuDoc({
          doc: menu.doc,
          context: { workspaceId: context.workspaceId },
          resolveTargetHref,
        });

        results.set(instance.id, {
          ok: true,
          ir: { componentId: "menu", props: { title: menu.title, items: toMenuItemProps(items, deps.publicOnly === true) } },
          dependencyKeys: [menu.id],
        });
      }
      return results;
    },
  };
}
