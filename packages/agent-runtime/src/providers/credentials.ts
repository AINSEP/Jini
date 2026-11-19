/**
 * @file Resolve the provider credential for one bring-your-own-key turn. A credential supplied on the
 * request wins when it is complete (someone trying a key they have not saved yet: no store read);
 * otherwise the host's stored credential for that `(workspaceId, principalId)` is used. Absence is a
 * value (`null`), never a throw, so a caller treats a missing or invalid credential as an ordinary
 * client error branch.
 */
import type { ProviderProtocol } from './provider-tool-policy.js';

export interface ResolvedProviderCredential {
  readonly protocol: ProviderProtocol;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model: string;
  readonly maxTokens?: number;
}

/** What a client sends on one request. Every field may be omitted or empty: that is exactly the signal
 *  `createStoredExecutionCredentialPort` reads as "fall back to the stored credential". */
export interface RequestSuppliedProviderConfig {
  readonly protocol?: unknown;
  readonly apiKey?: unknown;
  readonly baseUrl?: unknown;
  readonly model?: unknown;
  readonly maxTokens?: unknown;
}

/** A host's stored credential row, already decrypted. `protocol` is unvalidated text. */
export interface StoredProviderCredential {
  readonly protocol: string;
  readonly apiKey: string;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly maxTokens: number | null;
}

export interface ExecutionCredentialPort {
  /** `null` for "no usable credential". Identity-scoped and async because a stored backing reads a
   *  `(workspace, principal)` row and decrypts it; the request-only port ignores the identity fields. */
  resolve(input: { requestBody: RequestSuppliedProviderConfig; workspaceId: string; principalId: string }): Promise<ResolvedProviderCredential | null>;
}

const VALID_PROTOCOLS: ReadonlySet<string> = new Set(['anthropic', 'openai', 'azure', 'google']);

/** `requestBody.protocol`'s own field parse, split out of `parseRequestSuppliedCredential` to keep its
 *  complexity under the ceiling; behaviour is unchanged. */
function parseProtocol({ value }: { value: unknown }, _options = {}): ProviderProtocol | null {
  return typeof value === 'string' && VALID_PROTOCOLS.has(value) ? (value as ProviderProtocol) : null;
}

/** A required, non-blank string field (`apiKey`/`model`). */
function parseRequiredString({ value }: { value: unknown }, _options = {}): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** An optional, non-blank string field (`baseUrl`). */
function parseOptionalString({ value }: { value: unknown }, _options = {}): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** `requestBody.maxTokens`'s own field parse: a positive number or nothing. */
function parseMaxTokens({ value }: { value: unknown }, _options = {}): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

/** Pure parse of a client-supplied config: no I/O, `null` when any required field is missing or invalid. */
function parseRequestSuppliedCredential(requestBody: RequestSuppliedProviderConfig): ResolvedProviderCredential | null {
  const protocol = parseProtocol({ value: requestBody.protocol });
  if (!protocol) return null;
  const apiKey = parseRequiredString({ value: requestBody.apiKey });
  if (!apiKey) return null;
  const model = parseRequiredString({ value: requestBody.model });
  if (!model) return null;
  const baseUrl = parseOptionalString({ value: requestBody.baseUrl });
  const maxTokens = parseMaxTokens({ value: requestBody.maxTokens });
  return {
    protocol,
    apiKey,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  };
}

/**
 * Trusts ONLY the credential sent on this one request: never reads a store, never writes anything.
 * @complexity O(1).
 */
export function createRequestSuppliedExecutionCredentialPort(_options = {}): ExecutionCredentialPort {
  return {
    async resolve({ requestBody }) {
      return parseRequestSuppliedCredential(requestBody);
    },
  };
}

/**
 * Request-supplied credential first; otherwise the host's stored row. A stored row whose protocol this
 * package cannot dispatch, or with no model set (turns always need a model), is unusable.
 * `readStored` must not throw for an undecryptable row: it returns `null`.
 * @complexity O(1): at most one `readStored` call, only when the request supplied nothing usable.
 */
export function createStoredExecutionCredentialPort(
  { readStored }: { readStored: (required: { workspaceId: string; principalId: string }) => Promise<StoredProviderCredential | null> },
  _options = {},
): ExecutionCredentialPort {
  return {
    async resolve({ requestBody, workspaceId, principalId }) {
      const requestSupplied = parseRequestSuppliedCredential(requestBody);
      if (requestSupplied) return requestSupplied;

      const stored = await readStored({ workspaceId, principalId });
      if (!stored) return null;
      if (!VALID_PROTOCOLS.has(stored.protocol)) return null;
      if (!stored.model || stored.model.trim().length === 0) return null;
      return {
        protocol: stored.protocol as ProviderProtocol,
        apiKey: stored.apiKey,
        model: stored.model,
        ...(stored.baseUrl ? { baseUrl: stored.baseUrl } : {}),
        ...(stored.maxTokens !== null ? { maxTokens: stored.maxTokens } : {}),
      };
    },
  };
}
