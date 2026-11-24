import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

/**
 * @file Opens the OS-native "choose folder" dialog on the machine running this server and returns the
 * chosen absolute path. Backs the admin chat composer's folder button (`routes/fs-files/folder-picker.ts`):
 * a plain browser tab can never read a folder's OS path, but when the server IS the owner's own
 * machine it can ask the OS directly. That route owns the "own machine only" admission; this module
 * only knows how to show the dialog.
 *
 * Every chooser runs through `execFile` with a fixed absolute binary and a fixed argv — no shell, and
 * nothing request-supplied ever reaches the command line.
 */

const PROMPT = "Choose a folder to insert its path";
/** A dialog left open this long is closed (the child is killed) and read as a cancel. */
const PICK_TIMEOUT_MS = 10 * 60_000;

/** The parts of a rejected `execFile` this module reads. `code` is the exit code, or a spawn error
 *  code such as `ENOENT`; `killed` is set when the timeout ended the child. */
export interface ChooserFailure {
  readonly code?: number | string;
  readonly killed?: boolean;
  readonly stderr?: string;
}

export interface FolderChooserCommand {
  readonly file: string;
  readonly args: readonly string[];
  /** Whether a failed run was the user pressing Cancel rather than a real error. */
  readonly cancelled: (required: { failure: ChooserFailure }) => boolean;
}

// `activate` (no target) brings osascript itself to the front, so the dialog does not open behind
// the browser. A tell to "System Events" would do the same but costs an Automation permission prompt.
// AppleScript reports Cancel as error -128 (exit 1); every other osascript error also exits 1.
const MAC_COMMAND: FolderChooserCommand = {
  file: "/usr/bin/osascript",
  args: ["-e", "activate", "-e", `POSIX path of (choose folder with prompt "${PROMPT}")`],
  cancelled: ({ failure }) => failure.code === 1 && /\(-128\)/.test(failure.stderr ?? ""),
};

// zenity and kdialog both exit 1 on Cancel with nothing on stdout.
const LINUX_COMMANDS: readonly FolderChooserCommand[] = [
  { file: "/usr/bin/zenity", args: ["--file-selection", "--directory", `--title=${PROMPT}`], cancelled: ({ failure }) => failure.code === 1 },
  { file: "/usr/bin/kdialog", args: ["--title", PROMPT, "--getexistingdirectory"], cancelled: ({ failure }) => failure.code === 1 },
];

// A hidden TopMost owner form keeps the dialog above the browser. Cancel exits 0 with no output.
// UTF-8 output so a non-ASCII folder name survives the trip back to Node.
const WINDOWS_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  `$dialog.Description = '${PROMPT}'`,
  "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
].join("; ");

function windowsCommand({ env }: { env: Readonly<Record<string, string | undefined>> }): FolderChooserCommand {
  return {
    file: path.win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_SCRIPT],
    cancelled: () => false,
  };
}

function candidateCommands({ platform, env }: { platform: string; env: Readonly<Record<string, string | undefined>> }): readonly FolderChooserCommand[] {
  if (platform === "darwin") return [MAC_COMMAND];
  if (platform === "win32") return [windowsCommand({ env })];
  // A Linux server with no display (a container, an SSH session) has nowhere to show a dialog.
  if (platform === "linux" && (env.DISPLAY || env.WAYLAND_DISPLAY)) return LINUX_COMMANDS;
  return [];
}

/**
 * The chooser this machine can run, or `null` when it has none.
 *
 * @param required.platform `process.platform`.
 * @param required.env `process.env` (`SystemRoot` on Windows; `DISPLAY`/`WAYLAND_DISPLAY` on Linux).
 * @param optional.exists File-existence probe; defaults to `fs.existsSync`.
 * @complexity O(1): at most two fixed candidates.
 */
export function folderChooserCommand(
  required: { platform: string; env: Readonly<Record<string, string | undefined>> },
  optional: { exists?: (file: string) => boolean } = {},
): FolderChooserCommand | null {
  const exists = optional.exists ?? existsSync;
  return candidateCommands(required).find((command) => exists(command.file)) ?? null;
}

/**
 * The path a chooser printed, or `null` when it printed nothing (a cancel). Drops the trailing
 * newline, and the trailing `/` macOS adds to a folder, except on the root itself.
 *
 * @complexity O(n) in the output length.
 */
export function chosenFolderPath({ stdout }: { stdout: string }): string | null {
  let end = stdout.length;
  while (end > 0 && (stdout[end - 1] === "\r" || stdout[end - 1] === "\n")) end -= 1;
  const printed = stdout.slice(0, end);
  if (printed === "") return null;
  return printed.length > 1 && printed.endsWith("/") ? printed.slice(0, -1) : printed;
}

type ExecFilePort = (file: string, args: readonly string[], options: { timeout: number; maxBuffer: number; encoding: "utf8" }) =>
  Promise<{ stdout: string; stderr: string }>;

export interface NativeFolderPicker {
  /** Whether this machine has a chooser at all. Fixed for the process's life. */
  readonly available: boolean;
  /** Shows the dialog and resolves with the chosen absolute path, or `null` on cancel/timeout.
   *  Rejects when the chooser itself fails. */
  pick(): Promise<string | null>;
}

async function runChooser({ command, execFile }: { command: FolderChooserCommand; execFile: ExecFilePort }): Promise<string | null> {
  try {
    const { stdout } = await execFile(command.file, command.args, { timeout: PICK_TIMEOUT_MS, maxBuffer: 64 * 1024, encoding: "utf8" });
    return chosenFolderPath({ stdout });
  } catch (error) {
    const failure = error as ChooserFailure;
    if (failure.killed === true || command.cancelled({ failure })) return null;
    throw error;
  }
}

/**
 * The real picker for this process. The chooser is resolved once, at creation.
 *
 * @param optional Test seams; every real caller passes none. `execFile` is the only thing that
 *   ever spawns, so tests inject a fake and never show a dialog.
 * @complexity O(1) to create; `pick` waits on the user.
 */
export function createNativeFolderPicker(
  _required: Record<string, never> = {},
  optional: {
    platform?: string;
    env?: Readonly<Record<string, string | undefined>>;
    exists?: (file: string) => boolean;
    execFile?: ExecFilePort;
  } = {},
): NativeFolderPicker {
  const command = folderChooserCommand(
    { platform: optional.platform ?? process.platform, env: optional.env ?? process.env },
    optional.exists ? { exists: optional.exists } : {},
  );
  const execFile = optional.execFile ?? (promisify(execFileCallback) as unknown as ExecFilePort);
  return {
    available: command !== null,
    pick: () => command
      ? runChooser({ command, execFile })
      : Promise.reject(new Error("no native folder chooser on this machine")),
  };
}
