/**
 * @module command
 *
 * Cross-platform command-invocation construction. Turns a requested
 * `{ command, args, env }` into the concrete `{ command, args }` (plus the
 * Windows-only `windowsVerbatimArguments` flag) that `child_process.spawn` /
 * `execFile` must receive so `.bat` / `.cmd` shims and Corepack-only package
 * managers launch correctly on every platform.
 *
 * Consumed by the `process` module's spawn helpers; owns no process lifecycle
 * itself.
 */
import { extname } from "node:path";
import { planCmdShimInvocation, planCommandInvocation, type CommandInvocation, type CommandInvocationRequest } from "@jini-ai/core/contracts/runtime";

const nodeLoadablePackageManagerExtensions = new Set([".js", ".cjs", ".mjs"]);

/**
 * Resolve a command request into the concrete invocation to spawn. On Windows,
 * `.bat` / `.cmd` targets are rewrapped as a `cmd.exe /d /s /c "..."` shim with
 * `windowsVerbatimArguments` so quoting and percent-expansion behave safely;
 * every other case passes the command and args straight through.
 *
 * @param request - The command, optional args, and env to base the invocation on.
 * @returns The `{ command, args }` (plus `windowsVerbatimArguments` when a shim is used) to spawn.
 */
export function createCommandInvocation({ args = [], command, env, fallbackComSpec }: CommandInvocationRequest & { env: NodeJS.ProcessEnv; fallbackComSpec: string | undefined }, _options = {}): CommandInvocation {
  return planCommandInvocation({ command, platform: process.platform, env }, { args, fallbackComSpec });
}

/**
 * Build the invocation for re-entering the repo-pinned package manager. Prefers
 * `npm_execpath` (routing Node-loadable managers through `process.execPath`),
 * and otherwise falls back to `corepack pnpm …` so Corepack-only setups without
 * a global `pnpm` on PATH still work. See #2438.
 *
 * @param args - Arguments to pass to the package manager.
 * @param env - Child environment; the host supplies its package-manager path and shell fallback.
 * @returns The `{ command, args }` invocation that runs the package manager.
 */
export function createPackageManagerInvocation({ args, env, npmExecPath: execPath, fallbackComSpec }: { args: string[]; env: NodeJS.ProcessEnv; npmExecPath: string | undefined; fallbackComSpec: string | undefined }): CommandInvocation {
  if (execPath) {
    if (nodeLoadablePackageManagerExtensions.has(extname(execPath).toLowerCase())) {
      return { args: [execPath, ...args], command: process.execPath };
    }
    return createCommandInvocation({ args, command: execPath, env, fallbackComSpec });
  }
  // No `npm_execpath` — common on Corepack-only setups (e.g. native Windows
  // PowerShell where `corepack pnpm` works but no standalone `pnpm` lives on
  // PATH). Route nested invocations through `corepack pnpm …` instead of
  // assuming a global `pnpm` binary: `corepack pnpm …` runs the repo-pinned
  // package manager out of the box, while a bare `pnpm` only resolves when a
  // separate global install or a `corepack enable` shim is present. See #2438.
  if (process.platform === "win32") {
    return planCmdShimInvocation({ command: "corepack", args: ["pnpm", ...args], env }, { fallbackComSpec });
  }
  return { args: ["pnpm", ...args], command: "corepack" };
}
