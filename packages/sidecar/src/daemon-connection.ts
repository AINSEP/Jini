/**
 * @file Instance-owned record of the agent-daemon endpoint a host currently delegates to, and the
 * one it replaced. An endpoint and its credential are captured together (a record), so a probe of
 * an old run can keep using the previous endpoint with the credential that belongs to it instead
 * of mixing it with the replacement's. Memory only, never persisted. The host owns the inherited-IPC
 * grammar, registration and readiness, and any fallback credential lookup.
 */

/** The least a connection record must carry: where the daemon is and the credential for that place. */
export interface DaemonConnectionRecord {
  readonly url: string;
  readonly token: string;
}

export interface DaemonConnectionRegistry<Connection extends DaemonConnectionRecord> {
  /** Capture the endpoint and its credential together; old-run probes must retain both. Setting the
   * same url and token again keeps the previous record untouched; `undefined` clears the current one.
   * @complexity O(1), memory only. The caller owns readiness and inherited-channel authentication. */
  set(required: { connection: Connection | undefined }, optional?: {}): void;
  /** The endpoint currently delegated to. The returned record is frozen: a late callback may hold it
   * across a replacement and still send the credential it was issued. */
  current(required?: {}, optional?: {}): Connection | undefined;
  /** The endpoint the current one replaced, for recovery of runs launched against it. */
  previous(required?: {}, optional?: {}): Connection | undefined;
  /** Forget both records, so a test or a new process lifecycle retains no earlier capability. */
  reset(required?: {}, optional?: {}): void;
}

/** One registry per host composition: no module state, so two instances never share a capability.
 * @complexity O(1) to build. */
export function createDaemonConnectionRegistry<Connection extends DaemonConnectionRecord>(
  _required: {} = {}, _optional = {},
): DaemonConnectionRegistry<Connection> {
  let current: Connection | undefined;
  let previous: Connection | undefined;
  return {
    set: ({ connection }, _options = {}) => {
      if (current && (connection?.url !== current.url || connection.token !== current.token)) previous = current;
      current = connection ? Object.freeze({ ...connection }) : undefined;
    },
    current: (_required = {}, _options = {}) => current,
    previous: (_required = {}, _options = {}) => previous,
    reset: (_required = {}, _options = {}) => { current = undefined; previous = undefined; },
  };
}
