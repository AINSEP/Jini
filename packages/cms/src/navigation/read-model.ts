/**
 * @file Real `NavMenuReadModel` implementation (ADR-029 §7).
 *
 * Purpose:
 * `navigation/index.ts`'s file header names the entries-backed read model as an
 * implementation-phase item that hadn't landed as running code. This assembles the existing,
 * already-tested `MenuRepoPort` + `NavLocationBindingRepoPort` + `resolver.ts`'s
 * `resolveForLocation` into the one typed read surface `NavMenuReadModel` promises — no new
 * storage or resolution logic, just the composition root boot pass those pieces were always
 * waiting on.
 *
 * `resolveTargetHref` defaults to the honest `async () => null` placeholder — a host's own
 * routing library is not this package's running code, so every non-`url` target resolves to
 * "cannot resolve" here until a host wires its real implementation in. Swap the default in this
 * one place once routing ships in the host.
 */
import type { UUID } from "../core/ports.js";
import type { NavLocationBindingRepoPort, NavMenuReadModel, NavResolveContext } from "./ports.js";
import type { MenuRepoPort } from "./repo.memory.js";
import { resolveForLocation, type ResolveTargetHrefFn } from "./resolver.js";
import type { NavLocationKey, NavMenuEntry } from "./types.js";

export interface NavMenuReadModelDeps {
  menuRepo: MenuRepoPort;
  bindingRepo: NavLocationBindingRepoPort;
  /** Overridable for tests / once a host's routing library lands; defaults to the honest placeholder documented above. */
  resolveTargetHref?: ResolveTargetHrefFn | undefined;
}

const DEFAULT_RESOLVE_TARGET_HREF: ResolveTargetHrefFn = async () => null;

export function createNavMenuReadModel(deps: NavMenuReadModelDeps): NavMenuReadModel {
  const resolveTargetHref = deps.resolveTargetHref ?? DEFAULT_RESOLVE_TARGET_HREF;

  return {
    async getMenu(required: { workspaceId: UUID; menuId: UUID }): Promise<NavMenuEntry | null> {
      return deps.menuRepo.findById({ workspaceId: required.workspaceId, id: required.menuId });
    },

    async getMenuBySlug(required: { workspaceId: UUID; slug: string }): Promise<NavMenuEntry | null> {
      return deps.menuRepo.findBySlug(required);
    },

    async listMenus(required: { workspaceId: UUID }): Promise<NavMenuEntry[]> {
      return deps.menuRepo.list(required);
    },

    async resolveForLocation(required: { context: NavResolveContext; locationKey: NavLocationKey }) {
      return resolveForLocation({
        deps: { menuRepo: deps.menuRepo, bindingRepo: deps.bindingRepo, resolveTargetHref },
        input: {
          workspaceId: required.context.workspaceId,
          locationKey: required.locationKey,
          currentPath: required.context.currentPath,
        },
      });
    },
  };
}
