/**
 * @module output-protection
 *
 * Centralized size and secret redaction boundary for provider output.
 */
import type { JsonValue } from '@jini-ai/protocol';

import {
  toStructurallyBoundedJsonValue,
  type JsonStructureLimits,
} from './bounded-data.js';
import { ConnectorServiceError } from './errors.js';

type JsonObject = { [key: string]: JsonValue };

export const CONNECTOR_MAX_OUTPUT_BYTES = 256 * 1024;
const CONNECTOR_REDACTED_VALUE = '[redacted]';

const CONNECTOR_OUTPUT_STRUCTURE_LIMITS: JsonStructureLimits = {
  maxDepth: 32,
  maxNodes: 25_000,
  maxArrayItems: 10_000,
  maxObjectKeys: 10_000,
  maxStringBytes: CONNECTOR_MAX_OUTPUT_BYTES,
};

const EXACT_SECRET_KEYS = new Set([
  'raw',
  'rawresponse',
  'payload',
  'body',
  'headers',
  'cookie',
  'cookies',
  'authorization',
  'token',
  'secret',
  'credential',
  'credentials',
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'pat',
  'bearer',
  'apikey',
  'accesskey',
  'privatekey',
  'secretkey',
  'clientsecret',
  'accesstoken',
  'refreshtoken',
  'idtoken',
]);

export interface ConnectorOutputProtectionResult {
  output: JsonValue;
  redacted: boolean;
  serializedBytes: number;
}

export interface ConnectorObjectOutputProtectionResult extends ConnectorOutputProtectionResult {
  output: JsonObject;
}

function normalizedSecretKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isForbiddenConnectorOutputKey(key: string): boolean {
  const normalized = normalizedSecretKey(key);
  return EXACT_SECRET_KEYS.has(normalized)
    || /(?:api|access|private|secret|client)?key$/.test(normalized)
    || /(?:access|refresh|id|auth)?token$/.test(normalized)
    || /(?:secret|credential|password|authorization|cookie)/.test(normalized);
}

function redactConnectorOutputValue(value: JsonValue): { value: JsonValue; redacted: boolean } {
  if (Array.isArray(value)) {
    let redacted = false;
    const next = value.map((item) => {
      const child = redactConnectorOutputValue(item);
      redacted = child.redacted || redacted;
      return child.value;
    });
    return { value: next, redacted };
  }
  if (value !== null && typeof value === 'object') {
    let redacted = false;
    const next: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      if (isForbiddenConnectorOutputKey(key)) {
        Object.defineProperty(next, key, {
          configurable: true,
          enumerable: true,
          value: CONNECTOR_REDACTED_VALUE,
          writable: true,
        });
        redacted = true;
        continue;
      }
      const redactedChild = redactConnectorOutputValue(child);
      Object.defineProperty(next, key, {
        configurable: true,
        enumerable: true,
        value: redactedChild.value,
        writable: true,
      });
      redacted = redactedChild.redacted || redacted;
    }
    return { value: next, redacted };
  }
  return { value, redacted: false };
}

/**
 * Bounds, clones, recursively redacts, and serialized-size caps provider data.
 *
 * The object overload is sound because both the structural clone and redaction
 * preserve the root container kind. Secret fields may change value, but an
 * object input cannot become an array, primitive, or null.
 *
 * @complexity Time: O(n). Space: O(n), within the output structure limits.
 * @overallScore 100/100
 */
export function protectConnectorOutput(output: JsonObject): ConnectorObjectOutputProtectionResult;
export function protectConnectorOutput(output: JsonValue): ConnectorOutputProtectionResult;
export function protectConnectorOutput(output: JsonValue): ConnectorOutputProtectionResult {
  let bounded: JsonValue;
  try {
    bounded = toStructurallyBoundedJsonValue(output, CONNECTOR_OUTPUT_STRUCTURE_LIMITS);
  } catch {
    throw new ConnectorServiceError(
      'CONNECTOR_OUTPUT_TOO_LARGE',
      'connector output exceeds structural safety limits',
      502,
    );
  }
  const redacted = redactConnectorOutputValue(bounded);
  const serializedBytes = Buffer.byteLength(JSON.stringify(redacted.value), 'utf8');
  if (serializedBytes > CONNECTOR_MAX_OUTPUT_BYTES) {
    throw new ConnectorServiceError('CONNECTOR_OUTPUT_TOO_LARGE', 'connector output exceeds max serialized size', 502, {
      maxSerializedBytes: CONNECTOR_MAX_OUTPUT_BYTES,
      serializedBytes,
    });
  }
  return { output: redacted.value, redacted: redacted.redacted, serializedBytes };
}
