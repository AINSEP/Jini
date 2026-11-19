import type { SearchQuery } from "./contract.js";

/** The collection grammar of `@jini-ai/search` document keys. */
const COLLECTION = /^[a-z][a-z0-9_]{0,63}$/;
const LIMIT = /^\d{1,3}$/;

export type SearchQueryIssue =
  | { readonly code: "not-single"; readonly field: "q" | "collection" | "limit" | "cursor" }
  | { readonly code: "text-required" }
  | { readonly code: "text-too-long" }
  | { readonly code: "invalid-collections" }
  | { readonly code: "invalid-limit" }
  | { readonly code: "invalid-cursor" };

/** One query-string value as a string; a repeated parameter (an array) is malformed. */
function single({ value, name }: { value: unknown; name: "q" | "collection" | "limit" | "cursor" }, _optional = {}): string | undefined | { error: SearchQueryIssue } {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return { error: { code: "not-single", field: name } };
  return value;
}

function readText({ raw, maxTextLength }: { raw: unknown; maxTextLength: number }, _optional = {}): string | { error: SearchQueryIssue } {
  const value = single({ value: raw, name: "q" });
  if (typeof value === "object") return value;
  const text = (value ?? "").trim();
  if (text.length === 0) return { error: { code: "text-required" } };
  if (text.length > maxTextLength) return { error: { code: "text-too-long" } };
  return text;
}

/** `collection=post` or `collection=post,page`. */
function readCollections({ raw, maxCollections }: { raw: unknown; maxCollections: number }, _optional = {}): readonly string[] | undefined | { error: SearchQueryIssue } {
  const value = single({ value: raw, name: "collection" });
  if (typeof value !== "string") return value;
  const collections = value.split(",").map(part => part.trim());
  if (collections.length > maxCollections || !collections.every(part => COLLECTION.test(part))) {
    return { error: { code: "invalid-collections" } };
  }
  return collections;
}

function readLimit({ raw, maxLimit }: { raw: unknown; maxLimit: number }, _optional = {}): number | undefined | { error: SearchQueryIssue } {
  const value = single({ value: raw, name: "limit" });
  if (typeof value !== "string") return value;
  const limit = LIMIT.test(value) ? Number(value) : 0;
  if (limit < 1 || limit > maxLimit) return { error: { code: "invalid-limit" } };
  return limit;
}

function readCursor({ raw, maxCursorLength }: { raw: unknown; maxCursorLength: number }, _optional = {}): string | undefined | { error: SearchQueryIssue } {
  const value = single({ value: raw, name: "cursor" });
  if (typeof value !== "string") return value;
  if (value.length === 0 || value.length > maxCursorLength) return { error: { code: "invalid-cursor" } };
  return value;
}

const isError = (value: unknown): value is { error: SearchQueryIssue } => typeof value === "object" && value !== null && "error" in value;

/**
 * The request's query string as a service query, or the first reason it is malformed. Never reads
 * audiences or any other field from the request.
 * @complexity O(q + collections).
 */
export function parseSearchRequest(required: { readonly query: Readonly<Record<string, unknown>>; readonly limits: { maxTextLength: number; maxCollections: number; maxLimit: number; maxCursorLength: number } }, _optional: Record<string, never> = {}): { query: Omit<SearchQuery, "audiences"> } | { error: SearchQueryIssue } {
  const { query, limits } = required;
  const text = readText({ raw: query.q, maxTextLength: limits.maxTextLength });
  const collections = readCollections({ raw: query.collection, maxCollections: limits.maxCollections });
  const limit = readLimit({ raw: query.limit, maxLimit: limits.maxLimit });
  const cursor = readCursor({ raw: query.cursor, maxCursorLength: limits.maxCursorLength });
  const failed = [text, collections, limit, cursor].find(isError);
  if (failed) return { error: failed.error };
  return {
    query: {
      text: text as string,
      ...(collections === undefined ? {} : { collections: collections as readonly string[] }),
      ...(limit === undefined ? {} : { limit: limit as number }),
      ...(cursor === undefined ? {} : { cursor: cursor as string }),
    },
  };
}

