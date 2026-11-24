/**
 * @file The "Move this app to your Applications folder?" prompt a packaged macOS copy shows once
 * when it is launched from anywhere else (a disk image, Downloads). Every rule lives here as a pure
 * function or an injected-deps flow; the host's Electron entry only supplies Electron's calls, its
 * own copy, the decline-file path and the durable JSON store.
 *
 * Why it matters: a copy run from its disk image cannot update itself (Squirrel cannot replace a
 * read-only bundle) and keeps the image busy so it cannot be ejected — see `isTransientAppPath` in
 * `@jini-ai/desktop-host` node-toolchain for the paths that stop an app from persisting.
 *
 * **Several copies at once.** A host may run several copies with no single-instance lock. The
 * prompt is not offered while another copy is open (the host counts them from its own instance
 * presence records): moving a bundle out of, say, Downloads would pull it from under a sibling
 * running from the same place, and two copies prompting at once would race to the same
 * `/Applications/<name>.app`. It comes back on a later launch that is alone.
 *
 * **Strings.** Every word the user sees — the app's name and each outcome message — is injected by
 * the host ({@link MovePromptMessages}, {@link MovePromptEnvironment.appName}), so a later locale
 * layer has one place to replace.
 *
 * No `electron` import and no filesystem access of its own: persistence and file reads are ports.
 * Architecture: `ADS-memory/reports/jini-port/extraction-plan.md`.
 */
import path from "node:path";

/** The outcome messages the flow shows; the host supplies its own wording. */
interface MovePromptMessages {
  /** A move that failed or was refused with no clash decision. A thrown reason is appended. */
  moveFailed: string;
  /** An older copy is running from Applications, so this copy keeps running. */
  olderCopyRunning: string;
  /** A newer copy is already in Applications and is opened instead. Must block until dismissed. */
  openingNewer: string;
}

/** {@link movePromptSkipReason}'s input: everything about this launch that decides whether to ask. */
interface MovePromptEnvironment {
  /** The app's display name, used in the "another copy is open" skip reason. */
  appName: string;
  platform: NodeJS.Platform;
  isPackaged: boolean;
  /** Electron's `process.mas`: a Mac App Store build, which the Store installs and must not move. */
  isMas: boolean;
  /** A headless self-test launch: nobody to answer. */
  selftest: boolean;
  /** Launched by a script to open named content, not by a person. */
  unattended: boolean;
  /** `app.isInApplicationsFolder()` — `/Applications` or `~/Applications`. */
  inApplications: boolean;
  /** Live copies of this app other than this one. */
  otherInstancesOpen: number;
  currentVersion: string;
  /** The version "Not Now" was last chosen on, or `null`. */
  declinedVersion: string | null;
}

/** One read of a durable JSON file; any non-`ok` state reads as "never declined". */
type DeclineFileRead = { state: "ok"; value: unknown } | { state: "missing" | "unreadable" };

/** The host's durable JSON file helper (atomic replace, corrupt-vs-missing distinguished). */
interface DeclinedVersionStore {
  readJsonFile: (required: { filePath: string }) => DeclineFileRead;
  /** Must replace atomically; failures propagate (an unwritable host data directory). */
  writeJsonFileAtomic: (required: { filePath: string; value: unknown }) => void;
}

/** Reads a text file; may throw when it is missing or unreadable. */
type ReadTextFile = (required: { filePath: string }) => string;

/**
 * Runs `work`; on any failure answers `fallback`. The host binds its own synchronous fallback idiom
 * (the shape of Core's `orFallbackSync`), so an unreadable bundle is observed the host's way.
 */
type OrFallbackSync = <Value>(required: { work: () => Value; fallback: Value; step: string }) => Value;

/**
 * @returns why this launch must NOT offer the move, or `null` when it should.
 *
 * "Not Now" silences it for that version only: an update is a natural moment to ask again, and a
 * copy still outside Applications after an update is exactly the copy that could not update itself.
 * @complexity O(1).
 */
function movePromptSkipReason(env: MovePromptEnvironment): string | null {
  const reasons: [boolean, string][] = [
    [!env.isPackaged, "not packaged (dev launch)"],
    [env.platform !== "darwin", "not macOS"],
    [env.isMas, "Mac App Store build"],
    [env.selftest, "self-test launch"],
    [env.unattended, "unattended site launch"],
    [env.inApplications, "already in Applications"],
    [env.otherInstancesOpen > 0, `another copy of ${env.appName} is open`],
    [env.declinedVersion === env.currentVersion, "declined for this version"],
  ];
  return reasons.find(([applies]) => applies)?.[1] ?? null;
}

/** @returns the version "Not Now" was chosen on; `null` if never, or the file is unusable.
 *  @complexity O(n) in file size. */
function readDeclinedVersion({ filePath, store }: { filePath: string; store: DeclinedVersionStore }, _options = {}): string | null {
  const read = store.readJsonFile({ filePath });
  if (read.state !== "ok") return null;
  const version = (read.value as { declinedVersion?: unknown } | null)?.declinedVersion;
  return typeof version === "string" ? version : null;
}

/** Records "Not Now" for `version`, replacing any earlier one. @complexity O(1). */
function recordDeclinedVersion({ filePath, version, store }: { filePath: string; version: string; store: DeclinedVersionStore }, _options = {}): void {
  store.writeJsonFileAtomic({ filePath, value: { declinedVersion: version } });
}

/** @returns the `.app` bundle holding `execPath` (`…/X.app/Contents/MacOS/X`), or `null`.
 *  @complexity O(n) in the path length. */
function bundlePathFromExecPath({ execPath }: { execPath: string }, _options = {}): string | null {
  return /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath)?.[1] ?? null;
}

/** Where `app.moveToApplicationsFolder()` puts the bundle: `/Applications/<its name>`. @complexity O(1). */
function applicationsTargetPath({ bundlePath }: { bundlePath: string }, _options = {}): string {
  return path.join("/Applications", path.basename(bundlePath));
}

/** @returns a bundle's `CFBundleShortVersionString` from its XML `Info.plist` (what electron-builder
 *  writes), or `null` when it cannot be read. @complexity O(n) in the plist's size. */
function readBundleVersion(
  { bundlePath, readTextFile, orFallbackSync }: { bundlePath: string; readTextFile: ReadTextFile; orFallbackSync: OrFallbackSync },
  _options = {},
): string | null {
  return orFallbackSync({ work: () => {
    const plist = readTextFile({ filePath: path.join(bundlePath, "Contents", "Info.plist") });
    return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1]?.trim() ?? null;
  }, fallback: null, step: "Read application bundle version" });
}

/** The dotted numeric part of a version (`0.2.0-beta.1` → `[0, 2, 0]`), or `null`. @complexity O(n). */
function numericParts({ version }: { version: string | null }, _options = {}): number[] | null {
  const core = /^(\d+(?:\.\d+)*)/.exec(version ?? "")?.[1];
  return core === undefined ? null : core.split(".").map(Number);
}

/**
 * Compares two dotted numeric versions, missing parts reading as 0. Pre-release tags are ignored.
 * @returns 1, 0 or -1; `null` when either is not a version.
 * @complexity O(n) in the number of parts.
 */
function compareVersions({ a, b }: { a: string | null; b: string | null }, _options = {}): number | null {
  const left = numericParts({ version: a });
  const right = numericParts({ version: b });
  if (left === null || right === null) return null;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** Electron's `conflictHandler` argument. */
type MoveConflictType = "exists" | "existsAndRunning";

/** {@link decideMoveConflict}'s answer. */
type MoveConflictDecision = "replace" | "open-existing" | "blocked-by-running-copy";

/**
 * What to do when `/Applications` already holds a copy of this app:
 *
 * - `"replace"` — an older, same, or unreadable copy that is not running. Electron moves it to the
 *   Trash (recoverable) and puts this one in its place.
 * - `"open-existing"` — the copy there is newer, or is running and at least as new: keep it and use
 *   it. Never downgrade the installed app.
 * - `"blocked-by-running-copy"` — an older (or unreadable) copy is running there. Replacing a running
 *   app pulls its bundle from under it, and Electron's own default would instead switch to that OLD
 *   copy and quit this newer one; neither is right, so this copy keeps running and says why.
 * @complexity O(1).
 */
function decideMoveConflict(input: { conflictType: MoveConflictType; existingVersion: string | null; currentVersion: string }): MoveConflictDecision {
  const order = compareVersions({ a: input.existingVersion, b: input.currentVersion });
  if (order === 1) return "open-existing";
  if (input.conflictType === "exists") return "replace";
  return order === 0 ? "open-existing" : "blocked-by-running-copy";
}

/** {@link runMoveToApplicationsPrompt}'s Electron seams and host copy. */
interface MovePromptDeps {
  currentVersion: string;
  /** {@link applicationsTargetPath} of this bundle. */
  targetPath: string;
  messages: MovePromptMessages;
  /** Shows the prompt (its question and buttons are the host's copy). */
  ask: () => Promise<"move" | "not-now">;
  /** `app.moveToApplicationsFolder({ conflictHandler })`. On success Electron relaunches from the new
   *  location and quits this process itself. */
  move: (required: { conflictHandler: (conflictType: MoveConflictType) => boolean }) => boolean;
  readExistingVersion: (required: { appPath: string }) => string | null;
  openExisting: (required: { appPath: string }) => void;
  quit: () => void;
  recordDeclined: () => void;
  showError: (required: { message: string }) => void;
  /** Must block until dismissed: {@link afterRefusedMove} quits right after it. */
  showInfo: (required: { message: string }) => void;
}

type MovePromptOutcome = "declined" | "moved" | "opened-existing" | "blocked-by-running-copy" | "failed";

/**
 * The prompt, start to finish. A failed move never throws — it is reported and this copy keeps
 * running; only `recordDeclined` failing (an unwritable host data directory) propagates.
 * @complexity O(1) plus the injected calls.
 */
async function runMoveToApplicationsPrompt(deps: MovePromptDeps): Promise<MovePromptOutcome> {
  if ((await deps.ask()) === "not-now") {
    deps.recordDeclined();
    return "declined";
  }
  // Electron re-enters this flow through `conflictHandler` in the middle of the relocation; the
  // decision it made there is what decides the outcome once `move` returns without moving.
  let decision: MoveConflictDecision | null = null;
  const conflictHandler = (conflictType: MoveConflictType): boolean => {
    decision = decideMoveConflict({ conflictType, existingVersion: deps.readExistingVersion({ appPath: deps.targetPath }), currentVersion: deps.currentVersion });
    // `true` = Electron's own default: replace a stopped copy, or switch to a running one.
    return decision === "replace" || (decision === "open-existing" && conflictType === "existsAndRunning");
  };
  let moved: boolean;
  try {
    moved = deps.move({ conflictHandler });
  } catch (error) {
    deps.showError({ message: `${deps.messages.moveFailed} ${(error as Error).message}` });
    return "failed";
  }
  return moved ? "moved" : afterRefusedMove({ deps, decision });
}

/** A move that did not happen: open the newer copy, explain the running older one, or report it.
 *  @complexity O(1). */
function afterRefusedMove({ deps, decision }: { deps: MovePromptDeps; decision: MoveConflictDecision | null }, _options = {}): MovePromptOutcome {
  if (decision === "open-existing") {
    deps.showInfo({ message: deps.messages.openingNewer });
    deps.openExisting({ appPath: deps.targetPath });
    deps.quit();
    return "opened-existing";
  }
  if (decision === "blocked-by-running-copy") {
    deps.showError({ message: deps.messages.olderCopyRunning });
    return "blocked-by-running-copy";
  }
  deps.showError({ message: deps.messages.moveFailed });
  return "failed";
}

export {
  applicationsTargetPath,
  bundlePathFromExecPath,
  compareVersions,
  decideMoveConflict,
  movePromptSkipReason,
  readBundleVersion,
  readDeclinedVersion,
  recordDeclinedVersion,
  runMoveToApplicationsPrompt,
};
export type {
  DeclineFileRead,
  DeclinedVersionStore,
  MoveConflictDecision,
  MoveConflictType,
  MovePromptDeps,
  MovePromptEnvironment,
  MovePromptMessages,
  MovePromptOutcome,
  OrFallbackSync,
  ReadTextFile,
};
