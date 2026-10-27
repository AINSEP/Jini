/**
 * @file Lexical `$defs` scoping for tool input schemas. A schema embedded as one property (a
 * TipTap document under `bodyJson`) carries its own `$defs` and refers to them as `#/$defs/<name>`,
 * but JSON Schema resolves `#` against the whole tool schema's root, where those names are absent:
 * a strict validator then refuses every call that reaches the embedded schema. Rewriting each such
 * ref to the absolute pointer of the nearest enclosing `$defs` that declares the name keeps the
 * author's meaning (the same lexical lookup the Google provider projection applies) and leaves a
 * schema every client can resolve. Only refs that would otherwise be unresolved change: one the
 * root `$defs` declares already resolves as written, so it keeps its standard meaning even where an
 * embedded `$defs` reuses the name. Literal data (`const`, `enum`, `default`, `examples`) is an
 * instance value, not a schema, so a "$ref" string inside it is data and is never rewritten.
 */

const LOCAL_DEFS_REF = '#/$defs/';
/** Keywords whose values are literal instance data, never schemas. */
const LITERAL_KEYWORDS = new Set(['const', 'enum', 'default', 'examples']);
/** Keywords whose values map names to schemas: the names (a property called `const`) are not keywords. */
const SCHEMA_MAP_KEYWORDS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

/** One enclosing `$defs`: its JSON pointer (URI-fragment encoded) and the names it declares. */
interface DefsScope { readonly pointer: string; readonly names: ReadonlySet<string> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One JSON Pointer segment, escaped (RFC 6901) and URI-encoded as a fragment. */
function pointerSegment(key: string): string {
  return encodeURI(key.replace(/~/g, '~0').replace(/\//g, '~1'));
}

/** The ref rewritten to the innermost non-root scope declaring its name, unless the root resolves it as written. */
function scopedRef(ref: string, scopes: readonly DefsScope[]): string {
  if (!ref.startsWith(LOCAL_DEFS_REF)) return ref;
  const rest = ref.slice(LOCAL_DEFS_REF.length);
  const name = decodeURIComponent(rest.split('/')[0]!).replace(/~1/g, '/').replace(/~0/g, '~');
  // The root scope (pointer '', always first) already resolves `#/$defs/...` as written.
  if (scopes[0]?.pointer === '' && scopes[0].names.has(name)) return ref;
  const owner = scopes.findLast(scope => scope.names.has(name));
  return owner === undefined ? ref : `#${owner.pointer}/$defs/${rest}`;
}

/** One keyword's value inside a schema: a ref, literal data, a name-to-schema map, or more schema. */
function scopeKeyword(key: string, child: unknown, pointer: string, scopes: readonly DefsScope[]): unknown {
  if (key === '$ref' && typeof child === 'string') return scopedRef(child, scopes);
  if (LITERAL_KEYWORDS.has(key)) return child;
  const at = `${pointer}/${pointerSegment(key)}`;
  if (!SCHEMA_MAP_KEYWORDS.has(key) || !isRecord(child)) return scopeValue(child, at, scopes);
  return Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, scopeValue(schema, `${at}/${pointerSegment(name)}`, scopes)]));
}

function scopeValue(value: unknown, pointer: string, scopes: readonly DefsScope[]): unknown {
  if (Array.isArray(value)) return value.map((item, index) => scopeValue(item, `${pointer}/${index}`, scopes));
  if (!isRecord(value)) return value;
  const inner = isRecord(value.$defs) ? [...scopes, { pointer, names: new Set(Object.keys(value.$defs)) }] : scopes;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) out[key] = scopeKeyword(key, child, pointer, inner);
  return out;
}

/**
 * Returns a copy of `schema` whose `#/$defs/<name>` refs the root cannot resolve point at the nearest
 * enclosing `$defs` declaring `<name>`; the input is never mutated (published schemas are frozen).
 * @param requiredArgs.schema - A tool input schema.
 * @returns The scoped copy; identical in content when every ref is already root-scoped.
 * @complexity O(s) time and space in the schema size, plus O(d) scope lookup per ref for d nested `$defs`.
 */
export function scopeNestedSchemaRefs<T>({ schema }: { readonly schema: T }, _optional: Record<string, never> = {}): T {
  return scopeValue(schema, '', []) as T;
}
