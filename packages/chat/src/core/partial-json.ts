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

// Bound repair and JSON.parse work for untrusted model-generated structured output.
const MAX_STRUCTURED_INPUT_CHARS = 64 * 1024;
// A valid streamed prefix settles in two cleanup passes (cut value, then its key/comma). Input
// needing more is not JSON (`[t,t,t,…`), and each extra pass would rescan the whole buffer.
const MAX_TAIL_CLEANUP_PASSES = 8;

/** Linear form of `/[,\s]+$/`, which V8 retries from every separator in a long run (quadratic). */
function trimTrailingSeparators({ text }: { text: string }, _optional: {} = {}): string {
  let end = text.length;
  while (end > 0 && /[,\s]/.test(text[end - 1]!)) end -= 1;
  return text.slice(0, end);
}

/** Consume one quoted character; an escaped quote does not end the string. */
function advanceJsonString({ c, esc }: { c: string; esc: boolean }, _optional: {} = {}): { inStr: boolean; esc: boolean } {
  if (esc) return { inStr: true, esc: false };
  return { inStr: c !== '"', esc: c === '\\' };
}

/** Track strings/escapes and owed container closers in one pass over a bounded JSON prefix. */
function scanJsonPrefix({ buf }: { buf: string }, _optional: {} = {}): { stack: string[]; inStr: boolean } {
  const stack: string[] = []; // closers owed, e.g. ['}', ']']
  let inStr = false;
  let esc = false;
  for (const c of buf) {
    if (inStr) {
      ({ inStr, esc } = advanceJsonString({ c, esc }));
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  return { stack, inStr };
}

/** Close a string cut off mid-value (or mid-key). First neutralize a
 * dangling escape at the cut point, otherwise the closing quote would be
 * swallowed (`...x\` + `"` → escaped quote) or a partial `\uXXXX` would
 * be an invalid escape — either makes JSON.parse fail and collapses the
 * live preview. Common in prompts that mention Windows paths, regexes,
 * or escaped quotes.
 */
function closeJsonString({ out }: { out: string }, _optional: {} = {}): string {
  out = out.replace(/\\u[0-9a-fA-F]{0,3}$/, ''); // incomplete \uXXXX
  if (/(?:^|[^\\])(?:\\\\)*\\$/.test(out)) out = out.slice(0, -1); // lone trailing backslash
  return out + '"';
}

/** Returns null when the tail never settles within the pass bound. */
function trimIncompleteTail({ out }: { out: string }, _optional: {} = {}): string | null {
  // 2. Trim trailing structural noise that can't be completed into a value:
  //    a dangling comma, a `"key":` with no value yet, and an unfinished
  //    *scalar* value cut mid-token (a partial `true`/`false`/`null`, or a
  //    number ending on `.`/`e`/sign). Leaving those makes `{… :f}` etc.
  //    unparseable, collapsing the live preview whenever a literal splits
  //    across deltas. Each trim leaves a `"key":` / `,` / `[` boundary that
  //    the next loop iteration cleans up. Complete literals (`true`, `12`,
  //    `1.5`, `1e3`) are not prefixes of these patterns, so they survive.
  const valueStart = '([:[,]\\s*)';
  let prev: string;
  let passes = 0;
  do {
    if (++passes > MAX_TAIL_CLEANUP_PASSES) return null;
    prev = out;
    out = trimTrailingSeparators({ text: out });
    out = out.replace(/"(?:[^"\\]|\\.)*"\s*:\s*$/, ''); // key + colon, no value
    out = out.replace(new RegExp(`${valueStart}(?:tru|tr|t|fals|fal|fa|f|nul|nu|n)$`), '$1'); // partial bool/null
    out = out.replace(new RegExp(`${valueStart}-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)?[eE][+-]?$`), '$1'); // dangling exponent
    out = out.replace(new RegExp(`${valueStart}-?\\d*\\.$`), '$1'); // number ending in '.'
    out = out.replace(new RegExp(`${valueStart}-$`), '$1'); // lone minus
    out = out.replace(/"(?:[^"\\]|\\.)*"\s*:\s*$/, ''); // key + colon exposed by the trims above
    out = trimTrailingSeparators({ text: out });
  } while (out !== prev);
  return out;
}

/**
 * Repair a truncated JSON prefix into the largest valid JSON text that can be
 * parsed, by walking the buffer once to track string/escape state and the
 * open-container stack, then closing whatever is still open.
 *
 * @param buf - A possibly-incomplete JSON text (a streamed prefix).
 * @returns Empty text above 64 Ki characters or for non-JSON tails that never settle; otherwise
 *   best-effort closed JSON. Not guaranteed to parse (e.g. an empty buffer round-trips unchanged) — callers should still
 *   wrap consumption in `JSON.parse`/try-catch (see {@link parsePartialJson}).
 * @complexity O(n) time / O(d) space in the input length `n` and max nesting
 *   depth `d` — one linear scan plus at most 8 linear cleanup passes over the tail.
 */
export function repairJsonPrefix({ buf }: { buf: string }, _optional: {} = {}): string {
  if (buf.length > MAX_STRUCTURED_INPUT_CHARS) return '';
  const { stack, inStr } = scanJsonPrefix({ buf });
  const settled = trimIncompleteTail({ out: inStr ? closeJsonString({ out: buf }) : buf });
  if (settled === null) return '';
  let out = dropPendingKey({ out: settled, stack });
  // 3. Close every still-open container, innermost first.
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  return out;
}

// A bare trailing key (string with no following colon) only happens when
// the *innermost* open container is an object. Drop it so we don't emit
// `{"hea"}` which is invalid (key without value).
function dropPendingKey({ out, stack }: { out: string; stack: readonly string[] }, _optional: {} = {}): string {
  if (stack[stack.length - 1] === '}' && /"(?:[^"\\]|\\.)*"\s*$/.test(out)) {
    const trimmed = out.replace(/"(?:[^"\\]|\\.)*"\s*$/, '');
    // Only drop it if what precedes is a container/comma boundary (i.e. the
    // string really is a pending key, not a completed value like `:"x"`).
    if (/[{,]\s*$/.test(trimmed)) {
      out = trimTrailingSeparators({ text: trimmed });
    }
  }
  return out;
}

/**
 * Best-effort parse of a (possibly truncated) JSON prefix.
 *
 * @param buf - A possibly-incomplete JSON text.
 * @returns The parsed value, or `null` on input above 64 Ki characters, empty input or an unrecoverable
 *   parse failure — callers should fall back to their last good value.
 * @complexity O(n) — dominated by {@link repairJsonPrefix}.
 */
export function parsePartialJson({ buf }: { buf: string }, _optional: {} = {}): unknown {
  if (buf.length > MAX_STRUCTURED_INPUT_CHARS) return null;
  const trimmed = buf.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(repairJsonPrefix({ buf: trimmed }));
  } catch {
    return null;
  }
}
