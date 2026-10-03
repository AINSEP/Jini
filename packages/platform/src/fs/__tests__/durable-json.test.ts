/**
 * @file Direct coverage for `durable-json-file.ts` — the shared mechanism the three `userData`
 * stores use. The stores' own tests prove their POLICY over a damaged file; this proves the
 * mechanism underneath, including the two branches no store can reach on purpose: a lock whose owner
 * crashed, and a lock this process no longer owns.
 */
import { test, vi, afterEach } from "vitest";
afterEach(() => vi.restoreAllMocks());
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createDurableJsonFile, createNodeDurableJsonPorts, salvageJsonPrefix as salvage } from "../durable-json.js";
function store(filePath: string) { return createDurableJsonFile({ filePath, ...createNodeDurableJsonPorts({}), notices: { prefix: "fixture desktop", lockTimeout: ({ lockPath, waitMs }: { lockPath: string; waitMs: number }) => `fixture desktop: ${lockPath} is still held by another Fixture process after ${waitMs}ms, so this change was not saved. Nothing was written over. Try again, or quit the other Fixture window.` } }); }
function readJsonFile(filePath: string) { return store(filePath).read({}); }
function tempPathFor(filePath: string, pid = process.pid) { return store(filePath).tempPath({}, { pid }); }
function writeStoreValue(filePath: string, value: unknown) { return store(filePath).write({ value }); }
function quarantineUnreadableFile(filePath: string, notice: { label: string; consequence: string }) { return store(filePath).quarantine({ notice }); }
function runStoreLock<T>(filePath: string, critical: () => T, options: { waitMs?: number } = {}): T { return store(filePath).withLock({ critical }, options); }
function salvageJsonPrefix(text: string) { return salvage({ text }); }
function tempFile(): string {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fixture-desktop-durable-")), "store.json");
}
/** A pid that certainly named a process and certainly does not now. */
function deadPid(): number {
    return spawnSync(process.execPath, ["-e", ""]).pid!;
}
test("readJsonFile tells missing, parsed and damaged apart, and hands the damaged bytes back", () => {
    const filePath = tempFile();
    assert.deepEqual(readJsonFile(filePath), { state: "missing" });
    writeStoreValue(filePath, { a: 1 });
    assert.deepEqual(readJsonFile(filePath), { state: "ok", value: { a: 1 } });
    fs.writeFileSync(filePath, '{ "a": ');
    assert.deepEqual(readJsonFile(filePath), { state: "unreadable", text: '{ "a": ' });
    // An I/O failure is unreadable too, with no bytes to hand back.
    assert.deepEqual(readJsonFile(path.dirname(filePath)), { state: "unreadable" });
});
test("writeJsonFileAtomic leaves the file whole and its own temp file gone", () => {
    const filePath = tempFile();
    writeStoreValue(filePath, { sites: ["/a"] });
    assert.equal(fs.readFileSync(filePath, "utf8"), JSON.stringify({ sites: ["/a"] }, null, 2));
    assert.equal(fs.existsSync(tempPathFor(filePath)), false);
    assert.equal(tempPathFor(filePath, 4242), `${filePath}.4242.tmp`);
});
test("quarantineUnreadableFile keeps the bytes and reports the path it moved them to", (t) => {
    const filePath = tempFile();
    fs.writeFileSync(filePath, "torn");
    const errors = vi.spyOn(console, "error").mockImplementation(() => { });
    assert.equal(quarantineUnreadableFile(filePath, { label: "test store", consequence: "nothing else to say." }), true);
    const aside = fs.readdirSync(path.dirname(filePath));
    assert.equal(aside.length, 1);
    assert.match(aside[0]!, /^store\.json\.corrupt-\d+$/);
    assert.equal(fs.readFileSync(path.join(path.dirname(filePath), aside[0]!), "utf8"), "torn");
    assert.deepEqual(errors.mock.calls.map((call) => call[0]), [
        `fixture desktop: test store ${filePath} was unreadable (torn or corrupt). Moved it aside to ${path.join(path.dirname(filePath), aside[0]!)}; nothing else to say.`,
    ]);
});
test("quarantineUnreadableFile treats an already-gone file as clear to write", () => {
    const filePath = tempFile();
    assert.equal(quarantineUnreadableFile(filePath, { label: "test store", consequence: "n/a" }), true);
});
test("withFileLock runs the change under a lock and releases it, even when the change throws", () => {
    const filePath = tempFile();
    const lockPath = `${filePath}.lock`;
    assert.equal(runStoreLock(filePath, () => {
        assert.equal(fs.existsSync(lockPath), true, "the lock is held for the duration of the change");
        return "done";
    }), "done");
    assert.equal(fs.existsSync(lockPath), false);
    assert.throws(() => runStoreLock(filePath, () => {
        throw new Error("the change failed");
    }), /the change failed/);
    assert.equal(fs.existsSync(lockPath), false, "a failed change still releases the lock");
});
test("a lock held by a live process is waited for, then refused out loud — never broken", () => {
    const filePath = tempFile();
    const lockPath = `${filePath}.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, `${process.pid}:someoneelse`);
    assert.throws(() => runStoreLock(filePath, () => "never", { waitMs: 50 }), {
        message: `fixture desktop: ${lockPath} is still held by another Fixture process after 50ms, so this change was not saved. Nothing was written over. Try again, or quit the other Fixture window.`,
    });
    assert.equal(fs.readFileSync(lockPath, "utf8"), `${process.pid}:someoneelse`, "the live holder's lock is left exactly as it was");
});
test("a lock whose owner is gone, or that is older than any synchronous write could be, is taken over", () => {
    const abandoned = tempFile();
    fs.writeFileSync(`${abandoned}.lock`, `${deadPid()}:crashed`);
    assert.equal(runStoreLock(abandoned, () => "taken", { waitMs: 50 }), "taken");
    assert.equal(fs.existsSync(`${abandoned}.lock`), false);
    const stale = tempFile();
    const stalePath = `${stale}.lock`;
    fs.writeFileSync(stalePath, `${process.pid}:wedged`);
    const longAgo = new Date(Date.now() - 60000);
    fs.utimesSync(stalePath, longAgo, longAgo);
    assert.equal(runStoreLock(stale, () => "taken", { waitMs: 50 }), "taken");
});
test("releasing does not delete a lock that now belongs to someone else", () => {
    const filePath = tempFile();
    const lockPath = `${filePath}.lock`;
    runStoreLock(filePath, () => {
        // What a process that broke this lock as abandoned would leave behind.
        fs.writeFileSync(lockPath, "9999:theirs");
    });
    assert.equal(fs.readFileSync(lockPath, "utf8"), "9999:theirs");
});
test("salvageJsonPrefix recovers every element that ended before the damage, and nothing it cannot parse", () => {
    const whole = JSON.stringify({ rows: [{ dir: "/a" }, { dir: "/b" }], after: ["kept"] }, null, 2);
    assert.deepEqual(salvageJsonPrefix(whole.slice(0, whole.indexOf('"/b"') + 4)), { rows: [{ dir: "/a" }, { dir: "/b" }] });
    assert.deepEqual(salvageJsonPrefix(whole.slice(0, whole.indexOf('"/b"') + 2)), { rows: [{ dir: "/a" }] });
    assert.deepEqual(salvageJsonPrefix(whole), JSON.parse(whole));
    assert.equal(salvageJsonPrefix("not json at all"), undefined);
    assert.equal(salvageJsonPrefix(""), undefined);
});
test("salvageJsonPrefix is not fooled by brackets or escaped quotes inside strings", () => {
    const damaged = '{\n  "rows": [\n    { "dir": "/a}]{\\"x\\"" },\n    { "dir": "/b"';
    // Both rows come back: the second one's only field ended before the damage, so closing it there is
    // a faithful recovery, not a guess. The first proves the scan reads `}`, `]` and `{` inside a
    // string, and an escaped quote, as text rather than as structure.
    assert.deepEqual(salvageJsonPrefix(damaged), { rows: [{ dir: '/a}]{"x"' }, { dir: "/b" }] });
});

// REGRESSION: fails if durable JSON goes back to its internal non-exclusive w-mode writer.
test("durable JSON refuses an existing legacy temp and leaves both owners' bytes intact", () => {
    const filePath = tempFile(); fs.writeFileSync(filePath, "old");
    const temporary = tempPathFor(filePath); fs.writeFileSync(temporary, "other writer");
    assert.throws(() => writeStoreValue(filePath, { replacement: true }), error => typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST");
    assert.equal(fs.readFileSync(filePath, "utf8"), "old"); assert.equal(fs.readFileSync(temporary, "utf8"), "other writer");
});
// REGRESSION: fails if the canonical durable writer omits parent-directory fsync.
test("durable JSON flushes bytes before replacement and directory metadata afterwards", () => {
    const filePath = tempFile(), realSync = fs.fsyncSync;
    const descriptors: number[] = [];
    const sync = vi.spyOn(fs, "fsyncSync").mockImplementation(descriptor => { descriptors.push(fs.fstatSync(descriptor).isDirectory() ? 1 : 0); realSync(descriptor); });
    try { writeStoreValue(filePath, { retained: true }); assert.deepEqual(descriptors, [0, 1]); }
    finally { sync.mockRestore(); }
    assert.equal(fs.readFileSync(filePath, "utf8"), JSON.stringify({ retained: true }, null, 2));
});
