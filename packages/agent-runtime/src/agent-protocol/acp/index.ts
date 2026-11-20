/** @module agent-protocol/acp
 * Public barrel for the ACP (Agent Client Protocol) JSON-RPC subprocess
 * transport. Re-exports the surface consumed by runtime adapter definitions
 * (detectAcpModels, normalizeModels, ModelOption), a host's connection-test
 * and chat-server entry points (attachAcpSession, buildAcpSessionNewParams,
 * AcpMcpServerInput), and the account-failure injection seam
 * (AccountFailure, AccountFailureClassifier, noopAccountFailureClassifier) a
 * host application uses to plug in its own provider-specific classifier.
 */
export { type AcpMcpServerInput, buildAcpSessionNewParams } from './session-params.js';
export { type ModelOption, normalizeModels, detectAcpModels } from './models.js';
export { attachAcpSession } from './session.js';
export { type AcpPermissionDecision, type AcpPermissionHandler, type AcpPermissionOption, type AcpPermissionRequest, type AcpSessionController, type AttachAcpSessionOptions } from './session-types.js';
export {
  type AccountFailure,
  type AccountFailureClassifier,
  noopAccountFailureClassifier,
} from './account-failure.js';
