// Lets a web-clone script be both a CLI (`node scripts/x.mjs ...`) and an
// importable module whose functions can be exercised without side effects:
// `main` only runs when the module is the process entry point.

import fs from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * True when `moduleUrl` is the file Node was asked to run (`argv1`).
 * Node resolves the entry module's real path for `import.meta.url`, so the
 * comparison goes through `realpath` too — a script staged behind a symlink
 * must still run when invoked through the link.
 */
export function isMainModule({ moduleUrl, argv1 }, { realpath = fs.realpathSync } = {}) {
  if (!argv1) return false;
  let resolved = argv1;
  try {
    resolved = realpath(argv1);
  } catch {
    // Unresolvable path: compare it as given.
  }
  return pathToFileURL(resolved).href === moduleUrl;
}

/**
 * Process-exit policy for a finished `main`: a non-zero code exits hard
 * (an error path may leave a launched browser holding the event loop open,
 * exactly as the original top-level `process.exit(1)` assumed); success
 * lets the process drain naturally so piped stdout is never truncated.
 */
export function exitOnFailure({ code }, { proc = process } = {}) {
  if (code) proc.exit(code);
}

/**
 * Run `main({ argv: argv.slice(2) })` when `moduleUrl` is the entry module.
 * @returns {Promise<boolean>} whether main ran.
 */
export async function runIfMain({ moduleUrl, main }, { argv = process.argv, realpath, onExit = exitOnFailure } = {}) {
  if (!isMainModule({ moduleUrl, argv1: argv[1] }, realpath ? { realpath } : {})) return false;
  onExit({ code: await main({ argv: argv.slice(2) }) });
  return true;
}

/**
 * Run a CLI body, reporting a thrown error as `<label> failed: <message>`
 * and mapping it to exit code 1 (the scripts' historical contract).
 * @returns {Promise<number>} the body's exit code, or 1 on error.
 */
export async function runCli({ label, body, report }) {
  let code = 1;
  try {
    code = await body();
  } catch (error) {
    report(`${label} failed: ${error.message}`);
  }
  return code;
}
