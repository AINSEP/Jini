// Filesystem exports share atomic replacement and token/inode-owned lock primitives.
export * from "../fs.js";
export * from "./atomic-write.js";
export * from "./app-data-root.js";
export * from "./env-text.js";
export * from "./strict-containment.js";
export * from "./guarded-reader.js";
export * from "./durable-json.js";

export { withFileLock, withFileLockSync, isLockStale } from "./file-lock.js";
export * from "./directory-home.js";
export * from "./directory-registry.js";
export * from "./directory-running-lock.js";
export * from "./directory-workspace.js";
export { DirectoryUserConfigRefusal, validateDirectoryUserConfig } from "./directory-user-config.js";
export * from "./workspace-directory.js";
export * from "./verified-directory-move.js";
export * from "./reviewed-file.js";

export { backupOriginalOnce } from './backup-once.js';

export * from "./directory-delete-guard.js";
export * from "./remove-directory-tree.js";
export * from "./directory-relocation.js";
export * from "./recent-directories.js";
export * from "./resolve-directory-target.js";
export * from "./leased-directory-move.js";
export * from "./owned-temp-root.js";
