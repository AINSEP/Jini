import fs from "node:fs";
import { pathToFileURL } from "node:url";

// Shared CLI plumbing for the web-clone scripts (asset-harvest, audit-clone,
// compare-recon, dna-scaffold, init-clone). Each script exports its logic and
// a `main({ argv }, deps)` that returns an exit code; this module is the thin
// composition edge that (a) only runs `main` when the file is the process's
// entry script, so importing a script has no side effects, and (b) parses
// flags from a declarative table so every script keeps its exact historical
// argument semantics without a long if/else chain.

const DEFAULT_ENTRY_DEPS = {
  argv: process.argv,
  realpath: (file) => fs.realpathSync(file),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

/**
 * file URL of the script node was asked to run. Node resolves symlinks for
 * the main module's `import.meta.url`, so the comparison uses the realpath;
 * a path that cannot be resolved (e.g. typed without its extension) is
 * compared as given.
 */
function entryUrl(file, realpath) {
  let resolved = file;
  try {
    resolved = realpath(file);
  } catch {
    // keep the path as given
  }
  return pathToFileURL(resolved).href;
}

/**
 * Runs `main({ argv: argv.slice(2) })` only when `moduleUrl` is the process entry
 * script, and records its return value as the process exit code. Uses
 * `process.exitCode` rather than `process.exit()` so piped stdout is
 * flushed; every script closes its own handles (browsers) before returning.
 *
 * @returns {Promise<boolean>} whether `main` ran
 */
export async function runIfMain({ moduleUrl, main }, deps = {}) {
  const { argv, realpath, setExitCode } = { ...DEFAULT_ENTRY_DEPS, ...deps };
  const isEntry = Boolean(argv[1]) && entryUrl(argv[1], realpath) === moduleUrl;
  if (isEntry) setExitCode(await main({ argv: argv.slice(2) }));
  return isEntry;
}

/** Flag reader: the next argv value, or `fallback` when it is missing/empty. */
export const text = (fallback = "") => (raw) => raw || fallback;

/** Flag reader: comma-separated list, trimmed, empties dropped. */
export const list = () => (raw) => (raw || "").split(",").map((s) => s.trim()).filter(Boolean);

/** Boolean switch: sets `key` to `true` without consuming a value. */
export const flag = (key) => ({ key, read: null });

/** Unknown-argument policy shared by the strict scripts. */
export function rejectUnknown(arg) {
  throw new Error(`Unexpected argument: ${arg}`);
}

/**
 * Table-driven argv parser over `argv`. `flags` maps an exact argument to either a
 * switch (`flag(key)`) or `{ key, read(raw, out) }`, where `raw` is the next
 * argv entry (consumed even when it is missing or looks like a flag — the
 * historical `argv[++i]` behaviour). Anything else goes to
 * `onOther(arg, out)`.
 *
 * @complexity O(n) in argv length
 */
export function parseCliArgs({ argv, defaults, flags, onOther }) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!Object.hasOwn(flags, arg)) {
      onOther(arg, out);
      continue;
    }
    const spec = flags[arg];
    if (spec.read) {
      i += 1;
      out[spec.key] = spec.read(argv[i], out);
    } else {
      out[spec.key] = true;
    }
  }
  return out;
}
