import type { JsonPrimitive, JsonValue } from '@jini-ai/core/primitives';

export interface BoundedJsonConstraints {
  /** Maximum nesting depth for objects and arrays, counting the root container as depth 1. */
  maxDepth: number;
  /** Maximum number of own enumerable keys allowed on any single object. */
  maxObjectKeys: number;
  /** Maximum number of items allowed in any single array. */
  maxArrayLength: number;
  /** Maximum UTF-16 code units allowed in any single string value. */
  maxStringLength: number;
  /** Maximum UTF-8 bytes for the serialized JSON payload. */
  maxSerializedBytes: number;
}

export interface OkResponse {
  ok: true;
}

export interface IdResponse {
  id: string;
}

export type EntityResponse<Key extends string, Value> = Record<Key, Value>;

export type EntityListResponse<Key extends string, Value> = Record<Key, Value[]>;

export type Nullable<T> = T | null;
