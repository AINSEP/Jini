/**
 * @module json-pointer
 *
 * A minimal RFC 6901 (JSON Pointer) implementation for A2UI's data-model bindings
 * (`common_types.json#/$defs/DataBinding`: `{"path": "/user/name"}`). Deliberately small — no
 * external dependency pulled in for this; the operations A2UI actually needs (root-scope read,
 * collection-scope relative read via string concatenation, write-with-null-deletes) are a thin
 * slice of the full RFC.
 *
 * One documented, deliberate deviation from strict RFC 6901: `updateDataModel`'s own spec text
 * (`agent_to_renderer.json`, `UpdateDataModelMessage.path`'s description, fetched verbatim) says
 * "An optional path to a location within the data model (e.g., '/user/name'). If omitted, or set
 * to '/', refers to the entire data model." Under strict RFC 6901, `""` (empty string) is the
 * pointer to the whole document and `"/"` is the pointer to the property keyed by the empty
 * string on the root object — two different things. A2UI's own spec text explicitly overloads
 * `"/"` to mean "the whole document," not "the empty-string-keyed property." This module follows
 * A2UI's own wording exactly (not raw RFC 6901) since that is what a conformant renderer must do;
 * flagged here rather than silently treated as an oversight.
 */

export interface PointerGetResult {
  readonly found: boolean;
  readonly value: unknown;
}

/**
 * Whether `record` itself carries `token` — never whether it *inherits* it.
 *
 * A JSON Pointer addresses a member of a JSON document, and a JSON document has no inherited
 * members. The `token in record` form this replaced answered `true` for everything
 * `Object.prototype` contributes, so `getAtPointer({}, "/constructor")` resolved the `Object`
 * constructor as though the agent's data model contained it.
 */
function hasOwnToken(record: Record<string, unknown>, token: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, token);
}

/**
 * Writes one own, plain data property — never through an inherited accessor.
 *
 * `record[token] = value` looks like it defines a key, and does for every token but one:
 * `__proto__` is an inherited accessor on `Object.prototype`, so assigning to it *sets the
 * object's prototype* instead. An agent sending `{"path": "/__proto__", "value": {...}}` therefore
 * reshaped the object this function was building rather than putting a key in it. (Narrower than
 * classic prototype pollution — the shallow-copy discipline here means only the one returned
 * object was affected, never the global `Object.prototype` — but a pointer must address the
 * document, so this defines the key RFC 6901 actually named.)
 */
function defineOwn(record: Record<string, unknown>, token: string, value: unknown): void {
  Object.defineProperty(record, token, { value, writable: true, enumerable: true, configurable: true });
}

/** `true` for the two spellings A2UI's own spec treats as "the whole document" (see module doc). Anything else is parsed as a normal RFC 6901 pointer. */
function isRootPointer(pointer: string): boolean {
  return pointer === '' || pointer === '/';
}

function unescapeToken(token: string): string {
  // RFC 6901 §4: ~1 must be decoded *before* ~0 is checked (a literal '~' that was itself part of
  // an escaped '/' must not be re-decoded as '~0').
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

function escapeToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Splits a non-root pointer into its unescaped reference tokens. `pointer` must start with `/`. */
export function parsePointerTokens({ pointer }: { pointer: string }, _optional: Record<string, never> = {}): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new Error(`invalid JSON Pointer (must start with "/"): ${JSON.stringify(pointer)}`);
  }
  return pointer.slice(1).split('/').map(unescapeToken);
}

export function joinPointer({ base, tokens }: { base: string; tokens: string[] }, _optional: Record<string, never> = {}): string {
  const baseTokens = isRootPointer(base) ? [] : parsePointerTokens({ pointer: base });
  return '/' + [...baseTokens, ...tokens].map(escapeToken).join('/');
}

/** The pointer's tokens, or `null` for a malformed pointer — the read and write paths both degrade on that instead of throwing. */
function tryParsePointerTokens(pointer: string): string[] | null {
  try {
    return parsePointerTokens({ pointer });
  } catch {
    return null;
  }
}

/** The array index `token` names, or `undefined` unless it is a canonical RFC 6901 index (`0`, or digits with no leading zero — never `-`, signs, exponents or whitespace). */
function arrayIndexOf(token: string): number | undefined {
  return /^(0|[1-9]\d*)$/.test(token) ? Number(token) : undefined;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function notFound(): PointerGetResult {
  return { found: false, value: undefined };
}

/** One step of a read: the member `token` names in `current`, if `current` itself (never its prototype chain) has it. */
function readMember(current: unknown, token: string): PointerGetResult {
  if (Array.isArray(current)) {
    const index = arrayIndexOf(token);
    return index !== undefined && index < current.length ? { found: true, value: current[index] } : notFound();
  }
  return isObjectLike(current) && hasOwnToken(current, token) ? { found: true, value: current[token] } : notFound();
}

/** Reads the value at `pointer` in `doc`. Never throws on a non-resolving path — `found: false` degrades sanely, matching this port's "a bad binding must not crash the renderer" adversarial requirement (see `resolve.ts`). */
export function getAtPointer({ doc, pointer }: { doc: unknown; pointer: string }, _optional: Record<string, never> = {}): PointerGetResult {
  if (isRootPointer(pointer)) return { found: true, value: doc };

  const tokens = tryParsePointerTokens(pointer);
  if (tokens === null) return notFound();

  let current: unknown = doc;
  for (const token of tokens) {
    const step = readMember(current, token);
    if (!step.found) return step;
    current = step.value;
  }
  return { found: true, value: current };
}

/** A shallow copy of `current` when it is an object, otherwise a fresh empty object to write into. */
function copyRecord(current: unknown): Record<string, unknown> {
  return isObjectLike(current) ? { ...current } : {};
}

/** The final write/delete into an array parent. Invalid or sparse writes leave it untouched; index === length appends. */
function writeArrayLeaf(array: unknown[], token: string, value: unknown): unknown[] {
  const index = arrayIndexOf(token);
  if (index === undefined || (value !== null && index > array.length)) return array;
  const next = array.slice();
  // `splice` past the end removes nothing, so an out-of-range delete needs no guard of its own.
  if (value === null) {
    next.splice(index, 1);
  } else {
    next[index] = value;
  }
  return next;
}

/** The final write/delete into an object parent (a non-object parent is replaced by a fresh object). */
function writeRecordLeaf(current: unknown, token: string, value: unknown): Record<string, unknown> {
  const record = copyRecord(current);
  if (value === null) {
    delete record[token];
  } else {
    defineOwn(record, token, value);
  }
  return record;
}

/** The write's final segment and value, threaded unchanged through the path walk. */
interface LeafWrite {
  readonly token: string;
  readonly value: unknown;
}

/** Returns a copy of `current` with `leaf` applied at `remaining`; missing-path deletes preserve existing parents. */
function writePath(current: unknown, remaining: readonly string[], leaf: LeafWrite): unknown {
  if (leaf.value === null && !isObjectLike(current)) return current;
  if (remaining.length === 0) {
    // `current` here is the parent container; apply the final write/delete.
    return Array.isArray(current) ? writeArrayLeaf(current, leaf.token, leaf.value) : writeRecordLeaf(current, leaf.token, leaf.value);
  }
  const [head, ...rest] = remaining as [string, ...string[]];
  if (leaf.value === null && !readMember(current, head).found) return current;
  return Array.isArray(current) ? writeArrayBranch(current, head, rest, leaf) : writeRecordBranch(current, head, rest, leaf);
}

/** An intermediate array segment. Invalid or sparse indices leave it untouched; index === length appends. */
function writeArrayBranch(array: unknown[], head: string, rest: readonly string[], leaf: LeafWrite): unknown[] {
  const index = arrayIndexOf(head);
  if (index === undefined || index > array.length) return array;
  const next = array.slice();
  next[index] = writePath(index < next.length ? next[index] : {}, rest, leaf);
  return next;
}

/** An intermediate object segment. An empty-string token is a documented no-op (see the `"//x"` test): the copy is returned unwritten. */
function writeRecordBranch(current: unknown, head: string, rest: readonly string[], leaf: LeafWrite): Record<string, unknown> {
  const record = copyRecord(current);
  if (!head) return record;
  defineOwn(record, head, writePath(hasOwnToken(record, head) ? record[head] : {}, rest, leaf));
  return record;
}

/**
 * Writes `value` at `pointer` in `doc`, returning a **new** document (the original is never
 * mutated — every intermediate object on the path is shallow-copied). Missing intermediate
 * segments for non-null writes are created as plain objects (this port does not attempt
 * array-vs-object inference for not-yet-existing intermediate segments — a documented
 * simplification, not a spec requirement).
 * `value === null` at a non-root pointer deletes the key/value at that location, per
 * `updateDataModel`'s own spec text ("To delete the key/value at path, set value explicitly to
 * null."). Deleting an absent path preserves its missing or primitive parents. Array writes may
 * replace an existing index or append at the current length, but never create sparse gaps: an
 * agent-chosen index must not inflate the data model and freeze subsequent copies or renders.
 * At the root pointer, `value === null` replaces the entire data model with `null` (there
 * is no "key" to delete at the root; documented as this port's own consistent interpretation).
 *
 * Never throws on a malformed pointer (e.g. missing leading `/`) — degrades to a no-op (`doc`
 * returned unchanged), matching `getAtPointer`'s "a bad binding must not crash the renderer"
 * contract. `updateDataModel`'s `path` is agent-authored wire data; an uncaught throw here had no
 * error boundary above it anywhere in `packages/chat-react` or its hosts to stop it from
 * unmounting the whole chat React root (see `ExtEventErrorBoundary`, added as a systemic backstop
 * for the same class of bug — this is the specific root cause it would otherwise have had to
 * catch).
 */
export function setAtPointer({ doc, pointer, value }: { doc: unknown; pointer: string; value: unknown }, _optional: Record<string, never> = {}): unknown {
  if (isRootPointer(pointer)) return value;

  const tokens = tryParsePointerTokens(pointer);
  if (tokens === null) return doc;
  return writePath(doc, tokens.slice(0, -1), { token: tokens[tokens.length - 1]!, value });
}
