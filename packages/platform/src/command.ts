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

const nodeLoadablePackageManagerExtensions: ReadonlySet<string> = new Set([".js", ".cjs", ".mjs"]);

/**
 * Resolve a command request into the concrete invocation to spawn. On Windows,
 * `.bat` / `.cmd` targets are rewrapped as a `cmd.exe /d /s /c "..."` shim with
 * `windowsVerbatimArguments` so quoting and percent-expansion behave safely;
 * every other case passes the command and args straight through.
 *
 * @param request - The command, optional args, and env to base the invocation on.
 * @returns The `{ command, args }` (plus `windowsVerbatimArguments` when a shim is used) to spawn.
 */
export function createCommandInvocation({ args = [], command, env = process.env }: CommandInvocationRequest, _options = {}): CommandInvocation {
  return planCommandInvocation({ command, platform: process.platform, env }, { args, fallbackComSpec: ambientComSpec() });
}

/** The process's own `ComSpec`, the fallback when a caller-supplied `env` carries none; `ambient` is injectable. */
function ambientComSpec(ambient: NodeJS.ProcessEnv = process.env): string | undefined {
  return ambient.ComSpec;
}

/**
 * Build the invocation for re-entering the repo-pinned package manager. Prefers
 * `npm_execpath` (routing Node-loadable managers through `process.execPath`),
 * and otherwise falls back to `corepack pnpm …` so Corepack-only setups without
 * a global `pnpm` on PATH still work. See #2438.
 *
 * @param args - Arguments to pass to the package manager.
 * @param env - Environment to read `npm_execpath` / `ComSpec` from (defaults to `process.env`).
 * @returns The `{ command, args }` invocation that runs the package manager.
 */
export function createPackageManagerInvocation({ args }: { args: string[] }, { env = process.env }: { env?: NodeJS.ProcessEnv | undefined } = {}): CommandInvocation {
  const execPath = env.npm_execpath;
  if (execPath) {
    if (nodeLoadablePackageManagerExtensions.has(extname(execPath).toLowerCase())) {
      return { args: [execPath, ...args], command: process.execPath };
    }
    return createCommandInvocation({ args, command: execPath, env });
  }
  // No `npm_execpath` — common on Corepack-only setups (e.g. native Windows
  // PowerShell where `corepack pnpm` works but no standalone `pnpm` lives on
  // PATH). Route nested invocations through `corepack pnpm …` instead of
  // assuming a global `pnpm` binary: `corepack pnpm …` runs the repo-pinned
  // package manager out of the box, while a bare `pnpm` only resolves when a
  // separate global install or a `corepack enable` shim is present. See #2438.
  if (process.platform === "win32") {
    return planCmdShimInvocation({ command: "corepack", args: ["pnpm", ...args], env }, { fallbackComSpec: ambientComSpec() });
  }
  return { args: ["pnpm", ...args], command: "corepack" };
}
