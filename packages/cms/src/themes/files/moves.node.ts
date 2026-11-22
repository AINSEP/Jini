import { constants as fsConstants, copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { ThemeFileWritePorts } from "./atomic-write.node.js";

export interface ThemeFileMovePorts {
  readonly resolvePath: ThemeFileWritePorts["resolvePath"];
  readonly statPath: ThemeFileWritePorts["statPath"];
  readonly pathError: (required: { reason: "missing" | "not-regular-file" | "already-exists"; relativePath: string }) => Error;
}


/**
 * Shared containment + preflight for {@link copyThemeFile}/{@link renameThemeFile}: resolves both
 * the source and destination through `ports.resolvePath` (so a destination built from
 * operator input — a rename's new filename — is validated exactly as strictly as a write target),
 * confirms the source is a regular file, and refuses to clobber an existing destination.
 *
 * Deliberately does NOT decode either path through `readFileSync(…, "utf8")` /
 * `writeFileSync(…, "utf8")` the way {@link readThemeFile}/{@link writeThemeFile} do: a binary asset
 * (a font, an image) round-tripped through UTF-8 would come back byte-corrupted, and copy/rename
 * must work on every file in a theme's folder, not only the text-editable ones. For the same reason
 * there is no {@link MAX_THEME_FILE_BYTES} ceiling here, as in {@link resetThemeFileToOriginal}: that
 * limit bounds text a caller reads or writes, and copy/rename carry no text.
 */
function resolveCopyOrRenameTargets(
  required: { themeDir: string; themesRoot: string; sourcePath: string; destPath: string; ports: ThemeFileMovePorts }
): { source: string; dest: string } {
  const { themeDir, themesRoot, sourcePath, destPath, ports } = required;
  const source = ports.resolvePath({ themeDir, themesRoot, relativePath: sourcePath });
  // The stat port, NEVER a bare statSync — it translates circular-symlink ELOOP errors:
  // the resolver does not resolve a `source` that is ITSELF a self-referential symlink, so
  // this is the first call that can observe the cycle. Still follows a symlink pointing at a real
  // file inside the theme — `copyFileSync`/`renameSync` below already read/move through such a link
  // the same way `open()` does, so this check must match that, not refuse it.
  const sourceStat = ports.statPath({ target: source, relativePath: sourcePath });
  if (!sourceStat) throw ports.pathError({ reason: "missing", relativePath: sourcePath });
  if (!sourceStat.isFile()) throw ports.pathError({ reason: "not-regular-file", relativePath: sourcePath });

  const dest = ports.resolvePath({ themeDir, themesRoot, relativePath: destPath });
  if (existsSync(dest)) {
    throw ports.pathError({ reason: "already-exists", relativePath: destPath });
  }

  return { source, dest };
}

/**
 * Duplicate one file inside a theme's folder to a new path also inside it, byte-for-byte.
 *
 * @param optional.copyFile - The exclusive copy primitive; defaults to `node:fs` `copyFileSync`.
 *   A seam so the lost-race (`EEXIST`) mapping below is testable without a real concurrent copy.
 * @returns The absolute destination path written.
 * @throws {Error} On containment failure for either path, a missing/non-file source, or a
 * destination that already exists. There is no size limit.
 * @complexity O(s) in the file size.
 * @overallScore 100/100
 */
export function copyThemeFile(
  required: { themeDir: string; themesRoot: string; sourcePath: string; destPath: string; ports: ThemeFileMovePorts },
  optional: { copyFile?: typeof copyFileSync } = {}
): string {
  const { copyFile = copyFileSync } = optional;
  const { source, dest } = resolveCopyOrRenameTargets(required);
  mkdirSync(dirname(dest), { recursive: true });
  try {
    // `COPYFILE_EXCL` closes the TOCTOU window `resolveCopyOrRenameTargets`' own `existsSync(dest)`
    // check leaves open: two concurrent copy requests both landing on the same auto-suffixed name
    // (e.g. two rapid clicks generating `about-1.html` from the same source) would otherwise both
    // pass that pre-check and race to overwrite one another. `copyFileSync` has an atomic
    // exclusive-write mode for exactly this; `renameSync` (below) does not, so the identical race is
    // a known, narrower, accepted gap there.
    copyFile(source, dest, fsConstants.COPYFILE_EXCL);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw required.ports.pathError({ reason: "already-exists", relativePath: required.destPath });
    }
    throw err;
  }
  return dest;
}

/**
 * Suffix a caller-desired relative path to avoid colliding with anything already in `existingPaths`,
 * following the same `name`, `name-1`, `name-2` … shape used for theme ids — but split around
 * the extension, since a theme id (`basic`) is a bare folder name with no extension to preserve,
 * while a file path (`pages/about.html`) needs `about-1.html`, not `about.html-1`. That shape
 * difference is why this is its own small function: the collision LOOP is identical, the thing
 * being suffixed is not.
 *
 * Shared by agent tools and HTTP routes so both use the exact same collision avoidance without
 * reversing the module dependency direction.
 *
 * @complexity O(n) in the number of existing collisions with the desired name.
 * @overallScore 100/100
 */
export function nextAvailableFileName(
  required: { desiredPath: string; existingPaths: ReadonlySet<string> },
  _optional: Record<string, never> = {}
): string {
  const { desiredPath, existingPaths } = required;
  const slash = desiredPath.lastIndexOf("/");
  const dot = desiredPath.lastIndexOf(".");
  // A dot has to fall AFTER the last slash to be the filename's own extension — otherwise it belongs
  // to a directory segment (not a real case in this theme layout, but cheap to get right).
  const hasExt = dot > slash;
  const base = hasExt ? desiredPath.slice(0, dot) : desiredPath;
  const ext = hasExt ? desiredPath.slice(dot) : "";

  if (!existingPaths.has(desiredPath)) return desiredPath;
  let suffix = 1;
  let candidate = `${base}-${suffix}${ext}`;
  while (existingPaths.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}${ext}`;
  }
  return candidate;
}

/**
 * Move (rename) one file within a theme's folder, byte-for-byte.
 *
 * @returns The absolute destination path.
 * @throws {Error} On containment failure for either path, a missing/non-file source, or a
 * destination that already exists. There is no size limit.
 * @complexity O(1) — same-filesystem rename, not a copy.
 * @overallScore 100/100
 */
export function renameThemeFile(
  required: { themeDir: string; themesRoot: string; sourcePath: string; destPath: string; ports: ThemeFileMovePorts },
  _optional: Record<string, never> = {}
): string {
  const { source, dest } = resolveCopyOrRenameTargets(required);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(source, dest);
  return dest;
}
