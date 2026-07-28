/** @module agent-protocol/pi-rpc
 * Barrel for the pi-rpc submodule. Re-exports the three public symbols:
 * `mapPiRpcEvent` (pure RPC-to-daemon event mapper), `attachPiRpcSession`
 * (session lifecycle), and `parsePiModels` (model list parser), plus the
 * `PiRpcSession`/`PiRpcSessionOptions` types a real driver (e.g.
 * `@injini/daemon`'s `AgentExecutor`) needs to type its own wiring against.
 */
export { mapPiRpcEvent } from './events.js';
export { attachPiRpcSession, type PiRpcSession, type PiRpcSessionOptions } from './session.js';
export { parsePiModels } from './models.js';
