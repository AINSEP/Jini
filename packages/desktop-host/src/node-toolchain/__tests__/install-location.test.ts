import { it, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isTransientAppPath, isReadOnlyVolumeRoot, launcherNamesDurableInstall } from '../install-location.js';
const DMG_INPUT = { electronPath: '/Volumes/Sample 1.0/Sample.app/Contents/MacOS/Sample' };
const LAUNCHER_INPUT = { electronPath: '/Applications/Sample.app/Contents/MacOS/Sample' };
const ALL_VOLUMES_READ_ONLY = () => true;
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'install-location-'));
it("isTransientAppPath flags a read-only /Volumes mount and macOS App Translocation, nothing else", () => {
  assert.equal(isTransientAppPath({ executablePath: DMG_INPUT.electronPath }, { isReadOnlyVolume: ALL_VOLUMES_READ_ONLY }), true);
  assert.equal(
    isTransientAppPath({ executablePath: "/private/var/folders/xy/abc/T/AppTranslocation/1234-5678/d/Sample.app/Contents/MacOS/Sample" }, { isReadOnlyVolume: () => false }),
    true,
  );
  // A writable external drive the operator deliberately installed onto is a durable location.
  assert.equal(isTransientAppPath({ executablePath: "/Volumes/External/Apps/Sample.app/Contents/MacOS/Sample" }, { isReadOnlyVolume: () => false }), false);
  assert.equal(isTransientAppPath({ executablePath: LAUNCHER_INPUT.electronPath }, { isReadOnlyVolume: ALL_VOLUMES_READ_ONLY }), false);
});

it("isTransientAppPath asks the probe about the volume ROOT, not the whole path", () => {
  const asked: string[] = [];
  isTransientAppPath({ executablePath: DMG_INPUT.electronPath }, { isReadOnlyVolume: (root) => (asked.push(root), true) });
  assert.deepEqual(asked, ["/Volumes/Sample 1.0"]);
});

it("isReadOnlyVolumeRoot answers true only for an EROFS refusal of write access", () => {
  const refusing = (code: string) => (target: string, mode: number) => {
    assert.equal(target, "/Volumes/Sample 1.0");
    assert.equal(mode, fs.constants.W_OK);
    throw Object.assign(new Error(`${code}: refused`), { code });
  };

  assert.equal(isReadOnlyVolumeRoot({ volumeRoot: "/Volumes/Sample 1.0" }, { accessSync: refusing("EROFS") }), true);
  // A permission denial or a vanished path is not evidence of a disk image.
  assert.equal(isReadOnlyVolumeRoot({ volumeRoot: "/Volumes/Sample 1.0" }, { accessSync: refusing("EACCES") }), false);
  assert.equal(isReadOnlyVolumeRoot({ volumeRoot: "/Volumes/Sample 1.0" }, { accessSync: refusing("ENOENT") }), false);
  assert.equal(isReadOnlyVolumeRoot({ volumeRoot: "/Volumes/Sample 1.0" }, { accessSync: () => undefined }), false);
});

it("isReadOnlyVolumeRoot's default probe treats a writable folder and a missing path as not read-only", () => {
  const writable = tempDir();
  try {
    assert.equal(isReadOnlyVolumeRoot({ volumeRoot: writable }), false);
    assert.equal(isReadOnlyVolumeRoot({ volumeRoot: path.join(writable, "gone") }), false);
  } finally { fs.rmSync(writable, { recursive: true, force: true }); }
});

it("recognizes an exec launcher only while its installed executable exists", () => {
  const dir = tempDir();
  const launcherPath = path.join(dir, "node");
  const executable = path.join(dir, "Installed App");
  try {
    assert.equal(launcherNamesDurableInstall({ launcherPath }), false);
    fs.writeFileSync(launcherPath, "#!/bin/sh\nexit 1\n");
    assert.equal(launcherNamesDurableInstall({ launcherPath }), false);
    fs.writeFileSync(executable, "");
    fs.writeFileSync(launcherPath, `#!/bin/sh\nexec '${executable}' "$@"\n`);
    assert.equal(launcherNamesDurableInstall({ launcherPath }), true);
    fs.unlinkSync(executable);
    assert.equal(launcherNamesDurableInstall({ launcherPath }), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it("uses the native write probe by default to detect a read-only mount", () => {
  const access = vi.spyOn(fs, "accessSync").mockImplementation(() => {
    throw Object.assign(new Error("read-only filesystem"), { code: "EROFS" });
  });
  try {
    assert.equal(isTransientAppPath({ executablePath: DMG_INPUT.electronPath }), true);
    assert.deepEqual(access.mock.calls, [["/Volumes/Sample 1.0", fs.constants.W_OK]]);
  } finally { access.mockRestore(); }
});

