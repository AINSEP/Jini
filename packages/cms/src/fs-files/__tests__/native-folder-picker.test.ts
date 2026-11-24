import assert from "node:assert/strict";
import { test } from "vitest";
import { chosenFolderPath, createNativeFolderPicker, folderChooserCommand } from "../native-folder-picker.js";

/** Never spawns anything: every run goes through this recording fake. */
function fakeExec(outcome: { stdout?: string; failure?: Record<string, unknown> }) {
  const calls: { file: string; args: readonly string[]; options: Record<string, unknown> }[] = [];
  const execFile = async (file: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ file, args, options });
    if (outcome.failure) throw Object.assign(new Error("exec failed"), outcome.failure);
    return { stdout: outcome.stdout ?? "", stderr: "" };
  };
  return { calls, execFile };
}

const everyFileExists = () => true;

test("each platform resolves its own fixed chooser binary, and nothing when it is missing", () => {
  assert.equal(folderChooserCommand({ platform: "darwin", env: {} }, { exists: everyFileExists })?.file, "/usr/bin/osascript");
  assert.match(folderChooserCommand({ platform: "win32", env: { SystemRoot: "D:\\Win" } }, { exists: everyFileExists })?.file ?? "",
    /^D:\\Win\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
  assert.equal(folderChooserCommand({ platform: "linux", env: { DISPLAY: ":0" } }, { exists: everyFileExists })?.file, "/usr/bin/zenity");
  assert.equal(folderChooserCommand({ platform: "linux", env: { WAYLAND_DISPLAY: "w" } }, { exists: (file) => file === "/usr/bin/kdialog" })?.file, "/usr/bin/kdialog");
  // A headless Linux server has no screen to show a dialog on.
  assert.equal(folderChooserCommand({ platform: "linux", env: {} }, { exists: everyFileExists }), null);
  assert.equal(folderChooserCommand({ platform: "darwin", env: {} }, { exists: () => false }), null);
  assert.equal(folderChooserCommand({ platform: "freebsd", env: { DISPLAY: ":0" } }, { exists: everyFileExists }), null);
});

test("the macOS chooser brings itself to the front and returns a POSIX path", () => {
  const command = folderChooserCommand({ platform: "darwin", env: {} }, { exists: everyFileExists });
  assert.deepEqual(command?.args.filter((_arg, index) => index % 2 === 0), ["-e", "-e"]);
  assert.equal(command?.args[1], "activate");
  assert.match(command?.args[3] ?? "", /^POSIX path of \(choose folder with prompt ".+"\)$/);
});

test("chosenFolderPath strips the trailing newline and a POSIX trailing slash, and reads empty as cancel", () => {
  assert.equal(chosenFolderPath({ stdout: "/Users/la/My Project/\n" }), "/Users/la/My Project");
  assert.equal(chosenFolderPath({ stdout: "C:\\Users\\la\\Proj\r\n" }), "C:\\Users\\la\\Proj");
  assert.equal(chosenFolderPath({ stdout: "C:\\" }), "C:\\");
  assert.equal(chosenFolderPath({ stdout: "/\n" }), "/");
  assert.equal(chosenFolderPath({ stdout: "" }), null);
  assert.equal(chosenFolderPath({ stdout: "\n" }), null);
});

test("pick runs the fixed argv with a timeout and returns the chosen path", async () => {
  const exec = fakeExec({ stdout: "/tmp/picked/\n" });
  const picker = createNativeFolderPicker({}, { platform: "darwin", env: {}, exists: everyFileExists, execFile: exec.execFile });
  assert.equal(picker.available, true);
  assert.equal(await picker.pick(), "/tmp/picked");
  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0]!.file, "/usr/bin/osascript");
  assert.equal(typeof exec.calls[0]!.options.timeout, "number");
});

test("a user cancel or a timed-out dialog is a null pick, never an error", async () => {
  const cancels = [
    { platform: "darwin", failure: { code: 1, stderr: "execution error: User canceled. (-128)" } },
    { platform: "linux", failure: { code: 1, stderr: "" } },
    { platform: "darwin", failure: { killed: true, signal: "SIGTERM" } },
  ] as const;
  for (const { platform, failure } of cancels) {
    const exec = fakeExec({ failure });
    const picker = createNativeFolderPicker({}, { platform, env: { DISPLAY: ":0" }, exists: everyFileExists, execFile: exec.execFile });
    assert.equal(await picker.pick(), null, `${platform} ${JSON.stringify(failure)}`);
  }
  const windowsCancel = createNativeFolderPicker({}, { platform: "win32", env: {}, exists: everyFileExists, execFile: fakeExec({ stdout: "" }).execFile });
  assert.equal(await windowsCancel.pick(), null);
});

test("any other chooser failure is thrown, and a machine with no chooser is unavailable", async () => {
  const notCancel = createNativeFolderPicker({}, { platform: "darwin", env: {}, exists: everyFileExists,
    execFile: fakeExec({ failure: { code: 1, stderr: "execution error: Not authorized (-1743)" } }).execFile });
  await assert.rejects(notCancel.pick(), /exec failed/);
  const missing = createNativeFolderPicker({}, { platform: "darwin", env: {}, exists: everyFileExists,
    execFile: fakeExec({ failure: { code: "ENOENT" } }).execFile });
  await assert.rejects(missing.pick(), /exec failed/);
  const none = createNativeFolderPicker({}, { platform: "linux", env: {}, exists: everyFileExists, execFile: fakeExec({}).execFile });
  assert.equal(none.available, false);
  await assert.rejects(none.pick(), /no native folder chooser/);
});
