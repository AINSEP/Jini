import { ADMIN_SURFACE_ACTION_INTENTS, type AdminSurfaceAuthorizationStart, type AdminSurfaceConnections, type AdminSurfaceConnectionStatus, type AdminSurfaceSignInAttempt } from '../surface-capabilities.js';
import type { AdminSurfaceConnectionsHost, AdminSurfaceDeclaredConnection, AdminSurfaceStagedAccount, AdminSurfaceStatusView } from './ports.js';


/**
 * @file The host's `connections` port for plugin admin-surface handlers (Jini's `AdminSurfaceConnections`):
 * account actions a signed-in admin takes on a plugin's own settings screen, over the same
 * api-connections host the chat sign-in and the tools use.
 *
 * Why the host resolves ids itself: Jini's session already refuses ids the SURFACE did not declare,
 * but only the host knows which connections the calling PLUGIN declares in THIS workspace, so a
 * connection id is turned into its opaque ref here, from the scope's plugin and workspace, and any
 * other id gets one refusal. Refs never leave. A sign-in's authorization URL is reported to
 * `onSignInIssued` so the admin route can let the host page (not the sandboxed frame) open exactly
 * the URLs this host issued. Revocation outcomes are reported verbatim: `confirmed` only when the
 * provider confirmed. A sign-in's `attemptId` is the service's own random id; the OAuth `state`
 * never reaches the plugin.
 */

export interface IssuedSignIn extends AdminSurfaceAuthorizationStart {
  readonly pluginId: string;
  readonly connectionId: string;
}

export interface AdminSurfaceConnectionsDeps<Connection extends AdminSurfaceDeclaredConnection> {
  readonly host: AdminSurfaceConnectionsHost<Connection>;
  readonly onSignInIssued?: (issued: IssuedSignIn) => void;
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "unknown";
}

/** Our own lowercase hyphenated codes pass; anything else (an upstream library's code) becomes one generic code. */
const SAFE_ATTEMPT_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function failedAttempt(error: unknown): AdminSurfaceSignInAttempt {
  const code = codeOf(error);
  return { code: code.length <= 64 && SAFE_ATTEMPT_CODE.test(code) ? code : "sign-in-failed", nextAction: "reconnect" };
}

/** What a status is built from: a record (with its staged switch's account) or a service status view. */
type StatusSource = AdminSurfaceStatusView;
const NEVER_CONNECTED: StatusSource = { status: "disconnected", account: null, grantedScopes: [], pendingSwitch: null };

/** The plugin's declared scope sets whose scopes are all granted. @complexity O(s) hook calls. */
async function grantedScopeSets<Connection extends AdminSurfaceDeclaredConnection>(host: AdminSurfaceConnectionsHost<Connection>, connection: Connection, granted: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const id of connection.scopeSets) {
    if ((await host.requestedScopes({ connection, scopeSetIds: [id] })).every((scope) => granted.includes(scope))) ids.push(id);
  }
  return ids;
}

/** A staged switch's account while it can still be confirmed: after its expiry the confirm refuses, so no label. @complexity O(1). */
function liveStagedAccount(host: { nowMs(): number }, staged: AdminSurfaceStagedAccount | null | undefined): StatusSource["pendingSwitch"] {
  return staged && Date.parse(staged.expiresAt) > host.nowMs() ? staged.account : null;
}

/** Token-free status; scope sets are the plugin's own ids, never raw provider scopes. */
async function statusFrom<Connection extends AdminSurfaceDeclaredConnection>(host: AdminSurfaceConnectionsHost<Connection>, connection: Connection, view: StatusSource, connectionRef: string): Promise<AdminSurfaceConnectionStatus> {
  return {
    connectionId: connection.descriptor.connectionId, status: view.status, accountLabel: view.account?.displayName ?? null,
    grantedScopeSetIds: view.status === "connected" ? await grantedScopeSets(host, connection, view.grantedScopes) : [],
    pendingSwitchAccountLabel: view.pendingSwitch?.displayName ?? null,
    lastSignInAttempt: host.attempts.get(connectionRef) ?? null,
  };
}

/**
 * Builds the per-call connections port for one plugin, workspace and (for account actions) admin.
 * @complexity Each call: one contribution load plus one record read or one service call.
 */
export function createAdminSurfaceConnections<Connection extends AdminSurfaceDeclaredConnection>(
  required: AdminSurfaceConnectionsDeps<Connection> & { readonly pluginId: string; readonly workspaceId: string; readonly principalId?: string | undefined; readonly signal?: AbortSignal | undefined },
  _optional: Record<string, never> = {},
): AdminSurfaceConnections {
  const { host, pluginId, workspaceId, principalId } = required;

  async function resolve(connectionId: string): Promise<{ readonly connection: Connection; readonly connectionRef: string }> {
    const connection = workspaceId === host.workspaceId ? (await host.listConnections({ pluginId })).find((candidate) => candidate.descriptor.connectionId === connectionId) : undefined;
    if (!connection) throw host.notAvailable();
    return { connection, connectionRef: host.connectionKey({ workspaceId, pluginId, connectionId }) };
  }

  /** Account actions need the admin the route authenticated; Jini checks it too. */
  async function forActor(connectionId: string) {
    if (principalId === undefined) throw host.notAvailable();
    return { ...(await resolve(connectionId)), actorId: principalId };
  }

  /** An action's result view, its staged-switch label re-read from the record so an expired one never shows. */
  async function viewAfterAction(connectionRef: string, view: AdminSurfaceStatusView): Promise<StatusSource> {
    return { ...view, pendingSwitch: liveStagedAccount(host, (await host.readRecord({ key: connectionRef }))?.staged) };
  }

  /**
   * Desktop: deposit the callback fields once the loopback sign-in redeemed, and clear a failed
   * attempt; a failure is kept (code and next action only) for `status` and logged by code only.
   */
  function watchDesktopCompletion(connectionId: string, attemptId: string, completion: Promise<{ readonly callbackFields: Readonly<Record<string, string>> } | null> | undefined): void {
    const connectionRef = host.connectionKey({ workspaceId, pluginId, connectionId });
    void completion?.then(
      (done) => {
        if (!done) return;
        host.attempts.delete(connectionRef);
        host.callbackInbox.deposit({ workspaceId, pluginId, connectionId, attemptId, fields: done.callbackFields });
      },
      // Error codes only: a desktop sign-in that failed after the browser opened.
      (error: unknown) => {
        host.attempts.set(connectionRef, failedAttempt(error));
        console.warn(`[admin-surfaces] desktop sign-in for '${pluginId}' did not complete: ${codeOf(error)}`);
      },
    );
  }

  return {
    async getAccessToken({ connectionId }) {
      const { connectionRef } = await forActor(connectionId);
      const pinned = host.pinnedTokenOptions?.({ signal: required.signal, connectionRef }) ?? {};
      return host.getAccessToken({ workspaceId, pluginId, connectionRef }, pinned);
    },
    async status({ connectionId }) {
      const { connection, connectionRef } = await resolve(connectionId);
      if (host.sharedOAuth && await host.sharedOAuth.hasBinding(connection)) {
        const shared = await host.sharedOAuth.getStatus(connection);
        const account = shared?.account ?? null;
        return statusFrom(host, connection, shared ? { ...shared, account, pendingSwitch: null } : NEVER_CONNECTED, connectionRef);
      }
      const record = await host.readRecord({ key: connectionRef });
      return statusFrom(host, connection, record ? { ...record, pendingSwitch: liveStagedAccount(host, record.staged) } : NEVER_CONNECTED, connectionRef);
    },
    async begin({ connectionId, action }, optional = {}) {
      const { connection, actorId } = await forActor(connectionId);
      const shared = host.sharedOAuth && await host.sharedOAuth.hasBinding(connection);
      if (shared && ADMIN_SURFACE_ACTION_INTENTS[action] === "switch-account") throw host.notAvailable();
      const start = await host.startSignIn({ connection, actorId, intent: ADMIN_SURFACE_ACTION_INTENTS[action], scopeSetIds: optional.scopeSetIds ?? [],
        ...(shared ? { destination: "shared" as const } : {}) }, {
        ...(optional.startParams === undefined ? {} : { startParams: optional.startParams }),
      });
      const issued = { authorizationUrl: start.authorizationUrl, attemptId: start.attemptId, expiresAt: start.expiresAt };
      watchDesktopCompletion(connectionId, issued.attemptId, start.completion);
      required.onSignInIssued?.({ ...issued, pluginId, connectionId });
      return issued;
    },
    async confirmSwitch({ connectionId }) {
      const { connection, connectionRef, actorId } = await forActor(connectionId);
      if (host.sharedOAuth && await host.sharedOAuth.hasBinding(connection)) throw host.notAvailable();
      const view = await host.service({ connection }).confirmSwitchAccount({ connectionRef, workspaceId, actorId });
      return statusFrom(host, connection, await viewAfterAction(connectionRef, view), connectionRef);
    },
    async cancelSwitch({ connectionId }) {
      const { connection, connectionRef } = await forActor(connectionId);
      if (host.sharedOAuth && await host.sharedOAuth.hasBinding(connection)) throw host.notAvailable();
      const view = await host.service({ connection }).cancelSwitchAccount({ connectionRef, workspaceId });
      return statusFrom(host, connection, await viewAfterAction(connectionRef, view), connectionRef);
    },
    async disconnect({ connectionId }) {
      const { connection, connectionRef } = await forActor(connectionId);
      if (host.sharedOAuth && await host.sharedOAuth.hasBinding(connection)) {
        await host.sharedOAuth.stopUsing(connection);
        return { ...(await statusFrom(host, connection, NEVER_CONNECTED, connectionRef)), revocation: "not-needed" as const };
      }
      const outcome = await host.service({ connection }).disconnect({ connectionRef, workspaceId });
      // Same vocabulary on both sides: the provider's outcome passes through unchanged.
      return { ...(await statusFrom(host, connection, await viewAfterAction(connectionRef, outcome), connectionRef)), revocation: outcome.remoteRevocation };
    },
    async takeCallbackFields({ connectionId, attemptId }) {
      await resolve(connectionId);
      return host.callbackInbox.take({ workspaceId, pluginId, connectionId, attemptId });
    },
  };
}

