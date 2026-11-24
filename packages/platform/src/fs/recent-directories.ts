import type { DurableJsonFile } from "./durable-json.js";
import type { QuarantineNotice } from "@jini-ai/core/contracts/site/fs-durable-json";

/**
 * Read the persisted state, treating any unreadable or malformed file as "no state yet".
 *
 * Deliberately forgiving: this file holds a convenience list, and refusing to launch because a
 * cache got truncated would trade a real failure for a cosmetic one. Unlike
 * durable user records, nothing here is salvaged out of a damaged file: every dir this list holds is
 * either already a tracked project or one folder-pick away, so recovering the cache would buy back
 * the ordering of a menu, not anything the operator made.
 *
 * @complexity O(n) in file size.
 */
export function readRecentDirectories({ file, field }: { file: Pick<DurableJsonFile, "read">; field: string }, { isEligible }: { isEligible?: (required: { directory: string }) => boolean } = {}): string[] {
  const { directories } = readRecentDirectoriesState({ file, field });
  return isEligible ? directories.filter((directory) => isEligible({ directory })) : directories;
}

/**
 * {@link readRecentDirectories} plus the one fact a WRITER also needs: whether the file it is about to
 * replace is damaged, and therefore must be moved aside rather than written over.
 *
 * @complexity O(n) in file size.
 */
function readRecentDirectoriesState({ file, field }: { file: Pick<DurableJsonFile, "read">; field: string }, _options: Record<string, never> = {}): { directories: string[]; damaged: boolean } {
  const read = file.read({});
  if (read.state === "missing") return { directories: [], damaged: false };
  const recent = (read.state === "ok" ? read.value : null) as Record<string, unknown> | null;
  if (!Array.isArray(recent?.[field])) return { directories: [], damaged: true };
  return { directories: recent[field].filter((entry): entry is string => typeof entry === "string"), damaged: false };
}

/**
 * Move `directory` to the front of the MRU list, de-duplicated and capped.
 *
 * Runs inside the cross-process lock for this file, because several instances can be opening sites
 * at once (the owner runs them on purpose) and two unlocked read-modify-writes lose whichever list
 * was read before the other was written. One list shared by every window is the point of it: "Open
 * Recent" should show what the operator opened, in whichever window they opened it.
 *
 * A damaged file is moved aside first, and the list starts over from this one dir — the policy that
 * fits a cache, and deliberately NOT durable user records, which recover what they can because their
 * file is the operator's own work. If it cannot be moved aside, nothing is written over it and the
 * dir is simply not remembered: this runs after a site has already been created or opened, and
 * failing that whole operation over an unwritable cache would be the cosmetic failure taking down
 * the real one.
 *
 * @returns the new list, most-recent first — what was persisted, or what would have been.
 * @complexity O(n) in the MRU length, plus the lock wait.
 */
export function rememberRecentDirectory({ file, field, directory, maxEntries, notice }: { file: Pick<DurableJsonFile, "read" | "write" | "quarantine" | "withLock">; field: string; directory: string; maxEntries: number; notice: QuarantineNotice }, _optional: Record<string, never> = {}): string[] {
  return file.withLock({ critical: () => {
    const previous = readRecentDirectoriesState({ file, field });
    const directories = [directory, ...previous.directories.filter((entry) => entry !== directory)].slice(0, maxEntries);
    if (previous.damaged && !file.quarantine({ notice })) return directories;
    /**
     * Replace the persisted state, atomically — a crash partway through leaves the previous file whole
     * rather than a torn one that the next launch would read as an empty list and then persist as that
     * (`durable-json.ts` for the full shape of that bug).
     *
     * A whole-value replace, so it takes no lock of its own; a caller that first READS this file holds
     * the lock across both halves — see {@link rememberRecentDirectory}, the only one there is.
     * @complexity O(n) in the MRU length.
     */
    file.write({ value: { [field]: directories } });
    return directories;
  } });
}
