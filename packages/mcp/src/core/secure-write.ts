/**
 * @module @jini-ai/mcp/core/secure-write
 * Shared atomic, owner-only-permission (0600) secret-file writer used by
 * every secret-bearing on-disk store in this package: the server config
 * store (env vars / `Authorization` headers), the OAuth dynamic-client-
 * registration cache (`clientSecret`), and the OAuth token store (bearer /
 * refresh tokens, confidential-client secrets). CR-006 / SEC-RB-002.
 *
 * The previous pattern in each of those stores wrote the temp file with
 * default permissions and either never restricted it (config, OAuth client
 * cache) or `chmod(0600)`'d it *after* the atomic rename and silently
 * continued when the chmod failed (tokens) — both leave a window where the
 * file exists world/group-readable, and the latter makes the "protection"
 * advisory rather than enforced. This writer instead:
 *
 *   1. Creates the temp file *exclusively* (`wx`) with mode 0600 supplied to
 *      the same `open()`/`writeFile()` call that creates it — POSIX applies
 *      the requested mode atomically at creation time, so there is no
 *      window where the file exists with a broader mode. This repo already
 *      relies on `writeFile`'s `mode` option alone for a secret file with no
 *      separate chmod step (see `packages/agent-runtime/src/prompt-file.ts`);
 *      this module follows that same precedent rather than inventing a new one.
 *   2. On POSIX platforms, verifies the on-disk mode actually landed as
 *      owner-only before renaming into place, and fails closed — removing
 *      the temp file and throwing — if it did not (e.g. an unusual umask or
 *      a filesystem that doesn't honor `mode`).
 *   3. Skips that verification on `win32`: Windows has no POSIX permission-
 *      bit model (`mode` there only toggles the read-only attribute), so
 *      there is nothing meaningful to enforce or fail closed on — matching
 *      this repo's only other cross-platform file-mode precedent, which
 *      also does not branch on Windows.
 *
 * Part of the MCP `core` kernel; not part of the package's public barrel —
 * imported directly by sibling `core/*.ts` files.
 */
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const SECRET_FILE_MODE = 0o600;

export interface WriteSecretFileOptions {
  /** Injectable for tests only; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
}

/**
 * Atomically write `contents` to `finalPath` via a same-directory temp file
 * created exclusively with mode 0600. On POSIX platforms, verifies no
 * group/other permission bit made it onto disk before renaming into place;
 * throws (after removing the temp file) if verification fails or the write
 * itself fails, so a caller never observes a partially-written or
 * insufficiently-restricted secret file.
 * @param finalPath Absolute path the secret file should end up at.
 * @param contents UTF-8 text to write.
 * @param options `platform` override for tests; defaults to `process.platform`.
 */
export async function writeSecretFileAtomic(
  finalPath: string,
  contents: string,
  options: WriteSecretFileOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  await mkdir(path.dirname(finalPath), { recursive: true });
  const tmp = `${finalPath}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, contents, { encoding: 'utf8', mode: SECRET_FILE_MODE, flag: 'wx' });
    if (platform !== 'win32') {
      const info = await stat(tmp);
      const bits = info.mode & 0o777;
      if ((bits & 0o077) !== 0) {
        throw new Error(
          `refusing to persist secret-bearing file with non-owner-only permissions ` +
            `(mode 0${bits.toString(8)}): ${finalPath}`,
        );
      }
    }
    await rename(tmp, finalPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
