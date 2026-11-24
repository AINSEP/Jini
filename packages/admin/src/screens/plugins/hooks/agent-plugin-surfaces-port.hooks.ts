import type { AdminSurfaceAction, AdminSurfaceActionOutcome, AdminSurfaceBootstrap } from "@jini-ai/core/contracts/site/agent-plugins-admin-surfaces";

/**
 * @file The admin's port onto the server's plugin admin-surface routes (`AGENT_PLUGIN_SURFACES`,
 * `AGENT_PLUGIN_SURFACE_BOOTSTRAP`, `AGENT_PLUGIN_SURFACE_ACTION`). Tests pass a typed fake; the
 * real adapter is `agent-plugin-surfaces-dependencies.hooks.ts`.
 */

/** One admitted surface as the listing returns it. `actions` lets the host page refuse an
 *  undeclared or malformed request before it reaches the server (which checks again). */
export interface AgentPluginSurfaceSummary {
  readonly id: string;
  readonly title: string;
  readonly src: string;
  readonly actions: readonly AdminSurfaceAction[];
  /** The https origins the surface declared it may link to (`linkOrigins`); absent or empty opens nothing. */
  readonly linkOrigins?: readonly string[];
}

/** A sign-in link the SERVER issued while running the action (never one the plugin returned). */
export interface HostSignInLink {
  readonly authorizationUrl: string;
  readonly expiresAt: string;
}

/** The action route's answer: the plugin's outcome, plus the host-issued sign-in links of that request. */
export type AgentPluginSurfaceActionAnswer = AdminSurfaceActionOutcome & { readonly hostSignIns?: readonly HostSignInLink[] };

export interface AgentPluginSurfacesPort {
  list(required: { readonly pluginId: string }, optional?: Record<string, never>): Promise<{ readonly surfaces: readonly AgentPluginSurfaceSummary[] }>;
  bootstrap(required: { readonly pluginId: string; readonly surfaceId: string }, optional?: Record<string, never>): Promise<AdminSurfaceBootstrap>;
  action(required: { readonly pluginId: string; readonly surfaceId: string; readonly action: string; readonly payload: unknown }, optional?: Record<string, never>): Promise<AgentPluginSurfaceActionAnswer>;
}
