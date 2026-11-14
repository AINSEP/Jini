// Fixed labels for what these operator scripts print about a failure. A caught error's text and a
// raw URL can both carry a credential (a URL's user:password part, a signed query value, an echoed
// request), and script output is often pasted or captured into transcripts. So printed lines carry
// a class label, a host, or a generated asset ID that matches the `id` in the script's own
// manifest; the manifest files the operator asked for keep the URLs as data. Skill scripts are
// self-contained bundles, so this file imports nothing from `@jini-ai/*`.

const LABELS = [[AggregateError, "AggregateError"], [TypeError, "TypeError"], [RangeError, "RangeError"], [SyntaxError, "SyntaxError"]];

/** A fixed label for a caught value, chosen by class checks. Never reads message, stack or a
 * constructor name (caller-controlled text); reads `name` once, only to match two fixed names. O(1). */
export function errorClassLabel({ error }, _optional = {}) {
  try {
    if (!(error instanceof Error)) return typeof error;
    const known = LABELS.find(([type]) => error instanceof type);
    if (known) return known[1];
    const name = readNameOnce({ error });
    return name === "AbortError" || name === "TimeoutError" ? name : "Error";
  } catch {
    return "[diagnostic unavailable]"; // The original failure must stand, never a lookup error.
  }
}

function readNameOnce({ error }, _optional = {}) {
  try {
    return error.name;
  } catch {
    return undefined;
  }
}

/** The generated ID of the asset at `index` (0-based) in a script's manifest: `asset-1`, `asset-2`, ... O(1). */
export function assetId({ index }, _optional = {}) {
  return `asset-${index + 1}`;
}

/** The host of a URL for a progress line, never its user:password part, path or query. O(url length). */
export function hostLabel({ url }, _optional = {}) {
  try {
    return new URL(url).host || "(no host)";
  } catch {
    return "(invalid url)";
  }
}
