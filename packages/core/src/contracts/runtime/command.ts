import { trimCharsEnd } from "../../primitives/index.js";
import type { RuntimePlatform } from "./platform.js";

export type CommandInvocation = {
  args: string[];
  command: string;
  // When true, callers must forward this to `child_process.spawn` /
  // `child_process.execFile` options. Required for Windows `.bat` / `.cmd`
  // shims so cmd.exe's `/s /c` quoting survives Node's default per-arg
  // CommandLineToArgvW escaping. See `createCommandInvocation`.
  windowsVerbatimArguments?: boolean;
};

export type CommandInvocationRequest = {
  args?: string[];
  command: string;
  env?: Readonly<Record<string, string | undefined>>;
};

// `cmd.exe /s /c "..."` runs percent-expansion on the inner line *regardless*
// of whether the `%name%` pair sits inside a `"..."` quoted segment, so a
// `.cmd` / `.bat` shim spawn with an attacker-influenced argv (e.g. an LLM
// adapter that ships the user prompt as a positional argument) lets a stray
// `%DEEPSEEK_API_KEY%` substring substitute live env values into the line
// before the child sees it. Plain quote-doubling is not enough on its own.
//
// The fix is to break each potential `%var%` pair by toggling out of the
// outer quote with `"^%"`: cmd treats the `^` as the standard escape for the
// next char (here, `%`), making it literal and skipping percent-expansion;
// `CommandLineToArgvW` then concatenates the surrounding quote segments back
// into one literal arg with the `%` preserved. The two layers cancel, so the
// child receives the original arg byte-for-byte while cmd never has a chance
// to expand anything inside it.
function quoteWindowsCommandArg({ value }: { value: string }, _options = {}): string {
  if (/[\r\n]/.test(value)) throw new Error("Windows command shim arguments cannot contain line breaks");
  if (value !== "" && !/[\s"&<>|^%=,;()]/.test(value)) return value;
  // Backslashes before the closing quote must survive the child's argv parser.
  const quoted = value.replace(/"/g, '""').replace(/%/g, '"^%"');
  const trailingBackslashes = quoted.slice(trimCharsEnd({ text: quoted, chars: '\\' }).length);
  const escaped = quoted + trailingBackslashes;
  return `"${escaped}"`;
}

// Build the `cmd.exe /d /s /c "<line>"` invocation Node uses internally for
// `shell: true`. The outer `"..."` plus `windowsVerbatimArguments: true` is
// the only shape that survives both layers of quoting:
//
// 1. Node would otherwise escape each argv element with CommandLineToArgvW
//    rules (turning `"path with space"` into `\"path with space\"`), which
//    cmd.exe does not understand.
// 2. cmd.exe with `/s /c` strips exactly one leading and one trailing `"`
//    from the rest of the command line. The outer wrap absorbs that strip
//    so any inner per-arg quoting stays intact.
//
// Without this, paths containing spaces (`C:\Users\First Last\...\foo.cmd`)
// get split on the first space and cmd.exe reports "not recognized as an
// internal or external command" — see issue #315.
export function planCmdShimInvocation(
  { command, args, env }: { readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string | undefined>> },
  { fallbackComSpec }: { readonly fallbackComSpec?: string | undefined } = {},
): CommandInvocation {
  const inner = [command, ...args].map((value) => quoteWindowsCommandArg({ value })).join(" ");
  return {
    args: ["/d", "/s", "/c", `"${inner}"`],
    command: env.ComSpec ?? fallbackComSpec ?? "cmd.exe",
    windowsVerbatimArguments: true,
  };
}

/**
 * Pure form of command-invocation construction: platform and environment are arguments, so any host can
 * call it without a process port. On win32, `.bat` / `.cmd` targets are rewrapped as a
 * `cmd.exe /d /s /c "..."` shim with `windowsVerbatimArguments`; every other case passes through.
 */
export function planCommandInvocation(
  { command, platform, env }: { command: string; platform: RuntimePlatform; env: Readonly<Record<string, string | undefined>> },
  { args = [], fallbackComSpec }: { args?: string[]; fallbackComSpec?: string | undefined } = {},
): CommandInvocation {
  if (platform === "win32" && /\.(bat|cmd)$/i.test(command)) {
    return planCmdShimInvocation({ command, args, env }, { fallbackComSpec });
  }
  return { args, command };
}

/** A host may swap the planner; `planCommandInvocation` satisfies it. */
export type CommandInvocationPort = (
  required: { command: string; platform: RuntimePlatform; env: Readonly<Record<string, string | undefined>> },
  optional?: { args?: string[]; fallbackComSpec?: string | undefined },
) => CommandInvocation;
