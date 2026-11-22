// Lets a web-clone script be both a CLI (`node scripts/x.mjs ...`) and an
// importable module whose functions can be exercised without side effects:
// `main` only runs when the module is the process entry point.

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { format } from "node:util";
import { errorClassLabel } from "./diagnostic-labels.mjs";

/**
 * An argument or setup error whose message is fixed words the script wrote (what is wrong and what
 * to do), so it is printed as is. Any other error prints its class only: its text can quote a page,
 * a file or a credential.
 */
export class CliUsageError extends Error {}

/**
 * Bind CLI output to streams: help/progress use stdout, warnings/errors use stderr.
 * Writers preserve console-style formatting and append one newline. O(output length).
 */
export function createCliStreams({ stdout = process.stdout, stderr = process.stderr }, _options = {}) {
  return {
    log: (...values) => stdout.write(`${format(...values)}\n`),
    warn: (...values) => stderr.write(`${format(...values)}\n`),
    error: (...values) => stderr.write(`${format(...values)}\n`),
  };
}

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
 * Run `main({ argv: argv.slice(2) }, io)` when `moduleUrl` is the entry module.
 * Unexpected failures use fixed copy/class labels and exit 1 without exposing a stack.
 * @returns {Promise<boolean>} whether main ran.
 */
export async function runIfMain({ moduleUrl, main }, { argv = process.argv, realpath, onExit = exitOnFailure, stdout = process.stdout, stderr = process.stderr } = {}) {
  if (!isMainModule({ moduleUrl, argv1: argv[1] }, realpath ? { realpath } : {})) return false;
  const io = createCliStreams({ stdout, stderr });
  const code = await runCli({ label: "web-clone", body: () => main({ argv: argv.slice(2) }, io), report: io.error });
  onExit({ code });
  return true;
}

/**
 * Run a CLI body, reporting a thrown error as `<label> failed: <usage text or error class>`
 * and mapping it to exit code 1 (the scripts' historical contract).
 * @returns {Promise<number>} the body's exit code, or 1 on error.
 */
export async function runCli({ label, body, report }, _optional = {}) {
  let code = 1;
  try {
    code = await body();
  } catch (error) {
    report(`${label} failed: ${error instanceof CliUsageError ? error.message : errorClassLabel({ error })}`);
  }
  return code;
}
