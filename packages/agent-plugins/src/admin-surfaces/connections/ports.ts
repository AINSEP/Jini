import type { AdminSurfaceAuthorizationStart, AdminSurfaceConnectionState, AdminSurfaceRevocationOutcome, AdminSurfaceSignInAttempt } from '../surface-capabilities.js';
import type { AdminSurfaceCallbackFieldKey } from '../callback-field-inbox.js';

/** The loaded connection stays opaque beyond the fields this domain actually reads. */
export interface AdminSurfaceDeclaredConnection { readonly pluginId: string; readonly descriptor: { readonly connectionId: string }; readonly scopeSets: readonly string[] }
export interface AdminSurfaceConnectionAccount { readonly accountId: string; readonly displayName: string }
export interface AdminSurfaceStagedAccount { readonly expiresAt: string; readonly account: AdminSurfaceConnectionAccount }
export interface AdminSurfaceStatusView { readonly status: AdminSurfaceConnectionState; readonly account: AdminSurfaceConnectionAccount | null; readonly grantedScopes: readonly string[]; readonly pendingSwitch: AdminSurfaceConnectionAccount | null }
export interface AdminSurfaceConnectionRecord extends Omit<AdminSurfaceStatusView, 'pendingSwitch'> { readonly staged: AdminSurfaceStagedAccount | null }
export interface AdminSurfaceAccountAction { readonly connectionRef: string; readonly workspaceId: string; readonly actorId: string }
export interface AdminSurfaceDisconnected extends AdminSurfaceStatusView { readonly remoteRevocation: AdminSurfaceRevocationOutcome }
export interface AdminSurfaceSignInStart<Connection extends AdminSurfaceDeclaredConnection> { readonly connection: Connection; readonly actorId: string; readonly intent: 'connect' | 'switch-account'; readonly scopeSetIds: readonly string[]; readonly destination?: 'site' | 'shared' | undefined }
export interface AdminSurfaceSignInStarted extends AdminSurfaceAuthorizationStart { readonly completion?: Promise<{ readonly callbackFields: Readonly<Record<string, string>> } | null> }
export interface AdminSurfaceCallbackInbox { deposit(required: AdminSurfaceCallbackFieldKey & { readonly fields: Readonly<Record<string, string>> }): void; take(required: AdminSurfaceCallbackFieldKey): Readonly<Record<string, string>> | null }

/** @agent-note Fulfill from the one API connection host your tools and callback route already share. A second
 * host loses callbacks. `pinnedTokenOptions` must read the same frozen accounts as the tool registrar. */
export interface AdminSurfaceConnectionsHost<Connection extends AdminSurfaceDeclaredConnection = AdminSurfaceDeclaredConnection> {
  readonly workspaceId: string;
  nowMs(): number;
  connectionKey(required: { workspaceId: string; pluginId: string; connectionId: string }): string;
  listConnections(required: { pluginId: string }): Promise<readonly Connection[]>;
  requestedScopes(required: { connection: Connection; scopeSetIds: readonly string[] }): Promise<readonly string[]>;
  readRecord(required: { key: string }): Promise<AdminSurfaceConnectionRecord | null>;
  getAccessToken(required: { workspaceId: string; pluginId: string; connectionRef: string }, optional?: { expectedAccountId?: string }): Promise<string>;
  startSignIn(required: AdminSurfaceSignInStart<Connection>, optional?: { startParams?: Readonly<Record<string, string>> }): Promise<AdminSurfaceSignInStarted>;
  service(required: { connection: Connection }): {
    confirmSwitchAccount(required: AdminSurfaceAccountAction): Promise<AdminSurfaceStatusView>;
    cancelSwitchAccount(required: Omit<AdminSurfaceAccountAction, 'actorId'>): Promise<AdminSurfaceStatusView>;
    disconnect(required: Omit<AdminSurfaceAccountAction, 'actorId'>): Promise<AdminSurfaceDisconnected>;
  };
  readonly attempts: { get(ref: string): AdminSurfaceSignInAttempt | undefined; set(ref: string, attempt: AdminSurfaceSignInAttempt): void; delete(ref: string): void };
  readonly callbackInbox: AdminSurfaceCallbackInbox;
  readonly sharedOAuth?: { hasBinding(connection: Connection): Promise<boolean>; getStatus(connection: Connection): Promise<Omit<AdminSurfaceStatusView, 'pendingSwitch'> | null>; stopUsing(connection: Connection): Promise<void> };
  notAvailable(): Error;
  pinnedTokenOptions?(required: { signal?: AbortSignal | undefined; connectionRef: string }): { expectedAccountId?: string };
}
