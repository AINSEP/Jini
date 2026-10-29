import type { CredentialCryptoPort } from './run-credentials.js';
import { omitKeys } from './core/omit-keys.js';

interface ResultIdentity {
  readonly runId: string;
  readonly toolUseId: string;
  readonly content: readonly unknown[];
  readonly isError: boolean;
}

/** Run-scoped proof of a saved bridge result. Implementations retain digests, never pixels. */
export interface DelegatedResultCorrelation {
  record(input: ResultIdentity, options?: Record<string, never>): void;
  matches(input: ResultIdentity, options?: Record<string, never>): boolean;
  clearRun(input: { runId: string }, options?: Record<string, never>): void;
}

/** Accept only the complete base64 source shape; extra fields must remain part of the digest. */
function base64ImageSource({ source }: { source: unknown }, _options = {}): { data: string; media_type: string } | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const image = source as Record<string, unknown>;
  if (image.type !== 'base64' || typeof image.media_type !== 'string' || typeof image.data !== 'string' || Object.keys(image).length !== 3) return undefined;
  return { data: image.data, media_type: image.media_type };
}

/** Convert only source-only images; dual representations and extra source fields stay in the proof. */
function normalizeSourceImage({ record }: { record: Record<string, unknown> }, _options = {}): Record<string, unknown> {
  if (record.type !== 'image' || 'data' in record || 'mimeType' in record) return record;
  const image = base64ImageSource({ source: record.source });
  if (!image) return record;
  return { ...omitKeys(record, ['source']), data: image.data, mimeType: image.media_type };
}

/** Normalize unambiguous CLI images and JSON object key order.
 * @complexity O(n + k log k) for n bytes and k keys per object; inputs are wire JSON. */
function normalizedJson(_key: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const record = normalizeSourceImage({ record: value as Record<string, unknown> });
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
}

/** Bounded digest store. Eviction only disables summarization, so legacy output remains safe.
 * Share this instance with bridge/executor/lifecycle; lifecycle eviction clears each run.
 * @complexity O(n) hashing plus JSON key sorting; O(r*c) retained fixed-size digests. */
export function createDelegatedResultCorrelation({ crypto }: { crypto: Pick<CredentialCryptoPort, 'digest'> }, { maxRuns = 256, maxCallsPerRun = 2048 }: { maxRuns?: number; maxCallsPerRun?: number } = {}): DelegatedResultCorrelation {
  if (!Number.isSafeInteger(maxRuns) || maxRuns < 1 || !Number.isSafeInteger(maxCallsPerRun) || maxCallsPerRun < 1) throw new Error('correlation limits must be positive integers');
  const runs = new Map<string, Map<string, string>>();
  // Optional correlation must not turn an otherwise serializable legacy fallback into a failure
  // (for example, a cyclic in-process tool result handled by serializeDelegatedToolOutput).
  const digest = (input: ResultIdentity): string | undefined => {
    try { return crypto.digest({ token: JSON.stringify({ isError: input.isError, content: input.content }, normalizedJson) }); }
    catch { return undefined; }
  };
  return {
    record(input) {
      const fingerprint = digest(input);
      if (fingerprint === undefined) return;
      let calls = runs.get(input.runId);
      if (!calls) {
        if (runs.size >= maxRuns) runs.delete(runs.keys().next().value!);
        calls = new Map();
        runs.set(input.runId, calls);
      }
      if (calls.size >= maxCallsPerRun) calls.delete(calls.keys().next().value!);
      calls.set(input.toolUseId, fingerprint);
    },
    matches(input) {
      const expected = runs.get(input.runId)?.get(input.toolUseId);
      return expected !== undefined && expected === digest(input);
    },
    clearRun({ runId }) { runs.delete(runId); },
  };
}
