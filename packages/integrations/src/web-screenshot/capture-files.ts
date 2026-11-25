import { link, mkdir, rm, writeFile } from "node:fs/promises";
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
 * subtree) nor publish/export reads it. No automatic retention: captures are a few hundred KB each and
 * are the owner's to delete, through the preview + confirm cleanup in `capture-retention.ts`.
 */

export const CAPTURES_DIR_NAME = ".captures";

/** The captures folder of a site folder. */
export function captureRootFor({ siteDir }: { siteDir: string }): string {
  return path.join(siteDir, CAPTURES_DIR_NAME);
}

/**
 * The host's exclusion for one captures folder. The writer and the manual cleanup in
 * `capture-retention.ts` both hold it keyed by the resolved root, so a cleanup never sees a capture
 * halfway through publication and a writer never publishes into a name the cleanup is removing.
 */
export interface CaptureRootLock {
  withLock<T>(required: { key: string; run: () => Promise<T> }, optional?: Record<string, never>): Promise<T>;
}

/** The suffix a capture carries while it is being written; cleanup never touches such a file. */
export const CAPTURE_PARTIAL_SUFFIX = ".partial";

/**
 * Writes each file under `rootDir`, creating folders as needed, and resolves to the absolute paths.
 * Each capture is staged as `<name>.partial` (opened `wx`) and only then linked to its final name, all
 * under `lock.withLock({ key: rootDir })`, so a reader never mistakes half a picture for a finished one.
 * Never overwrites: publication uses `link`, which fails with `EEXIST` if the final name exists, so a
 * name collision is a rejection, not a silently replaced capture. The staged file is removed either way.
 * @throws Error when a `relPath` would land outside `rootDir` (checked for all files before any write).
 * @complexity O(total bytes).
 */
export function createCaptureFileWriter({ rootDir, lock }: { rootDir: string; lock: CaptureRootLock }, _optional: Record<string, never> = {}): SaveCaptureFiles {
  const root = path.resolve(rootDir);
  return async ({ files }) => {
    const targets = files.map(({ relPath, bytes }) => {
      const target = path.resolve(root, relPath);
      if (path.isAbsolute(relPath) || !target.startsWith(`${root}${path.sep}`)) throw new Error(`capture path '${relPath}' escapes the captures folder`);
      return { target, bytes };
    });
    return lock.withLock({ key: root, run: async () => {
      const written: string[] = [];
      for (const { target, bytes } of targets) {
        await publishCapture({ target, bytes });
        written.push(target);
      }
      return written;
    } }, {});
  };
}

/** Stages one capture as `.partial`, then hard-links it to the final name (no overwrite) and drops the stage. */
async function publishCapture({ target, bytes }: { target: string; bytes: Uint8Array }): Promise<void> {
  const staged = `${target}${CAPTURE_PARTIAL_SUFFIX}`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(staged, bytes, { flag: "wx" });
  try {
    // `link`, not `rename`: rename silently replaces an existing file; link refuses with EEXIST.
    await link(staged, target);
  } finally {
    await rm(staged, { force: true });
  }
}
