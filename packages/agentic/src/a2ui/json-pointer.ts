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
      if (!(token in record)) return { found: false, value: undefined };
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
 */
export function setAtPointer(doc: unknown, pointer: string, value: unknown): unknown {
  if (isRootPointer(pointer)) return value;

  const tokens = parsePointerTokens(pointer);
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
      record[lastToken] = value;
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
    record[head] = recurse(head in record ? record[head] : {}, rest);
    return record;
  }

  return recurse(doc, parentTokens);
}
