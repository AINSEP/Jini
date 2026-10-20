/**
 * @file Typed fake admin-surface host ports for the surface tests: the shared fakes (HTTP that never
 * touches the network, an always-allow limiter, artifacts) plus an acme-style connections port over
 * the real callback inbox, in-memory state, a public-config table and a delivery-bindings store.
 * Every call is logged with the scope the port was built for, so tests can assert plugin isolation.
 * The bindings store is deliberately sloppy (it lists every binding in the workspace, whatever
 * adapter owns it, and echoes a connection ref), so tests prove Jini's own filtering and shaping.
 */
import type { AgentPluginToolCapabilityScope } from '../../lifecycle/tools/capabilities.js';
import { fakeCapabilities, FAKE_TOKEN, type FakeCapabilityLog } from '../../lifecycle/tools/__tests__/support.js';
import { createAdminSurfaceCallbackInbox } from '../callback-field-inbox.js';
import type { AdminSurfaceDeliveryBinding, AdminSurfaceDeliveryBindings } from '../delivery-bindings.js';
import type { AdminSurfaceAuthorizationStart, AdminSurfaceCapabilities, AdminSurfaceConnectionStatus, AdminSurfaceStateValue } from '../surface-capabilities.js';

/** A host answer carrying more than the port promises (a connection ref): the session must cut it back. */
type OverSharing = { readonly connectionRef?: string };

export interface FakeSurfaceHostLog extends FakeCapabilityLog {
  /** `<pluginId>:<method>:<arguments as JSON>` for every connections/state/config call. */
  calls: string[];
}

/** An in-memory bindings store for one fake host: ids `binding-<n>`, every binding in the workspace listed. */
function fakeDeliveryBindings(bindings: Map<string, AdminSurfaceDeliveryBinding & OverSharing>, note: (method: string, args: unknown) => void): AdminSurfaceDeliveryBindings {
  return {
    list: async () => { note('bindings.list', {}); return [...bindings.values()].map((binding) => ({ ...binding, connectionRef: 'ref-must-not-leak' })); },
    save: async (draft) => {
      note('bindings.save', draft);
      const saved = { ...draft, bindingId: draft.bindingId ?? `binding-${bindings.size + 1}`, connectionRef: 'ref-must-not-leak' };
      bindings.set(saved.bindingId, saved);
      return saved;
    },
    remove: async ({ bindingId }) => { note('bindings.remove', { bindingId }); bindings.delete(bindingId); },
  };
}

/** One fake host shared by every plugin: state and the inbox are keyed by the port's scope, like a real host.
 * `bindings` seeds the workspace's delivery bindings; `deliveryBindings: false` models a host without the port. */
export function createFakeSurfaceHost(optional: {
  readonly config?: Readonly<Record<string, string>>; readonly status?: Partial<AdminSurfaceConnectionStatus> & OverSharing;
  readonly bindings?: readonly AdminSurfaceDeliveryBinding[]; readonly deliveryBindings?: false;
} = {}) {
  const log: FakeSurfaceHostLog = { tokenRequests: [], requests: [], calls: [] };
  const state = new Map<string, AdminSurfaceStateValue>();
  const bindings = new Map((optional.bindings ?? []).map((binding) => [binding.bindingId, binding]));
  const inbox = createAdminSurfaceCallbackInbox({ now: () => 0 });
  const port = (scope: AgentPluginToolCapabilityScope): AdminSurfaceCapabilities => {
    const note = (method: string, args: unknown) => { log.calls.push(`${scope.pluginId}:${method}:${JSON.stringify(args)}`); };
    const status = (connectionId: string): AdminSurfaceConnectionStatus & OverSharing => ({
      connectionId, status: 'connected', accountLabel: 'person@example.test', grantedScopeSetIds: ['files'], pendingSwitchAccountLabel: null, lastSignInAttempt: null, ...optional.status,
    });
    const stateKey = (key: string) => `${scope.workspaceId}\u0000${scope.pluginId}\u0000${key}`;
    const { connections: _toolConnections, state: _toolState, ...shared } = fakeCapabilities(log);
    return {
      ...shared,
      connections: {
        getAccessToken: async ({ connectionId }) => { log.tokenRequests.push(connectionId); return FAKE_TOKEN; },
        status: async ({ connectionId }) => { note('status', { connectionId }); return status(connectionId); },
        begin: async (required, options) => {
          note('begin', { ...required, ...options });
          const started: AdminSurfaceAuthorizationStart & OverSharing = { authorizationUrl: 'https://auth.example.test/authorize?state=s1', attemptId: 'attempt-1', expiresAt: '2026-10-20T00:10:00.000Z', connectionRef: 'ref-must-not-leak' };
          return started;
        },
        confirmSwitch: async ({ connectionId }) => { note('confirmSwitch', { connectionId }); return status(connectionId); },
        cancelSwitch: async ({ connectionId }) => { note('cancelSwitch', { connectionId }); return status(connectionId); },
        disconnect: async ({ connectionId }) => { note('disconnect', { connectionId }); return { ...status(connectionId), status: 'revocation-pending' as const, revocation: 'pending' as const }; },
        takeCallbackFields: async ({ connectionId, attemptId }) => inbox.take({ workspaceId: scope.workspaceId, pluginId: scope.pluginId, connectionId, attemptId }),
      },
      state: {
        get: async ({ key }) => state.get(stateKey(key)) ?? null,
        set: async ({ key, value }) => { note('state.set', { key }); state.set(stateKey(key), value); },
        delete: async ({ key }) => { state.delete(stateKey(key)); },
      },
      publicConfig: { get: async ({ name }) => { note('publicConfig.get', { name }); return optional.config?.[name] ?? null; } },
      ...(optional.deliveryBindings !== false && { deliveryBindings: fakeDeliveryBindings(bindings, note) }),
    };
  };
  return { log, port, state, inbox, bindings };
}
