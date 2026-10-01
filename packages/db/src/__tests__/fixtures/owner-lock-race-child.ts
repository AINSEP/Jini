import { acquireOwnerLock, PgliteOwnerLockedError } from "../../pglite/index.js";
import { LOCK_FILE } from "../helpers.js";

/**
 * @file One starter racing for a data dir's owner lock, for `pglite-owner.test.ts`.
 * Usage: `node --import tsx owner-lock-race-child.ts <dataDir> <startAtEpochMs>`; spins until
 * `startAt` so every starter tries at once, holds the lock (if it got it) long enough for the others
 * to finish trying, releases it, and prints one JSON line `{ owner }`.
 */

const [dataDir, startAt] = process.argv.slice(2);
if (dataDir === undefined || startAt === undefined) throw new Error("usage: owner-lock-race-child.ts <dataDir> <startAtEpochMs>");
while (Date.now() < Number(startAt)) {
  // spin: a timer would add scheduling jitter between the starters
}
let release: (() => void) | undefined;
try {
  release = acquireOwnerLock({ dataDir: dataDir, lockFileName: LOCK_FILE });
} catch (error) {
  if (!(error instanceof PgliteOwnerLockedError)) throw error;
}
if (release !== undefined) {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  release();
}
process.stdout.write(`${JSON.stringify({ owner: release !== undefined })}\n`);
