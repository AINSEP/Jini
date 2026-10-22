import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi, afterEach } from "vitest";
afterEach(() => vi.restoreAllMocks());
import { createGuardedFileReader, createNodeGuardedReaderFilesystem, FsFilePathError } from "../guarded-reader.js";
const MAX_FS_FILE_BYTES = 1000000;
const denyRules = { segments: new Set(["secrets", ".aws", ".docker", ".kube", "gcloud", "gh", ".hostvault"]), filenamePatterns: [
        /^\.env(?:\..*)?$/i,
        /\.pem$/i,
        /\.key$/i,
        /\.p12$/i,
        /\.db$/i,
        /\.db-wal$/i,
        /\.db-shm$/i,
        /^\.mcp(?:\..*)?\.json$/i,
        /\.(?:crt|cer|cert|pfx|jks|keystore|jwk|jwks)$/i,
        /^\.(?:npmrc|netrc)$/i,
        /^id_(?:rsa|dsa|ecdsa|ed25519).*(?<!\.pub)$/i,
        /^credentials\.json$/i,
        /^credentials$/i,
        /^client_secret.*\.json$/i,
        /^\.git-credentials$/i,
        /root-key.*\.hex$/i,
        /^\.credentials\.json$/i,
        /^\.(?:bash_profile|bashrc|bash_login|zshrc|zprofile|zshenv|zlogin|profile)$/i,
        /^\.?\.storage-secret\.json(?:\..*)?$/i,
    ] as readonly RegExp[], };
const limits = { maxFileBytes: MAX_FS_FILE_BYTES, binarySniffBytes: 8000, maxListedFiles: 2000, maxWalkDepth: 12, maxWalkEntries: 20000 };
function reader(rootPath: string) { return createGuardedFileReader({ rootPath, denyRules, limits, filesystem: createNodeGuardedReaderFilesystem({}) }); }
function resolveFsFilePath(input: {
    rootPath: string;
    relativePath: string;
}) { return reader(input.rootPath).resolve({ relativePath: input.relativePath }); }
function readFsFile(input: {
    rootPath: string;
    relativePath: string;
}) { return reader(input.rootPath).read({ relativePath: input.relativePath }); }
function listFsFiles(input: {
    rootPath: string;
    relativePath?: string;
}) { return reader(input.rootPath).list({}, input.relativePath === undefined ? {} : { relativePath: input.relativePath }); }
function isDeniedFsFileName(fileName: string) { return reader("/unused").isDeniedFileName({ fileName }); }
function isDeniedFsPathSegment(segmentName: string) { return reader("/unused").isDeniedPathSegment({ segmentName }); }
/** t06: real filesystem boundary tests; only stream creation is tapped to control a growth race. */
function fixture(t: unknown) {
    const parent = fs.mkdtempSync(path.join(tmpdir(), "t06-read-"));
    const rootPath = path.join(parent, "root");
    fs.mkdirSync(rootPath);
    afterEach(() => { vi.restoreAllMocks(); fs.rmSync(parent, { recursive: true, force: true }); });
    return { parent, rootPath };
}
function read(input: {
    rootPath: string;
    relativePath: string;
    maxBytes: number;
}) {
    return reader(input.rootPath).readBytes({ relativePath: input.relativePath, maxBytes: input.maxBytes });
}
function refused(message: string) {
    return (error: unknown) => {
        assert.ok(error instanceof FsFilePathError, `expected FsFilePathError, received ${error instanceof Error ? error.name : typeof error}`);
        assert.equal(error.message, message);
        return true;
    };
}
test("binary read preserves bytes at the exact cap and permits files above the text-read cap", async (t) => {
    const { rootPath } = fixture(t);
    const bytes = Buffer.alloc(MAX_FS_FILE_BYTES + 1, 0xa3);
    fs.writeFileSync(path.join(rootPath, "large.mp4"), bytes);
    assert.deepEqual(Buffer.from(await read({ rootPath, relativePath: "large.mp4", maxBytes: bytes.length })), bytes);
});
const DENIALS = [
    ["../outside.png", "path '../outside.png' resolves outside the allowed root"],
    [".env", "path '.env' matches a denied filename pattern and cannot be accessed"],
    ["content.db", "path 'content.db' matches a denied filename pattern and cannot be accessed"],
    ["secrets/photo.png", "path 'secrets/photo.png' contains a denied path segment ('secrets') and cannot be accessed"],
    ["", "path is required"],
    ["bad\0.png", "path must not contain a NUL byte"],
] as const;
for (const [relativePath, message] of DENIALS) {
    test(`refuses ${JSON.stringify(relativePath)} before opening a read stream`, async (t) => {
        const { rootPath } = fixture(t);
        if (relativePath && !relativePath.includes("\0")) {
            const target = path.join(rootPath, relativePath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, Buffer.from([0, 1, 0xff]));
        }
        const streamSpy = vi.spyOn(fs, "createReadStream");
        const syncReadSpy = vi.spyOn(fs, "readFileSync");
        await assert.rejects(async () => read({ rootPath, relativePath: relativePath!, maxBytes: 32 }), refused(message!));
        assert.equal(streamSpy.mock.calls.length, 0);
        assert.equal(syncReadSpy.mock.calls.length, 0);
    });
}
test("absolute and symlink escapes reuse fs_read_file's exact refusal before reading", async (t) => {
    const { parent, rootPath } = fixture(t);
    const outside = path.join(parent, "outside.png");
    fs.writeFileSync(outside, Buffer.from([0, 1, 2]));
    fs.symlinkSync(outside, path.join(rootPath, "alias.png"));
    const streamSpy = vi.spyOn(fs, "createReadStream");
    await assert.rejects(async () => read({ rootPath, relativePath: outside, maxBytes: 32 }), refused(`path '${outside}' must be relative to the root, not absolute`));
    await assert.rejects(async () => read({ rootPath, relativePath: "alias.png", maxBytes: 32 }), refused("path 'alias.png' resolves outside the allowed root through a symbolic link"));
    assert.equal(streamSpy.mock.calls.length, 0);
});
test("symlinks to denied files and directories inside the root are refused before reading", async (t) => {
    const { rootPath } = fixture(t);
    fs.writeFileSync(path.join(rootPath, ".env"), "secret");
    fs.mkdirSync(path.join(rootPath, "secrets"));
    fs.writeFileSync(path.join(rootPath, "secrets", "photo.png"), "secret");
    fs.symlinkSync(path.join(rootPath, ".env"), path.join(rootPath, "photo.png"));
    fs.symlinkSync(path.join(rootPath, "secrets"), path.join(rootPath, "public"));
    const streamSpy = vi.spyOn(fs, "createReadStream");
    await assert.rejects(async () => read({ rootPath, relativePath: "photo.png", maxBytes: 32 }), refused("path 'photo.png' resolves to a denied filename pattern and cannot be accessed"));
    await assert.rejects(async () => read({ rootPath, relativePath: "public/photo.png", maxBytes: 32 }), refused("path 'public/photo.png' resolves to a denied path segment ('secrets') and cannot be accessed"));
    assert.equal(streamSpy.mock.calls.length, 0);
});
test("stat rejects an over-cap file, naming size and cap, before creating a stream", async (t) => {
    const { rootPath } = fixture(t);
    fs.writeFileSync(path.join(rootPath, "big.mp4"), Buffer.alloc(33));
    const streamSpy = vi.spyOn(fs, "createReadStream");
    await assert.rejects(async () => read({ rootPath, relativePath: "big.mp4", maxBytes: 32 }), refused("file 'big.mp4' is 33 bytes and exceeds the 32-byte import limit"));
    assert.equal(streamSpy.mock.calls.length, 0);
});
test("a real file growing after stat is aborted once the streamed bytes exceed the cap", async (t) => {
    const { rootPath } = fixture(t);
    const target = path.join(rootPath, "growing.mp4");
    fs.writeFileSync(target, Buffer.alloc(16));
    const original = fs.createReadStream;
    let stream: fs.ReadStream | undefined;
    vi.spyOn(fs, "createReadStream").mockImplementation((...args: Parameters<typeof original>) => {
        fs.appendFileSync(target, Buffer.alloc(17)); // deterministic: stat completed, no byte read yet
        stream = original(...args);
        return stream;
    });
    await assert.rejects(async () => read({ rootPath, relativePath: "growing.mp4", maxBytes: 32 }), refused("file 'growing.mp4' is at least 33 bytes and exceeds the 32-byte import limit"));
    assert.ok(stream);
    assert.equal(stream.destroyed, true);
});
for (const [relativePath, message] of [["missing.png", "file 'missing.png' does not exist"], [".", "path '.' is not a regular file"]]) {
    test(`refuses ${relativePath} without a regular file`, async (t) => {
        const { rootPath } = fixture(t);
        await assert.rejects(async () => read({ rootPath, relativePath: relativePath!, maxBytes: 32 }), refused(message!));
    });
}
test("a symlink to an allowed file inside the root preserves its binary bytes", async (t) => {
    const { rootPath } = fixture(t);
    const bytes = Buffer.from([0, 1, 2, 0xff]);
    fs.writeFileSync(path.join(rootPath, "photo.png"), bytes);
    fs.symlinkSync(path.join(rootPath, "photo.png"), path.join(rootPath, "alias.png"));
    assert.deepEqual(Buffer.from(await read({ rootPath, relativePath: "alias.png", maxBytes: 4 })), bytes);
});
test("a circular symlink preserves the text reader's typed stat refusal", async (t) => {
    const { rootPath } = fixture(t);
    fs.symlinkSync("loop.png", path.join(rootPath, "loop.png"));
    const target = path.join(fs.realpathSync(rootPath), "loop.png");
    const message = `path 'loop.png' could not be read: ELOOP: too many symbolic links encountered, stat '${target}'`;
    assert.throws(() => readFsFile({ rootPath, relativePath: "loop.png" }), refused(message!));
    const streamSpy = vi.spyOn(fs, "createReadStream");
    await assert.rejects(() => read({ rootPath, relativePath: "loop.png", maxBytes: 32 }), refused(message!));
    assert.equal(streamSpy.mock.calls.length, 0);
});
test("a stream read failure becomes a typed refusal and closes the stream", async (t) => {
    const { rootPath } = fixture(t);
    const target = path.join(rootPath, "vanished.png");
    fs.writeFileSync(target, Buffer.from([1, 2, 3]));
    const original = fs.createReadStream;
    let stream: fs.ReadStream | undefined;
    vi.spyOn(fs, "createReadStream").mockImplementation((...args: Parameters<typeof original>) => {
        // Remove it after stat and before open: a real filesystem failure, without a timing race.
        fs.unlinkSync(target);
        stream = original(...args);
        return stream;
    });
    const resolvedTarget = path.join(fs.realpathSync(rootPath), "vanished.png");
    await assert.rejects(() => read({ rootPath, relativePath: "vanished.png", maxBytes: 32 }), refused(`path 'vanished.png' could not be read: ENOENT: no such file or directory, open '${resolvedTarget}'`));
    assert.ok(stream);
    assert.equal(stream.destroyed, true);
});
for (const maxBytes of [0, -1, 1.5, NaN, Infinity]) {
    test(`invalid binary read cap ${maxBytes} is refused before opening a stream`, async (t) => {
        const { rootPath } = fixture(t);
        fs.writeFileSync(path.join(rootPath, "photo.png"), Buffer.from([1]));
        const streamSpy = vi.spyOn(fs, "createReadStream");
        await assert.rejects(async () => read({ rootPath, relativePath: "photo.png", maxBytes }), refused("maxBytes must be a positive safe integer"));
        assert.equal(streamSpy.mock.calls.length, 0);
    });
}
