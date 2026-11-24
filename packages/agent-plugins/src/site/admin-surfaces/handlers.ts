import { createAdminSurfaceHandlerHost, defineAdminSurfaceHandlerContribution, type AdminSurfaceCapabilitiesPort, type AdminSurfaceHostKind, type LoadedAdminSurfaceHandlers } from "../../admin-surfaces/index.js";
import type { IssuedTokenMemories } from "../../lifecycle/tools/index.js";
import type { IssuedSignInCollector } from "../../admin-surfaces/node.js";

/**
 * @file Binds plugin-supplied admin-surface handler modules (Jini's G5b handler host) to this site as
 * the admin routes' `AdminSurfaceHost` port. Nothing here names a provider.
 *
 * When the handlers are (re)loaded: once at boot, and again before every surface bootstrap. The
 * admin frame always asks for its bootstrap when a surface opens, before any action, so a plugin
 * enabled since the last load (by any writer: the admin toggle, an assistant tool, an install, in
 * either process) gets its handlers on the next open without a restart or a cross-process signal.
 * Disabling needs no reload to take effect: the surface routes admit only active plugins per
 * request, and a later load drops the module and revokes the capabilities it kept.
 */

type AdminSurfaceHandlerContribution = ReturnType<typeof defineAdminSurfaceHandlerContribution>;
type AdminSurfaceHandlerHost = ReturnType<typeof createAdminSurfaceHandlerHost>;

/** The lifecycle's `loadPluginContributions`, narrowed to this contribution (as the executable-tool host does). */
export type LoadAdminSurfaceHandlers = (
  required: { readonly workspaceId: string; readonly definition: AdminSurfaceHandlerContribution },
  optional: { readonly orderByPluginId?: boolean },
) => Promise<{ readonly items: readonly LoadedAdminSurfaceHandlers[]; readonly refusals: readonly string[] }>;

/** The admin routes' surface host port (the host's `AdminSurfaceHost`), plus `refresh`. */
export interface AgentPluginAdminSurfaceHandlers {
  handlersFor(required: Parameters<AdminSurfaceHandlerHost["handlersFor"]>[0], optional?: Record<string, never>): ReturnType<AdminSurfaceHandlerHost["handlersFor"]>;
  bootstrapData(required: Parameters<AdminSurfaceHandlerHost["bootstrapData"]>[0], optional?: Record<string, never>): ReturnType<AdminSurfaceHandlerHost["bootstrapData"]>;
  /** The sign-in links an action issued, for the host page to offer (absent: none are ever offered). */
  readonly signIns?: Pick<IssuedSignInCollector, "collect">;
  /** Loads the active plugins' handler modules and admits them; resolves to the refusal lines. */
  refresh(required?: Record<string, never>, optional?: Record<string, never>): Promise<readonly string[]>;
}

/**
 * Creates the site's admin-surface handler host.
 * @param required.workspaceId - The site's workspace; every load reads its active plugins.
 * @param required.filename - The host's admin-surfaces contribution filename.
 * @param required.loadContributions - The lifecycle owner's trusted contribution loader.
 * @param required.capabilities - The admin-surface capability port (`capabilities.ts`: tool HTTP/limiter + connections, state, public config).
 * @param required.issuedTokens - The site's one token memory, the SAME instance the tool projection has.
 * @param required.hostKind - `'desktop'` or `'hosted'`, from the runtime the API connections use (one source of truth).
 * @param required.log - Where refusal lines go; the host owns the sink and any log-line prefix.
 * @param optional.signIns - The registry the connections port reports issued sign-ins to; the action route collects it.
 * @returns The `AdminSurfaceHost` port plus `refresh`.
 * @complexity `refresh` is one contribution load, O(p) active packages, plus O(s + a) admission.
 */
export function createAgentPluginAdminSurfaceHandlers(
  required: {
    readonly workspaceId: string; readonly filename: string; readonly loadContributions: LoadAdminSurfaceHandlers; readonly capabilities: AdminSurfaceCapabilitiesPort;
    readonly issuedTokens: IssuedTokenMemories; readonly hostKind: AdminSurfaceHostKind; readonly log: (line: string) => void;
  },
  optional: { readonly signIns?: IssuedSignInCollector } = {},
): AgentPluginAdminSurfaceHandlers {
  const handlerContribution = defineAdminSurfaceHandlerContribution({ filename: required.filename });
  const host = createAdminSurfaceHandlerHost({ capabilities: required.capabilities, issuedTokens: required.issuedTokens, hostKind: required.hostKind });

  async function refresh(): Promise<readonly string[]> {
    const load = await required.loadContributions({ workspaceId: required.workspaceId, definition: handlerContribution }, { orderByPluginId: true });
    const { refusals } = host.sync({ loaded: load.items, refusals: load.refusals });
    for (const line of refusals) required.log(line);
    return refusals;
  }

  return {
    refresh,
    ...(optional.signIns === undefined ? {} : { signIns: optional.signIns }),
    handlersFor: (input, _optional = {}) => host.handlersFor(input),
    async bootstrapData(input, _optional = {}) {
      await refresh();
      return host.bootstrapData(input);
    },
  };
}
