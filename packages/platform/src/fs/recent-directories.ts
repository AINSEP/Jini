import type { DurableJsonFile, QuarantineNotice } from "./durable-json.js";

/**
 * Deliberately forgiving: this file holds a convenience list, and refusing to launch because a
 * cache got truncated would trade a real failure for a cosmetic one. Unlike durable user records,
 * nothing here is salvaged out of a damaged file: recovering the cache would buy back
 * the ordering of a menu, not anything the operator made.
 */
function readRecent({ file, field }: { file: Pick<DurableJsonFile, "read">; field: string }): { directories: string[]; damaged: boolean } {
  const read = file.read({});
  if (read.state === "missing") return { directories: [], damaged: false };
  const recent = (read.state === "ok" ? read.value : null) as Record<string, unknown> | null;
  if (!Array.isArray(recent?.[field])) return { directories: [], damaged: true };
  return { directories: recent[field].filter((entry): entry is string => typeof entry === "string"), damaged: false };
}

export function readRecentDirectories({ file, field }: { file: Pick<DurableJsonFile, "read">; field: string }, { isEligible }: { isEligible?: (required: { directory: string }) => boolean } = {}): string[] {
  const { directories } = readRecent({ file, field });
  return isEligible ? directories.filter((directory) => isEligible({ directory })) : directories;
}

/**
 * Runs inside the cross-process lock for this file, because several instances can be opening sites
 * at once and two unlocked read-modify-writes lose whichever list was read before the other was written.
 *
 * A damaged file is moved aside first, and the list starts over from this one dir — the policy that
 * fits a cache, unlike durable user records, which recover what they can because the file is the
 * operator's own work. If it cannot be moved aside, nothing is written over it and the
 * dir is simply not remembered: this runs after a site has already been created or opened, and
 * failing that whole operation over an unwritable cache would be the cosmetic failure taking down
 * the real one.
 */
export function rememberRecentDirectory({ file, field, directory, maxEntries, notice }: { file: Pick<DurableJsonFile, "read" | "write" | "quarantine" | "withLock">; field: string; directory: string; maxEntries: number; notice: QuarantineNotice }, _optional: Record<string, never> = {}): string[] {
  return file.withLock({ critical: () => {
    const previous = readRecent({ file, field });
    const directories = [directory, ...previous.directories.filter((entry) => entry !== directory)].slice(0, maxEntries);
    if (previous.damaged && !file.quarantine({ notice })) return directories;
    file.write({ value: { [field]: directories } });
    return directories;
  } });
}
