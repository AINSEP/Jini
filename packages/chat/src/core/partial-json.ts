/**
 * @module partial-json
 *
 * Truncation-tolerant JSON parsing for streamed LLM output. A streaming
 * `<question-form>` (or any other structured artifact) needs to render a
 * JSON *prefix* that grows one token at a time, so callers rely on this
 * repair pass instead of waiting for the closing brace.
 *
 * Deliberately handles only the shapes a streaming model emits — balanced
 * structure that simply hasn't finished — not arbitrary corruption. Callers
 * should still keep their last good parsed result as a fallback.
 */

/**
 * Repair a truncated JSON prefix into the largest valid JSON text that can be
 * parsed, by walking the buffer once to track string/escape state and the
 * open-container stack, then closing whatever is still open.
 *
 * @param buf - A possibly-incomplete JSON text (a streamed prefix).
 * @returns A best-effort syntactically-closed JSON text. Not guaranteed to
 *   parse (e.g. an empty buffer round-trips unchanged) — callers should still
 *   wrap consumption in `JSON.parse`/try-catch (see {@link parsePartialJson}).
 * @complexity O(n) time / O(d) space in the input length `n` and max nesting
 *   depth `d` — one linear scan plus a bounded fixed-point cleanup loop over
 *   the (already shrinking) tail.
 */
export function repairJsonPrefix({ buf }: { buf: string }): string {
  const { stack, inStr } = scanOpenState({ buf });
  let out = inStr ? closeOpenString({ out: buf }) : buf;
  out = trimIncompleteTail({ out });
  out = dropPendingKey({ out, stack });
  // 3. Close every still-open container, innermost first.
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  return out;
}

const CLOSER_FOR: Readonly<Record<string, string>> = { '{': '}', '[': ']' };

/** Push the closer an opener owes, or pay one off for a closer. */
function trackContainer({ stack, c }: { stack: string[]; c: string }, _optional: {} = {}): void {
  const closer = CLOSER_FOR[c];
  if (closer) stack.push(closer);
  else if (c === '}' || c === ']') stack.pop();
}

/** Walk the buffer once, tracking string/escape state and the closers still owed. */
function scanOpenState({ buf }: { buf: string }, _optional: {} = {}): { stack: string[]; inStr: boolean } {
  const stack: string[] = []; // closers owed, e.g. ['}', ']']
  let inStr = false;
  let esc = false;
  for (const c of buf) {
    if (!inStr) {
      inStr = c === '"';
      trackContainer({ stack, c });
    } else if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === '"') inStr = false;
  }
  return { stack, inStr };
}

// 1. Close a string cut off mid-value (or mid-key). First neutralize a
//    dangling escape at the cut point, otherwise the closing quote would be
//    swallowed (`...x\` + `"` → escaped quote) or a partial `\uXXXX` would
//    be an invalid escape — either makes JSON.parse fail and collapses the
//    live preview. Common in prompts that mention Windows paths, regexes,
//    or escaped quotes.
function closeOpenString({ out }: { out: string }, _optional: {} = {}): string {
  let closed = out.replace(/\\u[0-9a-fA-F]{0,3}$/, ''); // incomplete \uXXXX
  if (/(?:^|[^\\])(?:\\\\)*\\$/.test(closed)) closed = closed.slice(0, -1); // lone trailing backslash
  return `${closed}"`;
}

// 2. Trim trailing structural noise that can't be completed into a value:
//    a dangling comma, a `"key":` with no value yet, and an unfinished
//    *scalar* value cut mid-token (a partial `true`/`false`/`null`, or a
//    number ending on `.`/`e`/sign). Leaving those makes `{… :f}` etc.
//    unparseable, collapsing the live preview whenever a literal splits
//    across deltas. Each trim leaves a `"key":` / `,` / `[` boundary that
//    the next loop iteration cleans up. Complete literals (`true`, `12`,
//    `1.5`, `1e3`) are not prefixes of these patterns, so they survive.
//    A `"key":` (or `,`) exposed by a later trim is removed on the next
//    fixed-point iteration, so each pattern needs to appear only once.
const valueStart = '([:[,]\\s*)';
const TAIL_TRIMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[,\s]+$/, ''],
  [/"(?:[^"\\]|\\.)*"\s*:\s*$/, ''], // key + colon, no value
  [new RegExp(`${valueStart}(?:tru|tr|t|fals|fal|fa|f|nul|nu|n)$`), '$1'], // partial bool/null
  [new RegExp(`${valueStart}-?(?:\\d+\\.?\\d*|\\d*\\.\\d+)?[eE][+-]?$`), '$1'], // dangling exponent
  [new RegExp(`${valueStart}-?\\d*\\.$`), '$1'], // number ending in '.'
  [new RegExp(`${valueStart}-$`), '$1'], // lone minus
];

function trimIncompleteTail({ out }: { out: string }, _optional: {} = {}): string {
  let current = out;
  let prev: string;
  do {
    prev = current;
    for (const [pattern, replacement] of TAIL_TRIMS) current = current.replace(pattern, replacement);
  } while (current !== prev);
  return current;
}

// A bare trailing key (string with no following colon) only happens when
// the *innermost* open container is an object. Drop it so we don't emit
// `{"hea"}` which is invalid (key without value).
function dropPendingKey({ out, stack }: { out: string; stack: readonly string[] }, _optional: {} = {}): string {
  if (stack[stack.length - 1] !== '}') return out;
  const trimmed = out.replace(/"(?:[^"\\]|\\.)*"\s*$/, '');
  // Only drop it if what precedes is a container/comma boundary (i.e. the
  // string really is a pending key, not a completed value like `:"x"`).
  return trimmed !== out && /[{,]\s*$/.test(trimmed) ? trimmed.replace(/[,\s]+$/, '') : out;
}

/**
 * Best-effort parse of a (possibly truncated) JSON prefix.
 *
 * @param buf - A possibly-incomplete JSON text.
 * @returns The parsed value, or `null` on empty input or an unrecoverable
 *   parse failure — callers should fall back to their last good value.
 * @complexity O(n) — dominated by {@link repairJsonPrefix}.
 */
export function parsePartialJson({ buf }: { buf: string }): unknown {
  const trimmed = buf.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(repairJsonPrefix({ buf: trimmed }));
  } catch {
    return null;
  }
}
