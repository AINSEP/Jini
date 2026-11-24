import os from "node:os";
import path from "node:path";
import { redactText, type RedactionOptions } from "./redaction.js";

/** Path-name characters: a home followed by one of these is a sibling path (`/rootfs`), not the home. */
const NOT_PATH_CONTINUATION = "(?![A-Za-z0-9._-])";

/**
 * Credential and home-path redaction for local child, native and gate output before it is shown or stored.
 * Jini's username policy masks only `/Users/<u>`, `/home/<u>` and `\Users\<u>`; a home outside those
 * roots (root's `/root`, a service account's custom HOME) would otherwise pass through verbatim,
 * so the literal home directory is masked as `~` after the shared redactor runs.
 * @param required.text Untrusted text to redact.
 * @param optional.homeDir Home directory to mask; `os.homedir()` by default.
 * @param optional.platformPath Path flavour used to read the home's basename and root; the host's by
 *   default, injectable so a Windows home (`C:\Users\ada`, `C:\`) is exercised on any host.
 * @param optional.extraPatterns Host-owned credential shapes, forwarded to `redactText`.
 * @returns The redacted text; a filesystem-root home is left to the username policy alone,
 *   since masking it would erase every absolute path.
 * @complexity O(n) time and space for n text characters.
 */
export function redactLocalText(
  { text }: { text: string },
  { homeDir = os.homedir(), platformPath = path, extraPatterns }: {
    homeDir?: string; platformPath?: Pick<typeof path, "basename" | "parse">; extraPatterns?: RedactionOptions["extraPatterns"];
  } = {},
): string {
  const redacted = redactText({ text }, { username: platformPath.basename(homeDir), extraPatterns });
  let end = homeDir.length;
  while (end > 0 && (homeDir[end - 1] === "/" || homeDir[end - 1] === "\\")) end -= 1;
  const home = homeDir.slice(0, end);
  if (!home || platformPath.parse(homeDir).root === homeDir) return redacted;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return redacted.replace(new RegExp(`${escaped}${NOT_PATH_CONTINUATION}`, "g"), "~");
}
