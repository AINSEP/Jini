// Filesystem exports share atomic replacement and token/inode-owned lock primitives.
export * from "../fs.js";
export * from "./atomic-write.js";
export * from "./env-text.js";
export * from "./strict-containment.js";
export * from "./guarded-reader.js";
export * from "./durable-json.js";

export { withFileLock, withFileLockSync, isLockStale } from "./file-lock.js";
