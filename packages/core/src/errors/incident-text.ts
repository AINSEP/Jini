/**
 * @file The text of a thrown value for the operator-only incident record. Not for callers: an error
 * message can quote private text that no redactor recognises, so this text goes to the host record
 * and the tracker only, after secret shapes and the host's exact secrets are blanked.
 *
 * A thrown value is untrusted. For a value that is not an `Error` this reads data properties only:
 * it never runs a getter, `toJSON` or a custom inspector (core cannot use `node:util`, whose
 * `inspect(..., { customInspect: false, getters: false })` the visitor reporter relied on). An
 * `Error` is read through its own `stack` and `message`, inside the same guard.
 */
const MAX_STACK_LINES = 30;
const MAX_DEPTH = 3;
const MAX_ENTRIES = 20;
/** Raw text is cut here before redaction so one huge value cannot stall the failure path; the
 *  record itself is cut after redaction, well below this, so a secret split by this cut is never printed. */
export const MAX_RAW_INCIDENT_TEXT = 65_536;
const UNREADABLE = '[unreadable]';
const ACCESSOR = Symbol('accessor property');

/** Options of {@link describeThrownValue}. None yet; named so one can be added without changing the signature. */
export interface DescribeThrownValueOptions {}

/** A data property's value from the object or its prototypes; {@link ACCESSOR} for a getter, which is never called. */
function dataProperty({ target, key }: { target: object; key: string }): unknown {
  for (let holder: object | null = target; holder !== null; holder = Object.getPrototypeOf(holder) as object | null) {
    const descriptor = Object.getOwnPropertyDescriptor(holder, key);
    if (descriptor !== undefined) return 'value' in descriptor ? descriptor.value : ACCESSOR;
  }
  return undefined;
}

function scalarText({ value }: { value: unknown }): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'symbol') return '[symbol]';
  return String(value);
}

function entryText({ target, key, depth }: { target: object; key: string; depth: number }): string {
  const value = dataProperty({ target, key });
  return value === ACCESSOR ? '[getter]' : valueText({ value, depth: depth + 1 });
}

function valueText({ value, depth }: { value: unknown; depth: number }): string {
  if (typeof value !== 'object' || value === null) return scalarText({ value });
  if (depth >= MAX_DEPTH) return '[nested too deep]';
  const list = Array.isArray(value);
  const keys = Object.keys(value);
  const shown = keys.slice(0, MAX_ENTRIES).map(key => (list ? '' : `${key}: `) + entryText({ target: value, key, depth }));
  if (keys.length > MAX_ENTRIES) shown.push('…');
  return list ? `[${shown.join(', ')}]` : `{ ${shown.join(', ')} }`;
}

/** An `Error` is read the ordinary way: on current V8 `stack` is an accessor, so a data-only read would lose every native stack. */
function errorText({ error }: { error: Error }): string {
  const stack: unknown = error.stack;
  if (typeof stack === 'string' && stack.trim()) return stack.split('\n').slice(0, MAX_STACK_LINES).join('\n');
  const message: unknown = error.message;
  return typeof message === 'string' ? `Error: ${message}` : 'Error: [message unavailable]';
}

/**
 * Message and up to 30 stack lines of an `Error`; for any other value, its own data only.
 * Never throws: a revoked Proxy or a hostile prototype becomes `[unreadable]`.
 * @returns Unredacted text, cut at {@link MAX_RAW_INCIDENT_TEXT}. The caller redacts it before storing it.
 * @complexity O(min(size of the value, a fixed bound)).
 */
export function describeThrownValue(required: { value: unknown }, _optional: DescribeThrownValueOptions = {}): string {
  try {
    const { value } = required;
    const text = value instanceof Error ? errorText({ error: value }) : typeof value === 'string' ? value : valueText({ value, depth: 0 });
    return text.slice(0, MAX_RAW_INCIDENT_TEXT);
  } catch {
    return UNREADABLE;
  }
}
