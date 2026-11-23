/**
 * Node-native binding of `../node-toolchain`: the real filesystem port, `path.join`, this process's
 * pid and the durable-install probes, with the host's generated-launcher banner and its two
 * environment-variable names injected.
 *
 * The `node-toolchain/{bin,npm-cache,npm-prefix}` directory names and the two injected env names are
 * a cross-process contract with the host's stdio MCP launch resolver (`@jini-ai/mcp` federation
 * stdio). Renaming one side can silently fall back to system tooling; these private env names are
 * not forwarded to MCP children.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildNodeToolchainEnv as buildEnvironment,
  buildNodeToolchainShims as buildShims,
  writeNodeToolchain as writeToolchain,
  isReadOnlyVolumeRoot, isTransientAppPath, launcherNamesDurableInstall,
  type NodeToolchainPaths, type ToolchainFilesystemPort,
} from "../node-toolchain/index.js";

export interface NodeToolchainNames {
  /** The `#` comment line written into every POSIX shim. */
  generatedComment: string;
  /** Env name carrying the toolchain directory to the launch resolver. */
  toolchainEnvName: string;
  /** Env name carrying the bundled npm root to the launch resolver. */
  npmRootEnvName: string;
}
export interface BuildNodeToolchainShimsInput {
  electronPath: string;
  npmRoot: string;
  platform?: NodeJS.Platform;
}
export interface WriteNodeToolchainInput extends BuildNodeToolchainShimsInput {
  userDataDir: string;
  isReadOnlyVolume?: (volumeRoot: string) => boolean;
}
export interface BuildNodeToolchainEnvInput {
  toolchainDir: string;
  npmRoot: string;
}
export interface BoundNodeToolchain {
  buildNodeToolchainShims(input: BuildNodeToolchainShimsInput): Record<string, string>;
  writeNodeToolchain(input: WriteNodeToolchainInput): NodeToolchainPaths | null;
  buildNodeToolchainEnv(input: BuildNodeToolchainEnvInput): Record<string, string>;
}

const joinPath = ({ parts }: { parts: string[] }) => path.join(...parts);
const filesystem: ToolchainFilesystemPort = {
  mkdirSync: ({ path }, options = {}) => fs.mkdirSync(path, options),
  chmodSync: ({ path, mode }) => fs.chmodSync(path, mode),
  writeFileSync: ({ path, data }, options = {}) => fs.writeFileSync(path, data, options),
  renameSync: ({ oldPath, newPath }) => fs.renameSync(oldPath, newPath),
  unlinkSync: ({ path }) => fs.unlinkSync(path),
};

/**
 * Bind the host's banner and env names to the native filesystem. I/O failures from the writer
 * propagate; it returns `null` for a transient launch. @complexity O(1) to bind.
 */
export function bindNodeToolchain({ generatedComment, toolchainEnvName, npmRootEnvName }: NodeToolchainNames, _optional: Record<string, never> = {}): BoundNodeToolchain {
  return {
    buildNodeToolchainShims: ({ electronPath, npmRoot, platform = process.platform }) =>
      buildShims({ electronPath, npmRoot, platform, generatedComment, joinPath }),
    writeNodeToolchain: ({
      userDataDir, electronPath, npmRoot, platform = process.platform, isReadOnlyVolume = (volumeRoot: string) => isReadOnlyVolumeRoot({ volumeRoot }),
    }) => {
      const toolchainDir = path.join(userDataDir, "node-toolchain");
      return writeToolchain({
        electronPath, npmRoot, platform, generatedComment, joinPath,
        paths: {
          toolchainDir,
          binDir: path.join(toolchainDir, "bin"),
          npmCacheDir: path.join(toolchainDir, "npm-cache"),
          npmPrefixDir: path.join(toolchainDir, "npm-prefix"),
        },
        filesystem,
        writerPid: process.pid,
        isTransientPath: ({ executablePath }) => isTransientAppPath({ executablePath }, { isReadOnlyVolume }),
        launcherNamesDurableInstall: ({ launcherPath }) => launcherNamesDurableInstall({ launcherPath }, { isReadOnlyVolume }),
        // The node shim names Electron alone in the MCP launcher's exec form, so that same durable-path
        // parser can inspect it; npm/npx also include their CLI script paths and are not the probe target.
      });
    },
    buildNodeToolchainEnv: (input) => buildEnvironment({ ...input, toolchainEnvName, npmRootEnvName }),
  };
}

export type { NodeToolchainPaths };
