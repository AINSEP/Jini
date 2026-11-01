/**
 * @file What a generic tool row names as its target — pure, so `ToolCard.tsx`'s `ToolRowHead` only
 * draws it. Moved out of `ToolCard.tsx` (11-01) when the target learned to read the result too.
 */

/** Argument keys that name *what* a call acted on, best first: an element handle or page, then a human title/name/slug, then a path or query, then an id. */
const SUMMARY_KEYS = ['element', 'page', 'handle', 'title', 'name', 'slug', 'file_path', 'path', 'pattern', 'url', 'query', 'command', 'toolId', 'id'];

/** Result fields that name a record for a person — what a write or read returns about its target. */
const RESULT_NAME_KEYS = ['title', 'name', 'slug'];

/** Argument keys that say what *kind* of thing a call acted on — the last-resort target. */
const KIND_KEYS = ['kind', 'entityType', 'type', 'collection'];

/** A UUID or a long bare hex id: meaningless to a person, so never shown as a row's target. */
const OPAQUE_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/i;

function readable(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !OPAQUE_ID.test(value);
}

function firstReadable(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (readable(value)) return value;
  }
  return undefined;
}

/**
 * The record name a JSON tool result carries — at its top level or one object level down
 * (`{ post: { title } }`). `undefined` for non-JSON text or a result with no name field.
 *
 * @complexity O(k) in the parsed result's top-level key count; one `JSON.parse` of `content`.
 */
function resultName(content: string | undefined): string | undefined {
  if (!content || !content.trimStart().startsWith('{')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (parsed == null || typeof parsed !== 'object') return undefined;
  const obj = parsed as Record<string, unknown>;
  const nested = Object.values(obj).filter((v): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v));
  return firstReadable(obj, RESULT_NAME_KEYS) ?? nested.map((v) => firstReadable(v, RESULT_NAME_KEYS)).find(Boolean);
}

/**
 * What a tool row names as its target, for a person, best first: an argument that names it (see
 * {@link SUMMARY_KEYS}: handle, title, slug, path, query…), the name the result returned, the
 * record's kind ("post"), then any other readable string argument. Never the JSON of the whole
 * object — that read as raw machine output in the head (`{"id":"30127d…","kind":"post",…`); the
 * full arguments are in the expanded detail — and never an opaque id (owner bug 11-01: "Content
 * Post Update 30127d31-…"). `undefined` when nothing reads as a target.
 *
 * @complexity O(k) in the argument and result key counts; one `JSON.parse` of the result.
 */
export function toolRowTarget({ input, resultContent }: { input: unknown; resultContent?: string | undefined }): string | undefined {
  if (typeof input === 'string') return readable(input) ? input : undefined;
  if (input != null && typeof input !== 'object') return String(input);
  const args = (input ?? {}) as Record<string, unknown>;
  return firstReadable(args, SUMMARY_KEYS) ?? resultName(resultContent) ?? firstReadable(args, KIND_KEYS) ?? Object.values(args).find(readable);
}
