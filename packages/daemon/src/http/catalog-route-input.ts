import {
  err,
  ok,
  validationError,
  type Result,
  type RouteInputContext,
} from '@jini-ai/core/contracts/server';

const MAX_SEARCH_LIMIT = 25;
const DEFAULT_SEARCH_LIMIT = 10;

export function parseCatalogSearchInput({ input }: { input: RouteInputContext }, _optional: Record<string, never> = {}): Result<{ query: string; limit: number }> {
  const rawQuery = input.query.q;
  if (typeof rawQuery !== 'string' || rawQuery.trim().length === 0) {
    return err({ error: validationError({ message: 'q (search query) is required and must be a non-empty string' }) });
  }
  const rawLimit = input.query.limit;
  if (rawLimit === undefined) return ok({ value: { query: rawQuery, limit: DEFAULT_SEARCH_LIMIT } });
  if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit)) {
    return err({ error: validationError({ message: 'limit must be a single positive-integer query-string value when provided' }) });
  }
  const parsed = Number(rawLimit);
  if (parsed < 1) return err({ error: validationError({ message: 'limit must be at least 1' }) });
  return ok({ value: { query: rawQuery, limit: Math.min(parsed, MAX_SEARCH_LIMIT) } });
}

export function parseCatalogDescribeInput({ input }: { input: RouteInputContext }, _optional: Record<string, never> = {}): Result<{ id: string }> {
  const id = input.params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return err({ error: validationError({ message: 'id path segment is required' }) });
  }
  return ok({ value: { id } });
}
