/** Native presence ports and the host's shared instances directory; records are owned by Jini. */
// Presence/liveness rationale: Jini/packages/desktop-host/src/electron/updates/instance-presence.ts.
import fs from "node:fs";
import {
  createFileInstancePresence,
  isPidAlive as probePid,
  presenceDirPath as resolvePresenceDirectory,
} from "../electron/updates/index.js";
import type { InstancePresencePort, PresenceFilesystemPort } from "../electron/updates/index.js";

const filesystem: PresenceFilesystemPort = {
  mkdirSync: ({ path }, options) => fs.mkdirSync(path, options),
  writeFileSync: ({ path, data }) => fs.writeFileSync(path, data),
  renameSync: ({ oldPath, newPath }) => fs.renameSync(oldPath, newPath),
  unlinkSync: ({ path }) => fs.unlinkSync(path),
  readdirSync: ({ path }) => fs.readdirSync(path),
  readFileSync: ({ path, encoding }) => fs.readFileSync(path, encoding),
};

/** Resolve the host's existing on-disk directory. @complexity O(n) in path length. */
function presenceDirPath({ userDataDir }: { userDataDir: string }, _optional = {}): string {
  return resolvePresenceDirectory({ userDataDir, directoryName: "instances" });
}

/** Native signal-zero probe; permission denial still counts as alive. @complexity O(1). */
function isPidAlive({ pid }: { pid: number }): boolean {
  return probePid({ pid, probe: ({ pid, signal }) => process.kill(pid, signal) });
}

/** Bind native I/O and liveness; callers use write/readLive/remove methods. @complexity O(1). */
function createInstancePresence(
  { directory }: { directory: string },
  { isAlive = isPidAlive, writerPid = process.pid }: { isAlive?: (args: { pid: number }) => boolean; writerPid?: number } = {},
): InstancePresencePort {
  return createFileInstancePresence({ directory, filesystem, isAlive, writerPid });
}

export { createInstancePresence, isPidAlive, presenceDirPath };
