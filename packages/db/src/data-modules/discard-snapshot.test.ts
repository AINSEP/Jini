import { mkdtemp, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { discardCommittedSnapshot } from "./snapshot.js";

it("removes a snapshot file, and a missing one is not an error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jini-discard-"));
  const file = join(dir, "a.snap");
  await writeFile(file, "x");
  await discardCommittedSnapshot({ snapshotPath: file });
  await expect(access(file)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(discardCommittedSnapshot({ snapshotPath: file })).resolves.toBeUndefined();
});

it("propagates a failed removal instead of swallowing it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jini-discard-"));
  const notAFile = join(dir, "dir-not-file");
  await mkdir(notAFile);
  await expect(discardCommittedSnapshot({ snapshotPath: notAFile })).rejects.toMatchObject({ code: expect.stringMatching(/^(ERR_FS_EISDIR|EISDIR|EPERM)$/) });
});
