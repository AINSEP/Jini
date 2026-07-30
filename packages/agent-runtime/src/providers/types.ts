/**
 * @module providers/types
 *
 * Vendored subset of OD's upstream contracts-package provider-connectivity
 * shapes needed by this package's own provider modules. `@jini-ai/agent-runtime`
 * has zero OD workspace-package imports (same policy as `types.ts`'s vendored
 * `AgentDiagnostic`/`AgentFixIntent`) — only the fields this package's own
 * code actually reads/writes are kept; the daemon-only surface (agent
 * connection-test request/response shapes, reasoning-execution fields) is
 * not ported.
 */

/** Category of outcome a provider model/connection probe can report. */
export type ConnectionTestKind =
  | 'success'
  | 'auth_failed'
  | 'forbidden'
  | 'not_found_model'
  | 'invalid_model_id'
  | 'invalid_base_url'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'timeout'
  | 'unknown';

/** Wire protocol family a BYOK provider speaks. */
export type ConnectionTestProtocol =
  | 'anthropic'
  | 'openai'
  | 'azure'
  | 'google'
  | 'ollama'
  | 'senseaudio'
  | 'aihubmix'
  | 'bedrock';

export interface ProviderModelOption {
  id: string;
  label: string;
}

export interface ProviderModelsRequest {
  protocol: ConnectionTestProtocol;
  baseUrl: string;
  apiKey: string;
  /** Azure only. Kept for shape parity with a provider-test request. */
  apiVersion?: string;
}

export type ProviderModelsKind = ConnectionTestKind | 'no_models' | 'unsupported_protocol';

export interface ProviderModelsResponse {
  ok: boolean;
  kind: ProviderModelsKind;
  latencyMs: number;
  models?: ProviderModelOption[];
  status?: number;
  detail?: string;
}
