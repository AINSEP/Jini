/**
 * @file Query-string parsing shaped like the Express 4 `req.query`, on a web `Request`.
 */

/** Stands in for what `qs` turned a bracketed key into (`a[b]=1` → an object): not a string, so a route's "must be a string" check still refuses it. */
const BRACKETED_QUERY_VALUE: Readonly<Record<string, never>> = Object.freeze({});

/** qs's default `arrayLimit`: `a[20]=x` is still a list index, `a[21]=x` makes `a` an object. */
const MAX_QUERY_LIST_INDEX = 20;

type QueryValue = string | string[] | typeof BRACKETED_QUERY_VALUE;

/** The list index a bracket suffix names (`[]` is index 0, as in qs), or undefined for any other suffix. */
function listIndex(suffix: string): number | undefined {
  if (suffix === '[]') return 0;
  // qs takes only a canonical number as an index: `a[01]` is an object key, like `a[b]`.
  const digits = /^\[(0|[1-9]\d*)\]$/.exec(suffix)?.[1];
  const index = digits === undefined ? Number.NaN : Number(digits);
  return index <= MAX_QUERY_LIST_INDEX ? index : undefined;
}

/** qs's merge of a plain `name=value` into what the key already holds. */
function withPlainValue(previous: QueryValue | undefined, value: string): QueryValue {
  if (previous === undefined) return value;
  if (typeof previous === 'string') return [previous, value];
  if (Array.isArray(previous)) previous.push(value);
  return previous;
}

/**
 * qs's merge of `name[index]=value`: a free slot takes the value, a taken one appends it, and a
 * plain value already there comes first. Holes are compacted at the end, so only order matters.
 */
function withListValue(previous: QueryValue | undefined, { index, value }: { index: number; value: string }): QueryValue {
  if (previous !== undefined && typeof previous !== 'string' && !Array.isArray(previous)) return previous;
  const list = typeof previous === 'string' ? [previous] : (previous ?? []);
  const slot = typeof previous === 'string' ? index + 1 : index;
  if (slot in list) list.push(value);
  else list[slot] = value;
  return list;
}

function addQueryValue({ query, key, value }: { query: Map<string, QueryValue>; key: string; value: string }): void {
  const bracket = key.indexOf('[');
  if (bracket <= 0) {
    query.set(key, withPlainValue(query.get(key), value));
    return;
  }
  const name = key.slice(0, bracket);
  const index = listIndex(key.slice(bracket));
  // Any other bracketed key (`a[b]`, `a[0][b]`, `a[21]`) made `a` an object in qs, whatever came before.
  query.set(name, index === undefined ? BRACKETED_QUERY_VALUE : withListValue(query.get(name), { index, value }));
}

/**
 * The query string in the shapes the Express 4 host's `req.query` gave routes, so a converted
 * route's existing validation sees the same values: one value → string; a repeated key, `name[]`
 * or `name[i]` (i ≤ 20), in any mix → `string[]` in qs's order; any other bracketed key
 * (`a[b]=1`, `a[21]=1`) → a non-string, non-list value, so a route that requires a string or a
 * list of strings still refuses it instead of reading it as absent. Nested values are not parsed:
 * no Jini route reads them. Built from entries, so `__proto__` is a plain key.
 * @complexity O(n) in query parameters.
 */
export function readQuery({ request }: { readonly request: Request }, _optional: Record<string, never> = {}): Record<string, unknown> {
  const query = new Map<string, QueryValue>();
  for (const [key, value] of new URL(request.url).searchParams) addQueryValue({ query, key, value });
  // `filter` skips the holes an index left, as qs's compaction did.
  return Object.fromEntries([...query].map(([key, value]) => [key, Array.isArray(value) ? value.filter(() => true) : value]));
}
