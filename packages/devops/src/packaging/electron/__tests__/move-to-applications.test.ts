/**
 * @file Behavioural proof for `move-to-applications.ts`: when the "Move to Applications" prompt is
 * offered at all, how "Not Now" is remembered through the injected store, what a name clash in
 * /Applications does, and the whole prompt flow with Electron's calls injected.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";

import {
  applicationsTargetPath,
  bundlePathFromExecPath,
  compareVersions,
  decideMoveConflict,
  movePromptSkipReason,
  readBundleVersion,
  readDeclinedVersion,
  recordDeclinedVersion,
  runMoveToApplicationsPrompt,
} from "../move-to-applications.js";
import type { DeclineFileRead, DeclinedVersionStore, MovePromptDeps, MovePromptEnvironment, MovePromptMessages, ReadTextFile } from "../move-to-applications.js";

const MESSAGES: MovePromptMessages = {
  moveFailed: "Example could not be moved.",
  olderCopyRunning: "An older Example is open from Applications.",
  openingNewer: "A newer Example is already in Applications.",
};

const OFFER: MovePromptEnvironment = {
  appName: "Example",
  platform: "darwin",
  isPackaged: true,
  isMas: false,
  selftest: false,
  unattended: false,
  inApplications: false,
  otherInstancesOpen: 0,
  currentVersion: "0.1.8",
  declinedVersion: null,
};

/** An in-memory durable JSON store keeping raw text, so corrupt content reads as `unreadable`. */
function memoryStore(): { store: DeclinedVersionStore; files: Map<string, string> } {
  const files = new Map<string, string>();
  const store: DeclinedVersionStore = {
    readJsonFile: ({ filePath }): DeclineFileRead => {
      const text = files.get(filePath);
      if (text === undefined) return { state: "missing" };
      try {
        return { state: "ok", value: JSON.parse(text) as unknown };
      } catch {
        return { state: "unreadable" };
      }
    },
    writeJsonFileAtomic: ({ filePath, value }) => {
      files.set(filePath, JSON.stringify(value));
    },
  };
  return { store, files };
}

/** A text reader over a map; a missing path throws like `readFileSync`. */
function memoryReader(files: Map<string, string>): ReadTextFile {
  return ({ filePath }) => {
    const text = files.get(filePath);
    if (text === undefined) throw new Error(`ENOENT: no such file, open '${filePath}'`);
    return text;
  };
}

// --- When the prompt is offered ------------------------------------------------------------------

test("a packaged macOS copy outside Applications, alone, never declined, is offered the move", () => {
  assert.equal(movePromptSkipReason(OFFER), null);
});

test("every reason not to offer the move is its own named skip", () => {
  assert.equal(movePromptSkipReason({ ...OFFER, isPackaged: false }), "not packaged (dev launch)");
  assert.equal(movePromptSkipReason({ ...OFFER, platform: "win32" }), "not macOS");
  assert.equal(movePromptSkipReason({ ...OFFER, platform: "linux" }), "not macOS");
  assert.equal(movePromptSkipReason({ ...OFFER, isMas: true }), "Mac App Store build");
  assert.equal(movePromptSkipReason({ ...OFFER, selftest: true }), "self-test launch");
  assert.equal(movePromptSkipReason({ ...OFFER, unattended: true }), "unattended site launch");
  assert.equal(movePromptSkipReason({ ...OFFER, inApplications: true }), "already in Applications");
  assert.equal(movePromptSkipReason({ ...OFFER, otherInstancesOpen: 1 }), "another copy of Example is open");
  assert.equal(movePromptSkipReason({ ...OFFER, declinedVersion: "0.1.8" }), "declined for this version");
});

test("Not Now for an older version does not silence the prompt after an update", () => {
  assert.equal(movePromptSkipReason({ ...OFFER, declinedVersion: "0.1.7" }), null);
});

// --- Not Now, remembered per version -------------------------------------------------------------

test("Not Now is remembered per version through the injected store, and read back", () => {
  const { store, files } = memoryStore();
  const filePath = "/data/move-decline.json";
  assert.equal(readDeclinedVersion({ filePath, store }), null);
  recordDeclinedVersion({ filePath, version: "0.1.8", store });
  assert.equal(readDeclinedVersion({ filePath, store }), "0.1.8");
  recordDeclinedVersion({ filePath, version: "0.1.9", store });
  assert.equal(readDeclinedVersion({ filePath, store }), "0.1.9");
  assert.deepEqual(JSON.parse(files.get(filePath) ?? "null"), { declinedVersion: "0.1.9" });
});

test("a corrupt or wrong-shaped decline file reads as never declined", () => {
  const { store, files } = memoryStore();
  const filePath = "/data/move-decline.json";
  files.set(filePath, "{not json");
  assert.equal(readDeclinedVersion({ filePath, store }), null);
  files.set(filePath, JSON.stringify({ declinedVersion: 7 }));
  assert.equal(readDeclinedVersion({ filePath, store }), null);
  files.set(filePath, "null");
  assert.equal(readDeclinedVersion({ filePath, store }), null);
});

test("a failing store write propagates (an unwritable data directory is the host's to report)", () => {
  const store: DeclinedVersionStore = {
    readJsonFile: () => ({ state: "missing" }),
    writeJsonFileAtomic: () => {
      throw new Error("EACCES");
    },
  };
  assert.throws(() => recordDeclinedVersion({ filePath: "/data/x.json", version: "0.1.8", store }), /EACCES/);
});

// --- Paths and versions --------------------------------------------------------------------------

test("bundlePathFromExecPath finds the .app from its executable, null outside a bundle", () => {
  assert.equal(bundlePathFromExecPath({ execPath: "/Volumes/Example 0.1.8/Example.app/Contents/MacOS/Example" }), "/Volumes/Example 0.1.8/Example.app");
  assert.equal(bundlePathFromExecPath({ execPath: "/usr/local/bin/electron" }), null);
});

test("applicationsTargetPath is /Applications/<bundle name>, where Electron moves it", () => {
  assert.equal(applicationsTargetPath({ bundlePath: "/Users/me/Downloads/Example.app" }), "/Applications/Example.app");
});

test("compareVersions orders numeric dotted versions and returns null for anything else", () => {
  assert.equal(compareVersions({ a: "0.1.8", b: "0.1.7" }), 1);
  assert.equal(compareVersions({ a: "0.1.7", b: "0.1.8" }), -1);
  assert.equal(compareVersions({ a: "0.1.10", b: "0.1.9" }), 1);
  assert.equal(compareVersions({ a: "1.0", b: "1.0.0" }), 0);
  assert.equal(compareVersions({ a: "1.0.0", b: "1.0" }), 0, "the missing part reads as 0 on either side");
  assert.equal(compareVersions({ a: "1.0.1", b: "1.0" }), 1);
  assert.equal(compareVersions({ a: "0.2.0-beta.1", b: "0.1.9" }), 1);
  assert.equal(compareVersions({ a: "garbage", b: "0.1.9" }), null);
  assert.equal(compareVersions({ a: null, b: "0.1.9" }), null);
});

test("readBundleVersion reads CFBundleShortVersionString from an XML Info.plist, null when it cannot", () => {
  const files = new Map<string, string>();
  const readTextFile = memoryReader(files);
  const bundle = "/tmp/fixture/Example.app";
  const plist = path.join(bundle, "Contents", "Info.plist");
  assert.equal(readBundleVersion({ bundlePath: bundle, readTextFile, orFallbackSync }), null);
  files.set(plist, '<?xml version="1.0"?><plist><dict>\n<key>CFBundleName</key>\n<string>Example</string>\n<key>CFBundleShortVersionString</key>\n\t<string>0.1.7</string>\n</dict></plist>');
  assert.equal(readBundleVersion({ bundlePath: bundle, readTextFile, orFallbackSync }), "0.1.7");
  // A readable plist that simply has no version key (a hand-built or foreign bundle) is unknown too.
  files.set(plist, '<?xml version="1.0"?><plist><dict>\n<key>CFBundleName</key>\n<string>Example</string>\n</dict></plist>');
  assert.equal(readBundleVersion({ bundlePath: bundle, readTextFile, orFallbackSync }), null);
});

test("readBundleVersion answers an unreadable bundle through the host's injected orFallbackSync", () => {
  const seen: Array<{ step: string; fallback: unknown }> = [];
  const recording: typeof orFallbackSync = (required) => { seen.push({ step: required.step, fallback: required.fallback }); return orFallbackSync(required); };
  assert.equal(readBundleVersion({ bundlePath: "/tmp/fixture/Missing.app", readTextFile: memoryReader(new Map()), orFallbackSync: recording }), null);
  assert.deepEqual(seen, [{ step: "Read application bundle version", fallback: null }]);
});

// --- A copy already in /Applications -------------------------------------------------------------

test("an older, same, or unreadable copy in Applications that is not running is replaced (Electron moves it to the Trash)", () => {
  assert.equal(decideMoveConflict({ conflictType: "exists", existingVersion: "0.1.7", currentVersion: "0.1.8" }), "replace");
  assert.equal(decideMoveConflict({ conflictType: "exists", existingVersion: "0.1.8", currentVersion: "0.1.8" }), "replace");
  assert.equal(decideMoveConflict({ conflictType: "exists", existingVersion: null, currentVersion: "0.1.8" }), "replace");
});

test("a newer copy in Applications is kept and opened instead, running or not", () => {
  assert.equal(decideMoveConflict({ conflictType: "exists", existingVersion: "0.1.9", currentVersion: "0.1.8" }), "open-existing");
  assert.equal(decideMoveConflict({ conflictType: "existsAndRunning", existingVersion: "0.1.9", currentVersion: "0.1.8" }), "open-existing");
  assert.equal(decideMoveConflict({ conflictType: "existsAndRunning", existingVersion: "0.1.8", currentVersion: "0.1.8" }), "open-existing");
});

test("an older or unreadable copy that is RUNNING is never replaced under it: this copy keeps running", () => {
  assert.equal(decideMoveConflict({ conflictType: "existsAndRunning", existingVersion: "0.1.7", currentVersion: "0.1.8" }), "blocked-by-running-copy");
  assert.equal(decideMoveConflict({ conflictType: "existsAndRunning", existingVersion: null, currentVersion: "0.1.8" }), "blocked-by-running-copy");
});

// --- The whole flow ------------------------------------------------------------------------------

interface Recorded {
  calls: string[];
  errors: string[];
  infos: string[];
}

function fakeDeps(overrides: Partial<MovePromptDeps> = {}): { deps: MovePromptDeps; seen: Recorded } {
  const seen: Recorded = { calls: [], errors: [], infos: [] };
  const deps: MovePromptDeps = {
    currentVersion: "0.1.8",
    targetPath: "/Applications/Example.app",
    messages: MESSAGES,
    ask: async () => "move",
    move: () => {
      seen.calls.push("move");
      return true;
    },
    readExistingVersion: () => null,
    openExisting: ({ appPath }) => {
      seen.calls.push(`open ${appPath}`);
    },
    quit: () => {
      seen.calls.push("quit");
    },
    recordDeclined: () => {
      seen.calls.push("declined");
    },
    showError: ({ message }) => {
      seen.errors.push(message);
    },
    showInfo: ({ message }) => {
      seen.infos.push(message);
    },
    ...overrides,
  };
  return { deps, seen };
}

test("Not Now records the decline and moves nothing", async () => {
  const { deps, seen } = fakeDeps({ ask: async () => "not-now" });
  assert.equal(await runMoveToApplicationsPrompt(deps), "declined");
  assert.deepEqual(seen.calls, ["declined"]);
});

test("Move with no clash moves (Electron relaunches from Applications itself)", async () => {
  const { deps, seen } = fakeDeps();
  assert.equal(await runMoveToApplicationsPrompt(deps), "moved");
  assert.deepEqual(seen.calls, ["move"]);
  assert.deepEqual(seen.errors, []);
});

test("Move hands Electron a conflict handler that answers from decideMoveConflict", async () => {
  const answers: boolean[] = [];
  const { deps } = fakeDeps({
    readExistingVersion: () => "0.1.7",
    move: ({ conflictHandler }) => {
      answers.push(conflictHandler("exists"));
      return true;
    },
  });
  await runMoveToApplicationsPrompt(deps);
  assert.deepEqual(answers, [true]);
});

test("Move onto a newer, not-running copy opens that copy and quits this one", async () => {
  const { deps, seen } = fakeDeps({
    readExistingVersion: () => "0.1.9",
    move: ({ conflictHandler }) => conflictHandler("exists"),
  });
  assert.equal(await runMoveToApplicationsPrompt(deps), "opened-existing");
  assert.deepEqual(seen.calls, ["open /Applications/Example.app", "quit"]);
  assert.equal(seen.infos.length, 1);
  assert.deepEqual(seen.infos, [MESSAGES.openingNewer]);
});

test("Move onto a newer, running copy lets Electron focus it and quit this one (its own default)", async () => {
  const answers: boolean[] = [];
  const { deps, seen } = fakeDeps({
    readExistingVersion: () => "0.1.9",
    move: ({ conflictHandler }) => {
      answers.push(conflictHandler("existsAndRunning"));
      return true;
    },
  });
  await runMoveToApplicationsPrompt(deps);
  assert.deepEqual(answers, [true]);
  assert.deepEqual(seen.calls, []);
});

test("Move onto an older copy that is running explains why and keeps this copy running", async () => {
  const { deps, seen } = fakeDeps({
    readExistingVersion: () => "0.1.7",
    move: ({ conflictHandler }) => conflictHandler("existsAndRunning"),
  });
  assert.equal(await runMoveToApplicationsPrompt(deps), "blocked-by-running-copy");
  assert.deepEqual(seen.calls, []);
  assert.deepEqual(seen.errors, [MESSAGES.olderCopyRunning]);
});

test("a move that throws shows the plain reason and keeps running", async () => {
  const { deps, seen } = fakeDeps({
    move: () => {
      throw new Error("Permission denied");
    },
  });
  assert.equal(await runMoveToApplicationsPrompt(deps), "failed");
  assert.deepEqual(seen.calls, []);
  assert.deepEqual(seen.errors, [`${MESSAGES.moveFailed} Permission denied`]);
});

test("a move that returns false with no clash decision shows a plain message and keeps running", async () => {
  const { deps, seen } = fakeDeps({ move: () => false });
  assert.equal(await runMoveToApplicationsPrompt(deps), "failed");
  assert.deepEqual(seen.errors, [MESSAGES.moveFailed]);
});

test("the decision made when Electron re-enters through conflictHandler mid-relocation decides the outcome", async () => {
  const reads: string[] = [];
  const { deps, seen } = fakeDeps({
    readExistingVersion: ({ appPath }) => {
      reads.push(appPath);
      return "0.1.7";
    },
    move: ({ conflictHandler }) => conflictHandler("existsAndRunning"),
  });
  assert.equal(await runMoveToApplicationsPrompt(deps), "blocked-by-running-copy");
  assert.deepEqual(reads, ["/Applications/Example.app"], "the existing copy is read at the target path, once, inside the re-entry");
  assert.deepEqual(seen.infos, []);
});
