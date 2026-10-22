/** Native Node operations bound to the public object-argument filesystem ports. */
import fs from 'node:fs';
import type { ToolchainFilesystemPort } from '../node-toolchain/index.js';
import type { PresenceFilesystemPort } from '../electron/updates/instance-presence.js';
export const nodeFilesystem: ToolchainFilesystemPort & PresenceFilesystemPort = {
  mkdirSync: ({ path }, options = {}) => fs.mkdirSync(path, options),
  chmodSync: ({ path, mode }) => fs.chmodSync(path, mode),
  writeFileSync: ({ path, data }, options: Parameters<ToolchainFilesystemPort['writeFileSync']>[1] = {}) => fs.writeFileSync(path, data, options),
  renameSync: ({ oldPath, newPath }) => fs.renameSync(oldPath, newPath),
  unlinkSync: ({ path }) => fs.unlinkSync(path),
  readdirSync: ({ path }) => fs.readdirSync(path),
  readFileSync: ({ path, encoding }) => fs.readFileSync(path, encoding),
};
