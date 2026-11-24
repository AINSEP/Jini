import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SaveCaptureFiles } from "./web-screenshot.js";

/**
 * @file Where `web_screenshot_page` keeps its captures: `<siteDir>/.captures/<UTC date>/<name>.jpg`
 * (names from `captureRelativePaths`). Saved so a report can cite the exact picture later, e.g. the
 * source-vs-theme rounds of the host theme skill's "match a reference site" loop (2026-10-08); before this the
 * images existed only inside the chat turn.
 *
 * A dot-folder of its own rather than `ops/` (the site's runtime state: logs, journal, daemon file):
 * these are agent artifacts a person opens. Neither site backup (each scope walks only its own
 * subtree) nor publish/export reads it. No retention: captures are a few hundred KB each and are the
 * owner's to delete.
 */

export const CAPTURES_DIR_NAME = ".captures";

/** The captures folder of a site folder. */
export function captureRootFor({ siteDir }: { siteDir: string }): string {
  return path.join(siteDir, CAPTURES_DIR_NAME);
}

/**
 * Writes each file under `rootDir`, creating folders as needed, and resolves to the absolute paths.
 * Never overwrites (`wx`): a name collision is an `EEXIST` rejection, not a silently replaced capture.
 * @throws Error when a `relPath` would land outside `rootDir` (checked for all files before any write).
 * @complexity O(total bytes).
 */
export function createCaptureFileWriter({ rootDir }: { rootDir: string }): SaveCaptureFiles {
  const root = path.resolve(rootDir);
  return async ({ files }) => {
    const targets = files.map(({ relPath, bytes }) => {
      const target = path.resolve(root, relPath);
      if (path.isAbsolute(relPath) || !target.startsWith(`${root}${path.sep}`)) throw new Error(`capture path '${relPath}' escapes the captures folder`);
      return { target, bytes };
    });
    const written: string[] = [];
    for (const { target, bytes } of targets) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
      written.push(target);
    }
    return written;
  };
}
