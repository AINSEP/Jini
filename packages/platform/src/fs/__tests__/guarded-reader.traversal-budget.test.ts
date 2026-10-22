import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test, vi } from "vitest";
import { createGuardedFileReader, createNodeGuardedReaderFilesystem, FsFilePathError } from "../guarded-reader.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});

function fixture(maxWalkDepth: number) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guarded-reader-budget-"));
    temporaryDirectories.push(directory);
    // Canonicalize the temporary directory for hosts where the temp path itself is a symlink.
    const rootPath = path.join(fs.realpathSync(directory), "root");
    fs.mkdirSync(rootPath);
    const filesystem = { ...createNodeGuardedReaderFilesystem({}) };
    const operations = {
        existsSync: vi.spyOn(filesystem, "existsSync"),
        realpathSync: vi.spyOn(filesystem, "realpathSync"),
        statSync: vi.spyOn(filesystem, "statSync"),
        openSync: vi.spyOn(filesystem, "openSync"),
        createReadStream: vi.spyOn(filesystem, "createReadStream"),
    };
    const reader = createGuardedFileReader({
        rootPath,
        denyRules: { segments: new Set<string>(), filenamePatterns: [] },
        limits: { maxFileBytes: 1024, binarySniffBytes: 128, maxListedFiles: 10, maxWalkDepth, maxWalkEntries: 100 },
        filesystem,
    });
    return { rootPath, operations, reader };
}

function missingPath(depth: number): string {
    return Array.from({ length: depth }, (_, index) => `missing-${index}`).join("/");
}

function containmentRefusal(relativePath: string) {
    return (error: unknown): boolean => {
        assert.ok(error instanceof FsFilePathError);
        assert.equal(error.message, `path '${relativePath}' containment could not be established within the ancestor traversal limit`);
        return true;
    };
}

for (const maxWalkDepth of [1, 2, 12]) {
    test(`refuses unresolved containment after ${maxWalkDepth * 4} ancestor steps`, () => {
        const { rootPath, operations, reader } = fixture(maxWalkDepth);
        const budget = maxWalkDepth * 4;
        const relativePath = missingPath(budget + 1);

        assert.throws(() => reader.resolve({ relativePath }), containmentRefusal(relativePath));
        // The root canonicalization is separate. Ancestor probing checks each step and the
        // endpoint, but must never continue to the known root beyond the traversal budget.
        assert.equal(operations.existsSync.mock.calls.length, budget + 2);
        assert.equal(operations.existsSync.mock.calls.at(-1)?.[0], path.join(rootPath, "missing-0"));
        assert.equal(operations.realpathSync.mock.calls.length, 1);
        assert.equal(operations.statSync.mock.calls.length, 0);
        assert.equal(operations.openSync.mock.calls.length, 0);
        assert.equal(operations.createReadStream.mock.calls.length, 0);
    });

    test(`accepts containment established on the final ${maxWalkDepth * 4}th ancestor step`, () => {
        const { rootPath, reader } = fixture(maxWalkDepth);
        const relativePath = missingPath(maxWalkDepth * 4);

        assert.equal(reader.resolve({ relativePath }), path.resolve(rootPath, relativePath));
    });
}

test("refuses a symlink escape discovered on the final ancestor step", () => {
    const { rootPath, reader } = fixture(1);
    const outside = path.join(path.dirname(rootPath), "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(rootPath, "escape"));
    const relativePath = `escape/${missingPath(4)}`;

    assert.throws(() => reader.resolve({ relativePath }), (error: unknown) => {
        assert.ok(error instanceof FsFilePathError);
        assert.equal(error.message, `path '${relativePath}' resolves outside the allowed root through a symbolic link`);
        return true;
    });
});

test("fails closed when the filesystem cannot establish any existing ancestor", () => {
    const { operations, reader } = fixture(12);
    // A virtual/unavailable filesystem can report even its filesystem root as nonexistent.
    // Reaching that root must not silently grant containment or attempt realpath on it.
    operations.existsSync.mockImplementation(() => false);

    assert.throws(() => reader.resolve({ relativePath: "missing.txt" }), containmentRefusal("missing.txt"));
    assert.equal(operations.realpathSync.mock.calls.length, 0);
    assert.equal(operations.statSync.mock.calls.length, 0);
});

for (const operation of ["read", "readBytes", "list"] as const) {
    test(`${operation} refuses over-budget containment before accessing content`, async () => {
        const { operations, reader } = fixture(1);
        const relativePath = missingPath(5);

        if (operation === "readBytes")
            await assert.rejects(() => reader.readBytes({ relativePath, maxBytes: 1024 }), containmentRefusal(relativePath));
        else if (operation === "read")
            assert.throws(() => reader.read({ relativePath }), containmentRefusal(relativePath));
        else
            assert.throws(() => reader.list({}, { relativePath }), containmentRefusal(relativePath));

        assert.equal(operations.existsSync.mock.calls.length, 6);
        assert.equal(operations.statSync.mock.calls.length, 0);
        assert.equal(operations.openSync.mock.calls.length, 0);
        assert.equal(operations.createReadStream.mock.calls.length, 0);
    });
}
