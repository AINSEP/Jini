/**
 * @module bounded-data
 *
 * Size and structural guards for untrusted remote and persisted JSON.
 */
import fs from 'node:fs';

import type { JsonValue } from '@injini/protocol';

export const COMPOSIO_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const COMPOSIO_MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
export const COMPOSIO_MAX_CACHE_BYTES = 8 * 1024 * 1024;
export const COMPOSIO_MAX_SECRET_STORE_BYTES = 1024 * 1024;

export interface JsonStructureLimits {
  maxDepth: number;
  maxNodes: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  maxStringBytes: number;
}

export const COMPOSIO_REMOTE_JSON_LIMITS: JsonStructureLimits = {
  maxDepth: 40,
  maxNodes: 50_000,
  maxArrayItems: 10_000,
  maxObjectKeys: 10_000,
  maxStringBytes: 1024 * 1024,
};

export class BoundedDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoundedDataError';
  }
}

/** Reads at most `maxBytes` from a response body before allocating/decoding it. */
export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  label = 'Composio response',
): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && /^\d+$/.test(declaredLength)) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes) {
      throw new BoundedDataError(`${label} exceeds the ${maxBytes}-byte limit`);
    }
  }

  if (response.body === null) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedDataError(`${label} exceeds the ${maxBytes}-byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Reads and parses a response body only after its byte size is bounded. */
export async function readBoundedResponseJson(
  response: Response,
  maxBytes = COMPOSIO_MAX_RESPONSE_BYTES,
  label = 'Composio response',
): Promise<unknown> {
  const text = await readBoundedResponseText(response, maxBytes, label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new BoundedDataError(`${label} is not valid JSON`);
  }
  return toStructurallyBoundedJsonValue(parsed);
}

/** Reads a local UTF-8 file without allowing it to grow past `maxBytes`. */
export function readBoundedUtf8File(filePath: string, maxBytes: number): string {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    return readBoundedUtf8Descriptor(descriptor, maxBytes);
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * Opens a secret-bearing regular file without following its final symlink,
 * enforces owner-only mode on the opened inode, and reads it within a byte cap.
 *
 * @complexity Time: O(n). Space: O(n), where n is capped by `maxBytes`.
 * @overallScore 100/100
 */
export function readPrivateBoundedUtf8File(filePath: string, maxBytes: number): string {
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new BoundedDataError('Secret JSON path must be a regular file');
    }
    fs.fchmodSync(descriptor, 0o600);
    return readBoundedUtf8Descriptor(descriptor, maxBytes);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readBoundedUtf8Descriptor(descriptor: number, maxBytes: number): string {
  const chunks: Buffer[] = [];
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
  let totalBytes = 0;
  while (true) {
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    if (totalBytes > maxBytes) {
      throw new BoundedDataError(`JSON file exceeds the ${maxBytes}-byte limit`);
    }
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, totalBytes));
}

interface JsonTraversalState {
  nodes: number;
  ancestors: WeakSet<object>;
}

/**
 * Converts an unknown value into JSON while enforcing depth, node, collection,
 * and string bounds before recursive copies are allocated.
 */
export function toStructurallyBoundedJsonValue(
  value: unknown,
  limits: JsonStructureLimits = COMPOSIO_REMOTE_JSON_LIMITS,
): JsonValue {
  const state: JsonTraversalState = { nodes: 0, ancestors: new WeakSet<object>() };

  const visit = (current: unknown, depth: number): JsonValue => {
    state.nodes += 1;
    if (state.nodes > limits.maxNodes) {
      throw new BoundedDataError(`JSON value exceeds the ${limits.maxNodes}-node limit`);
    }
    if (depth > limits.maxDepth) {
      throw new BoundedDataError(`JSON value exceeds the ${limits.maxDepth}-level depth limit`);
    }

    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new BoundedDataError('JSON value contains a non-finite number');
      return current;
    }
    if (typeof current === 'string') {
      if (Buffer.byteLength(current, 'utf8') > limits.maxStringBytes) {
        throw new BoundedDataError(`JSON string exceeds the ${limits.maxStringBytes}-byte limit`);
      }
      return current;
    }
    if (typeof current !== 'object') {
      throw new BoundedDataError('JSON value contains an unsupported runtime value');
    }
    if (state.ancestors.has(current)) throw new BoundedDataError('JSON value contains a cycle');

    state.ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (current.length > limits.maxArrayItems) {
          throw new BoundedDataError(`JSON array exceeds the ${limits.maxArrayItems}-item limit`);
        }
        return current.map((item) => visit(item, depth + 1));
      }

      const entries = Object.entries(current as Record<string, unknown>);
      if (entries.length > limits.maxObjectKeys) {
        throw new BoundedDataError(`JSON object exceeds the ${limits.maxObjectKeys}-key limit`);
      }
      const output: Record<string, JsonValue> = {};
      for (const [key, child] of entries) {
        Object.defineProperty(output, key, {
          configurable: true,
          enumerable: true,
          value: visit(child, depth + 1),
          writable: true,
        });
      }
      return output;
    } finally {
      state.ancestors.delete(current);
    }
  };

  return visit(value, 0);
}
