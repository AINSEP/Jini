import assert from "node:assert/strict";
import { test } from "vitest";
import { writeFileAtomic, writeJsonFileAtomic, type AtomicFilesystemPort } from "../atomic-write.js";
function fake(calls: unknown[] = []): AtomicFilesystemPort {
  let descriptor = 0;
  return {
    stat: () => ({ mode: 0o640 }), lstat: () => ({ mode: 0o640, isSymbolicLink: () => false }),
    open: args => { calls.push(["open", args]); return ++descriptor; },
    write: args => { calls.push(["write", args]); }, sync: args => { calls.push(["sync", args]); },
    close: args => { calls.push(["close", args]); }, chmod: args => { calls.push(["chmod", args]); },
    rename: args => { calls.push(["rename", args]); }, remove: args => { calls.push(["remove", args]); },
  };
}
// PARITY: non-ENOENT failures must stop before exclusive temp creation.
test("stat refusal propagates before requesting a temp name or creating a file", () => {
  const calls: unknown[] = [], fs = fake(calls), error = Object.assign(new Error("denied"), { code: "EACCES" });
  fs.stat = () => { throw error; };
  assert.throws(() => writeFileAtomic({ filePath: "/fixture/.env", content: "secret", fs }, { tempName: () => { throw new Error("must not run"); } }), e => e === error);
  assert.deepEqual(calls, []);
});
// REGRESSION: fails if file and directory fsync are removed from writeFileAtomic.
test("pretty JSON preserves mode, syncs content before rename and syncs its directory afterwards", () => {
  const calls: unknown[] = [], fs = fake(calls);
  writeJsonFileAtomic({ filePath: "/fixture/state.json", data: { version: 2 }, fs }, { tempName: () => "unit", platform: "linux" });
  assert.deepEqual(calls, [
    ["open", { path: "/fixture/.state.json.unit.tmp", flags: "wx", mode: 0o640 }],
    ["write", { descriptor: 1, content: '{\n  "version": 2\n}' }],
    ["chmod", { path: "/fixture/.state.json.unit.tmp", mode: 0o640 }],
    ["sync", { descriptor: 1 }], ["close", { descriptor: 1 }],
    ["rename", { from: "/fixture/.state.json.unit.tmp", to: "/fixture/state.json" }],
    ["open", { path: "/fixture", flags: "r" }], ["sync", { descriptor: 2 }], ["close", { descriptor: 2 }],
  ]);
});
// REGRESSION: fails if cleanup excludes a write failure after a successful wx open.
test("partial write failure closes its descriptor and removes only the owned temp", () => {
  const calls: unknown[] = [], fs = fake(calls), error = new Error("partial write failed");
  fs.write = () => { throw error; };
  assert.throws(() => writeFileAtomic({ filePath: "/fixture/.env", content: "secret", fs }, { tempName: () => "unit" }), e => e === error);
  assert.deepEqual(calls, [["open", { path: "/fixture/..env.unit.tmp", flags: "wx", mode: 0o640 }], ["close", { descriptor: 1 }], ["remove", { path: "/fixture/..env.unit.tmp" }]]);
});
// PARITY: a failed exclusive create never grants ownership of an existing temp.
test("exclusive-create collision does not remove another writer's temp", () => {
  const calls: unknown[] = [], fs = fake(calls);
  fs.open = () => { throw Object.assign(new Error("exists"), { code: "EEXIST" }); };
  assert.throws(() => writeFileAtomic({ filePath: "/fixture/.env", content: "secret", fs }, { tempName: () => "unit" }));
  assert.deepEqual(calls, []);
});
// PARITY: chmod refusal still precedes rename and cleans the owned temp.
test("chmod refusal prevents rename and cleans the owned temp", () => {
  const calls: unknown[] = [], fs = fake(calls), error = new Error("chmod failed");
  fs.chmod = () => { throw error; };
  assert.throws(() => writeFileAtomic({ filePath: "/fixture/.env", content: "secret", fs }, { tempName: () => "unit" }), e => e === error);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "rename"), false);
  assert.deepEqual(calls.slice(-2), [["close", { descriptor: 1 }], ["remove", { path: "/fixture/..env.unit.tmp" }]]);
});
// REGRESSION: fails if real directory-sync errors are swallowed after rename.
test("directory-sync error is reported after replacement without deleting the destination", () => {
  const calls: unknown[] = [], fs = fake(calls), error = new Error("directory sync failed");
  fs.sync = ({ descriptor }) => { if (descriptor === 2) throw error; };
  assert.throws(() => writeFileAtomic({ filePath: "/fixture/state", content: "value", fs }, { platform: "linux" }), e => e === error);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "rename"), true);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "remove"), false);
  assert.deepEqual(calls.at(-1), ["close", { descriptor: 2 }]);
});
// REGRESSION: fails if Windows writes open a directory after a successful replacement.
test("Windows replacement flushes the file without opening its directory", () => {
  const calls: unknown[] = [], fs = fake(calls);
  writeFileAtomic({ filePath: "/fixture/state", content: "value", fs }, { platform: "win32" });
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "rename"), true);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "open" && call[1].flags === "r"), false);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "remove"), false);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "sync" && call[1].descriptor === 1), true);
});
for (const code of ["EPERM", "EISDIR", "EINVAL", "EACCES", "ENOTSUP"]) {
  // REGRESSION: fails if unsupported directory flushes reject a landed rename or leak the descriptor.
  test(`directory sync ${code} leaves the replacement intact and closes the directory`, () => {
    const calls: unknown[] = [], fs = fake(calls);
    fs.sync = ({ descriptor }) => { if (descriptor === 2) throw Object.assign(new Error(`${code}: operation not permitted, fsync`), { code }); };
    writeFileAtomic({ filePath: "/fixture/state", content: "value", fs }, { platform: "linux" });
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === "rename"), true);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === "remove"), false);
    assert.deepEqual(calls.at(-1), ["close", { descriptor: 2 }]);
  });
  // REGRESSION: fails if filesystems refusing directory open reject an already-landed replacement.
  test(`directory open ${code} leaves the replacement intact`, () => {
    const calls: unknown[] = [], fs = fake(calls), open = fs.open;
    fs.open = args => { if (args.flags === "r") throw Object.assign(new Error("directory open unsupported"), { code }); return open(args); };
    writeFileAtomic({ filePath: "/fixture/state", content: "value", fs }, { platform: "linux" });
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === "rename"), true);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === "remove"), false);
    assert.equal(calls.filter(call => Array.isArray(call) && call[0] === "close").length, 1);
  });
}
// REGRESSION: fails if real I/O failures are mistaken for unsupported directory flushes.
test("directory sync EIO is reported after replacement and closes the descriptor", () => {
  const calls: unknown[] = [], fs = fake(calls), error = Object.assign(new Error("directory I/O failure"), { code: "EIO" });
  fs.sync = ({ descriptor }) => { if (descriptor === 2) throw error; };
  assert.throws(() => writeFileAtomic({ filePath: "/fixture/state", content: "value", fs }, { platform: "linux" }), e => e === error);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "rename"), true);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "remove"), false);
  assert.deepEqual(calls.at(-1), ["close", { descriptor: 2 }]);
});
