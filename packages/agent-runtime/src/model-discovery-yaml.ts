/**
 * @file The `model:` value of a YAML agent config, read without a regex. The pattern this replaces,
 * `/^model\s*:\s*["']?([^\n"'#]+)["']?\s*(?:#.*)?$/m`, backtracks super-linearly on long
 * whitespace runs; `yamlModelCapture` returns exactly what its group captured, in time linear in
 * the input for each `model` key it tries.
 */

// `/^model\s*:\s*["']?([^\n"'#]+)["']?\s*(?:#.*)?$/m`'s capture, as a linear scan. Two regex
// details survive: the group may end early at an in-run line terminator (`\r`, U+2028, U+2029,
// before which `$` matches), and it may start inside the whitespace after the colon (the regex
// backtracks out of `\s*` one character at a time when the value itself does not match).
const YAML_LINE_TERMINATORS = '\n\r\u2028\u2029';
const YAML_GROUP_STOPS = '\n"\'#';

const isYamlSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);
const isYamlQuote = (ch: string | undefined): boolean => ch === '"' || ch === "'";
const isYamlTerminator = (ch: string | undefined): boolean => ch !== undefined && YAML_LINE_TERMINATORS.includes(ch);

function yamlSpaceEnd(raw: string, index: number): number {
  let i = index;
  while (isYamlSpace(raw[i])) i += 1;
  return i;
}

/** End of the run of group characters (anything but a newline, quote or `#`) from `index`. */
function yamlRunEnd(raw: string, index: number): number {
  let i = index;
  while (i < raw.length && !YAML_GROUP_STOPS.includes(raw[i]!)) i += 1;
  return i;
}

/** Whether `["']?\s*(?:#.*)?$` matches at `index`. */
function yamlTailMatches(raw: string, index: number): boolean {
  const from = isYamlQuote(raw[index]) ? index + 1 : index;
  const end = yamlSpaceEnd(raw, from);
  if (end === raw.length || raw[end] === '#') return true;
  for (let i = from; i < end; i += 1) if (isYamlTerminator(raw[i])) return true;
  return false;
}

/** Last line terminator strictly inside `(start, end)`, or -1. */
function yamlLastTerminator(raw: string, start: number, end: number): number {
  for (let i = end - 1; i > start; i -= 1) if (isYamlTerminator(raw[i])) return i;
  return -1;
}

/** Where a group starting inside a run can end: the run's end when the tail matches there,
 *  else just before the run's last in-run line terminator (`cut`, -1 when it has none). */
interface YamlRun { end: number; tailMatches: boolean; cut: number }

/** The group captured when it starts at `start` inside `run`, or undefined. */
function yamlGroupFrom(raw: string, start: number, run: YamlRun): string | undefined {
  if (run.end === start) return undefined;
  if (run.tailMatches) return raw.slice(start, run.end);
  return run.cut === -1 ? undefined : raw.slice(start, run.cut);
}

/** The capture for a `model` key whose colon ends just before `afterColon`, or undefined. */
function yamlModelValue(raw: string, afterColon: number): string | undefined {
  const valueStart = yamlSpaceEnd(raw, afterColon);
  if (isYamlQuote(raw[valueStart])) {
    const quotedEnd = yamlRunEnd(raw, valueStart + 1);
    const quotedRun = { end: quotedEnd, tailMatches: yamlTailMatches(raw, quotedEnd), cut: yamlLastTerminator(raw, valueStart + 1, quotedEnd) };
    const quoted = yamlGroupFrom(raw, valueStart + 1, quotedRun);
    if (quoted !== undefined) return quoted;
  }
  // Walk left from the value through the whitespace after the colon, updating the current run
  // in O(1) per step: a newline ends the run to its left (and `$` matches before it), and each
  // step can only add a new last-terminator candidate when the run has none yet.
  const runEnd = yamlRunEnd(raw, valueStart);
  const run: YamlRun = { end: runEnd, tailMatches: yamlTailMatches(raw, runEnd), cut: yamlLastTerminator(raw, valueStart, runEnd) };
  for (let start = valueStart; start >= afterColon; start -= 1) {
    const group = raw[start] === '\n' ? undefined : yamlGroupFrom(raw, start, run);
    if (group !== undefined) return group;
    yamlExtendRunLeft(raw, start, run);
  }
  return undefined;
}

/** Moves `run` to start one character left of `start`. */
function yamlExtendRunLeft(raw: string, start: number, run: YamlRun): void {
  if (raw[start] === '\n') {
    Object.assign(run, { end: start, tailMatches: true, cut: -1 });
    return;
  }
  if (run.cut === -1 && start < run.end && isYamlTerminator(raw[start])) run.cut = start;
}

/** First `model:` capture of `/^model\s*:\s*["']?([^\n"'#]+)["']?\s*(?:#.*)?$/m` in `raw`. */
export function yamlModelCapture(raw: string): string | undefined {
  for (let lineStart = 0; lineStart <= raw.length; lineStart += 1) {
    const atLineStart = lineStart === 0 || isYamlTerminator(raw[lineStart - 1]);
    const colon = atLineStart && raw.startsWith('model', lineStart) ? yamlSpaceEnd(raw, lineStart + 5) : -1;
    const value = raw[colon] === ':' ? yamlModelValue(raw, colon + 1) : undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}
