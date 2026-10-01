import { startPgliteOwner } from "../../pglite/index.js";
import { PGlite } from "@electric-sql/pglite";
import { OWNER } from "../helpers.js";

/**
 * @file A PGlite owner in its own process, for `pglite-owner.test.ts` to kill -9.
 * Usage: `node --import tsx pglite-owner-child.ts <dataDir> <socketDir>`; prints one JSON line
 * `{ ready, socketPath, pid }` once serving, then serves until killed.
 */

const [dataDir, socketDir] = process.argv.slice(2);
if (dataDir === undefined || socketDir === undefined) throw new Error("usage: pglite-owner-child.ts <dataDir> <socketDir>");
const owner = await startPgliteOwner({ ...OWNER, dataDir }, { socketDir });
process.stdout.write(`${JSON.stringify({ ready: true, socketPath: owner.socketPath, pid: process.pid })}\n`);
setInterval(() => {}, 1 << 30);
