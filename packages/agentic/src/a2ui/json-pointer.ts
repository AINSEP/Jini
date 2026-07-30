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
export function parsePointerTokens(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new Error(`invalid JSON Pointer (must start with "/"): ${JSON.stringify(pointer)}`);
  }
  return pointer.slice(1).split('/').map(unescapeToken);
}

export function joinPointer(base: string, ...tokens: string[]): string {
  const baseTokens = base === '' || base === '/' ? [] : parsePointerTokens(base);
  return '/' + [...baseTokens, ...tokens].map(escapeToken).join('/');
}

/** Reads the value at `pointer` in `doc`. Never throws on a non-resolving path — `found: false` degrades sanely, matching this port's "a bad binding must not crash the renderer" adversarial requirement (see `resolve.ts`). */
export function getAtPointer(doc: unknown, pointer: string): PointerGetResult {
  if (isRootPointer(pointer)) return { found: true, value: doc };

  let tokens: string[];
  try {
    tokens = parsePointerTokens(pointer);
  } catch {
    return { found: false, value: undefined };
  }

  let current: unknown = doc;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return { found: false, value: undefined };
      const index = Number(token);
      if (index >= current.length) return { found: false, value: undefined };
      current = current[index];
      continue;
    }
    if (current !== null && typeof current === 'object') {
      const record = current as Record<string, unknown>;
      if (!hasOwnToken(record, token)) return { found: false, value: undefined };
      current = record[token];
      continue;
    }
    return { found: false, value: undefined };
  }
  return { found: true, value: current };
}

/**
 * Writes `value` at `pointer` in `doc`, returning a **new** document (the original is never
 * mutated — every intermediate object on the path is shallow-copied). Missing intermediate
 * segments are created as plain objects (this port does not attempt array-vs-object inference for
 * not-yet-existing intermediate segments — a documented simplification, not a spec requirement).
 * `value === null` at a non-root pointer deletes the key/value at that location, per
 * `updateDataModel`'s own spec text ("To delete the key/value at path, set value explicitly to
 * null."). At the root pointer, `value === null` replaces the entire data model with `null` (there
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
export function setAtPointer(doc: unknown, pointer: string, value: unknown): unknown {
  if (isRootPointer(pointer)) return value;

  let tokens: string[];
  try {
    tokens = parsePointerTokens(pointer);
  } catch {
    return doc;
  }
  const parentTokens = tokens.slice(0, -1);
  const lastToken = tokens[tokens.length - 1]!;

  function recurse(current: unknown, remaining: string[]): unknown {
    if (remaining.length === 0) {
      // `current` here is the parent container; apply the final write/delete.
      if (Array.isArray(current)) {
        if (!/^(0|[1-9]\d*)$/.test(lastToken)) return current;
        const index = Number(lastToken);
        const next = current.slice();
        if (value === null) {
          if (index < next.length) next.splice(index, 1);
          return next;
        }
        next[index] = value;
        return next;
      }
      const record = current !== null && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {};
      if (value === null) {
        delete record[lastToken];
        return record;
      }
      defineOwn(record, lastToken, value);
      return record;
    }

    const [head, ...rest] = remaining;
    if (Array.isArray(current)) {
      if (!head || !/^(0|[1-9]\d*)$/.test(head)) return current;
      const index = Number(head);
      const next = current.slice();
      next[index] = recurse(index < next.length ? next[index] : {}, rest);
      return next;
    }
    const record = current !== null && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {};
    if (!head) return record;
    defineOwn(record, head, recurse(hasOwnToken(record, head) ? record[head] : {}, rest));
    return record;
  }

  return recurse(doc, parentTokens);
}
