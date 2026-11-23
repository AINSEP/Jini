/**
 * @file The result shape of the plugin-declared API-connection sign-in (`runApiConnectionConnect` in
 * `@jini-ai/integrations/api-connections`). It sits in core so a host's service ports can name it
 * without depending on the integrations package.
 */

/**
 * `connectionRef` is the opaque, plugin-scoped key the plugin's tools take as input. It is not a
 * secret: the host refuses it for any plugin that does not declare the connection in this workspace.
 * Returned in both states so a later call can use it once the person finishes signing in.
 */
export type ApiConnectionConnectStatus = { readonly status: "connected" | "waiting-for-sign-in"; readonly connectionRef: string };
