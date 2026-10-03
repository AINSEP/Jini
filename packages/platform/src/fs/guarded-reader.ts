import nodeFs from "node:fs";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
// A distinct refusal class lets tool adapters treat rejected paths/content as actionable input
// problems instead of redacting them as an internal crash.
/** Refusal of a malformed, denied, escaped, or over-limit file operation. */
export class FsFilePathError extends Error {
    constructor({ message }: {
        message: string;
    }) { super(message); this.name = "FsFilePathError"; }
}
export interface DenyRules {
    segments: ReadonlySet<string>;
    filenamePatterns: readonly RegExp[];
}
export interface GuardedReaderLimits {
    maxFileBytes: number;
    binarySniffBytes: number;
    maxListedFiles: number;
    maxWalkDepth: number;
    maxWalkEntries: number;
}
export type GuardedReaderFilesystem = Pick<typeof nodeFs, "existsSync" | "lstatSync" | "readdirSync" | "realpathSync" | "statSync" | "openSync" | "readSync" | "closeSync" | "createReadStream">;
/** Native filesystem adapter; callers can replace individual operations for a virtual filesystem. */
export function createNodeGuardedReaderFilesystem(_required: Record<string, never>): GuardedReaderFilesystem { return nodeFs; }
export interface GuardedFileReader {
    resolve(required: {
        relativePath: string;
    }): string;
    read(required: {
        relativePath: string;
    }): {
        content: string;
        bytes: number;
    };
    readBytes(required: {
        relativePath: string;
        maxBytes: number;
    }): Promise<Uint8Array>;
    list(required: Record<string, never>, optional?: {
        relativePath?: string;
    }): {
        files: string[];
        truncated: boolean;
    };
    isDeniedFileName(required: {
        fileName: string;
    }): boolean;
    isDeniedPathSegment(required: {
        segmentName: string;
    }): boolean;
}
/** Contains both requested and resolved paths, including symlink aliases and nonexistent descendants.
 * Deny rules and traversal/read limits are host policy and have no implicit defaults.
 */
export function createGuardedFileReader({ rootPath, denyRules, limits, filesystem: fs }: {
    rootPath: string;
    denyRules: DenyRules;
    limits: GuardedReaderLimits;
    filesystem: GuardedReaderFilesystem;
}, { excludedListingDirs = new Set(["node_modules", ".git", "dist"]) }: {
    excludedListingDirs?: ReadonlySet<string>;
} = {}): GuardedFileReader {
    if (!rootPath)
        throw new TypeError("rootPath is required");
    for (const value of Object.values(limits))
        if (!Number.isSafeInteger(value) || value <= 0)
            throw new TypeError("reader limits must be positive safe integers");
    const { existsSync, lstatSync, readdirSync, realpathSync, statSync } = fs;
    const MAX_FS_FILE_BYTES = limits.maxFileBytes, BINARY_SNIFF_BYTES = limits.binarySniffBytes;
    const MAX_LISTED_FILES = limits.maxListedFiles, MAX_WALK_DEPTH = limits.maxWalkDepth, MAX_WALK_ENTRIES = limits.maxWalkEntries;
    // Listing exclusions reduce noise; they never grant or deny a known file read. Security comes
    // from denyRules, applied to both the caller spelling and the effective target.
    const EXCLUDED_LISTING_DIR_NAMES = excludedListingDirs;
    function isDeniedFsFileName(fileName: string): boolean {
        const folded = foldFsNameForDenylist(fileName);
        return denyRules.filenamePatterns.some((pattern) => new RegExp(pattern).test(fileName) || new RegExp(pattern).test(folded));
    }
    function isDeniedFsPathSegment(segmentName: string): boolean {
        return denyRules.segments.has(segmentName.toLowerCase()) || denyRules.segments.has(foldFsNameForDenylist(segmentName));
    }
    // Default case-insensitive APFS can open LONG S/KELVIN SIGN aliases of denied names that plain
    // toLowerCase or non-Unicode /i misses. Windows also ignores trailing dots/spaces and opens
    // name::$DATA as name. Compare raw AND folded names: folding may add denials, never remove them,
    // and must not change the path actually opened.
    function foldFsNameForDenylist(name: string): string {
        const withoutStream = name.replace(/:[^]*$/, "");
        const withoutTrailing = withoutStream.replace(/[. ]+$/, "");
        return withoutTrailing.toLowerCase().toUpperCase().toLowerCase();
    }
    // Split both separator spellings even on a host whose native separator is '/', so deny checks
    // remain cross-platform. The guard and reader must resolve the same spelling consistently.
    function normalizeFsRelativePath(relativePath: string): string {
        const segments: string[] = [];
        for (const segment of relativePath.split(/[\\/]/)) {
            if (segment === "" || segment === ".")
                continue;
            if (segment === "..") {
                segments.pop();
                continue;
            }
            segments.push(segment);
        }
        return segments.join("/");
    }
    // A string prefix admits siblings whose names extend the root and ignores traversal. Resolve
    // first, then compare path.relative components; symlink containment needs its own check below.
    function isWithin(base: string, target: string): boolean {
        if (base === target)
            return true;
        const rel = relative(base, target);
        return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
    }
    // Probe the deepest existing ancestor: a nonexistent descendant can still sit beneath a
    // symlink that escapes the root, even when its lexical path passed containment.
    // Bound ancestor steps to four times the listing depth, plus the endpoint check, so deeply
    // nested missing paths cannot cause unbounded synchronous probes. Unknown containment refuses.
    function assertNoSymlinkEscape(base: string, path: string, relativePathForError: string): void {
        let probe = path;
        for (let i = 0; i < MAX_WALK_DEPTH * 4 && !existsSync(probe); i += 1) {
            const parent = dirname(probe);
            if (parent === probe)
                break;
            probe = parent;
        }
        if (!existsSync(probe))
            throw new FsFilePathError({ message: `path '${relativePathForError}' containment could not be established within the ancestor traversal limit` });
        const realProbe = realpathSync(probe);
        if (!isWithin(base, realProbe)) {
            throw new FsFilePathError({ message: `path '${relativePathForError}' resolves outside the allowed root through a symbolic link` });
        }
    }
    function resolveFsFilePath(required: {
        rootPath: string;
        relativePath: string;
    }): string {
        const { rootPath, relativePath } = required;
        assertWellFormedRelativePath(relativePath);
        assertRequestedPathNotDenied(relativePath);
        // Canonicalize a symlinked root too, or the ancestor's realpath would compare to a different
        // representation and refuse legitimate reads through a linked package/root.
        const base = existsSync(rootPath) ? realpathSync(rootPath) : resolve(rootPath);
        const target = resolve(base, relativePath);
        if (!isWithin(base, target)) {
            throw new FsFilePathError({ message: `path '${relativePath}' resolves outside the allowed root` });
        }
        assertNoSymlinkEscape(base, target, relativePath);
        assertEffectiveTargetNotDenied(base, target, relativePath);
        return target;
    }
    // Isolate initial shape refusals so resolve reads as the ordered sequence of containment and
    // deny checks, rather than burying that boundary in one long guard block.
    function assertWellFormedRelativePath(relativePath: string): void {
        if (relativePath.length === 0) {
            throw new FsFilePathError({ message: "path is required" });
        }
        if (relativePath.includes("\0")) {
            throw new FsFilePathError({ message: "path must not contain a NUL byte" });
        }
        if (isAbsolute(relativePath)) {
            throw new FsFilePathError({ message: `path '${relativePath}' must be relative to the root, not absolute` });
        }
    }
    // Refuse denied spellings before filesystem access, regardless of whether they exist. The
    // effective-target check is separate because a harmless alias can resolve to a denied file.
    function assertRequestedPathNotDenied(relativePath: string): void {
        const normalized = normalizeFsRelativePath(relativePath);
        const segments = normalized.length === 0 ? [] : normalized.split("/");
        for (const segment of segments) {
            if (isDeniedFsPathSegment(segment)) {
                throw new FsFilePathError({ message: `path '${relativePath}' contains a denied path segment ('${segment}') and cannot be accessed` });
            }
        }
        const leafName = segments.at(-1) ?? "";
        if (leafName.length > 0 && isDeniedFsFileName(leafName)) {
            throw new FsFilePathError({ message: `path '${relativePath}' matches a denied filename pattern and cannot be accessed` });
        }
    }
    // public.txt -> .env stays inside the root and passes lexical checks; Node follows it on read.
    // Deny the real target as well. existsSync excludes broken/circular links before realpath, and
    // the subsequent stat translates their failure into this reader's own refusal class.
    function assertEffectiveTargetNotDenied(base: string, target: string, relativePath: string): void {
        if (!existsSync(target))
            return;
        const effectiveSegments = relative(base, realpathSync(target)).split(sep);
        for (const segment of effectiveSegments) {
            if (isDeniedFsPathSegment(segment)) {
                throw new FsFilePathError({ message: `path '${relativePath}' resolves to a denied path segment ('${segment}') and cannot be accessed` });
            }
        }
        // A target equal to base yields [""] after split, so check leaf length, not array length.
        const effectiveLeaf = effectiveSegments.at(-1) ?? "";
        if (effectiveLeaf.length > 0 && isDeniedFsFileName(effectiveLeaf)) {
            throw new FsFilePathError({ message: `path '${relativePath}' resolves to a denied filename pattern and cannot be accessed` });
        }
    }
    function visitFsDirEntry(dir: string, name: string, depth: number, base: string, found: string[], state: FsWalkState): void {
        const full = resolve(dir, name);
        // lstat examines the link itself: stat would follow circular links and throw ELOOP before
        // the skip. Never enumerate/report links or descend denied directories, so listings do not
        // advertise secrets or anything outside the root. Ordinary excluded directories are noise.
        const stat = lstatSync(full, { throwIfNoEntry: false });
        if (!stat)
            return;
        if (stat.isSymbolicLink())
            return;
        if (stat.isDirectory()) {
            if (isDeniedFsPathSegment(name) || EXCLUDED_LISTING_DIR_NAMES.has(name))
                return;
            walkFsDir(full, depth + 1, base, found, state);
            return;
        }
        if (!stat.isFile())
            return;
        if (isDeniedFsFileName(name))
            return;
        found.push(relative(base, full).split(sep).join("/"));
    }
    interface FsWalkState {
        remaining: number;
        truncated: boolean;
    }
    // Results, entries, and depth are independent limits; keep the decision shared by entry and
    // loop checks so adding one limit cannot leave an unbounded arm.
    function walkBoundReached(found: string[], state: FsWalkState, depth: number): boolean {
        return depth > MAX_WALK_DEPTH || found.length >= MAX_LISTED_FILES || state.remaining <= 0;
    }
    function walkFsDir(dir: string, depth: number, base: string, found: string[], state: FsWalkState): void {
        if (walkBoundReached(found, state, depth)) {
            state.truncated = true;
            return;
        }
        for (const name of readdirSync(dir)) {
            // Recheck per entry: this loop spends traversal budget and adds results. Remaining
            // entries mean a bound must set truncated rather than present a short list as complete.
            if (walkBoundReached(found, state, depth)) {
                state.truncated = true;
                return;
            }
            state.remaining -= 1;
            visitFsDirEntry(dir, name, depth, base, found, state);
        }
    }
    interface ListFsFilesResult {
        readonly files: string[];
        // Ignoring this flag presents an incomplete listing as the whole directory.
        readonly truncated: boolean;
    }
    function listFsFiles(required: {
        rootPath: string;
        relativePath?: string;
    }): ListFsFilesResult {
        const { rootPath } = required;
        const relativePath = required.relativePath ?? "";
        const startDir = relativePath.length === 0 ? resolve(rootPath) : resolveFsFilePath({ rootPath, relativePath });
        // Freshly provisioned roots/subdirectories may not exist yet; an empty listing is valid.
        if (!existsSync(startDir))
            return { files: [], truncated: false };
        const startStat = statOrFsPathError(startDir, relativePath || ".");
        if (!startStat)
            return { files: [], truncated: false };
        if (!startStat.isDirectory()) {
            throw new FsFilePathError({ message: `path '${relativePath || "."}' is not a directory` });
        }
        const base = realpathSync(startDir);
        const found: string[] = [];
        const state: FsWalkState = { remaining: MAX_WALK_ENTRIES, truncated: false };
        walkFsDir(base, 0, base, found, state);
        // Paths are relative to the requested walk base, so a subdirectory listing can be consumed
        // without stripping that subdirectory's prefix a second time.
        return { files: found.sort(), truncated: state.truncated };
    }
    // Circular-link ELOOP and other filesystem exceptions must become the reader's refusal class,
    // not escape raw while an ordinary missing path is represented by undefined.
    function statOrFsPathError(target: string, relativePath: string): Stats | undefined {
        try {
            return statSync(target, { throwIfNoEntry: false });
        }
        catch (err) {
            throw new FsFilePathError({ message: `path '${relativePath}' could not be read: ${err instanceof Error ? err.message : String(err)}` });
        }
    }
    // A bounded leading-NUL heuristic keeps binary databases/images/archives out of inline UTF-8
    // model input without making type sniffing proportional to the full file size.
    function looksBinary(buffer: Buffer): boolean {
        const sniffLength = Math.min(buffer.length, BINARY_SNIFF_BYTES);
        for (let i = 0; i < sniffLength; i += 1) {
            if (buffer[i] === 0)
                return true;
        }
        return false;
    }
    interface ReadFsFileResult {
        readonly content: string;
        readonly bytes: number;
    }
    function readFsFile(required: {
        rootPath: string;
        relativePath: string;
    }): ReadFsFileResult {
        const target = resolveFsFilePath(required);
        const stat = statOrFsPathError(target, required.relativePath);
        if (!stat)
            throw new FsFilePathError({ message: `file '${required.relativePath}' does not exist` });
        if (!stat.isFile())
            throw new FsFilePathError({ message: `path '${required.relativePath}' is not a regular file` });
        if (stat.size > MAX_FS_FILE_BYTES) {
            throw new FsFilePathError({ message: `file '${required.relativePath}' exceeds the ${MAX_FS_FILE_BYTES}-byte readable limit` });
        }
        const fd = fs.openSync(target, "r");
        let buffer: Buffer;
        try {
            const bounded = Buffer.alloc(MAX_FS_FILE_BYTES + 1);
            let count = 0;
            while (count < bounded.length) {
                const read = fs.readSync(fd, bounded, count, bounded.length - count, null);
                if (read === 0)
                    break;
                count += read;
            }
            if (count > MAX_FS_FILE_BYTES)
                throw new FsFilePathError({ message: `file '${required.relativePath}' exceeds the ${MAX_FS_FILE_BYTES}-byte readable limit` });
            buffer = bounded.subarray(0, count);
        }
        finally {
            fs.closeSync(fd);
        }
        if (looksBinary(buffer)) {
            throw new FsFilePathError({ message: `file '${required.relativePath}' looks like a binary file and cannot be read as text` });
        }
        return { content: buffer.toString("utf8"), bytes: buffer.byteLength };
    }
    // A stat-only size check can be bypassed by a growing file: bound the stream independently and
    // reject rather than return a clipped image/video. Destroy the stream on success or failure.
    async function openFsFileForRead(required: {
        rootPath: string;
        relativePath: string;
        maxBytes: number;
    }): Promise<Uint8Array> {
        const { relativePath, maxBytes } = required;
        if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
            throw new FsFilePathError({ message: "maxBytes must be a positive safe integer" });
        }
        const target = resolveFsFilePath(required);
        const stat = statOrFsPathError(target, relativePath);
        if (!stat)
            throw new FsFilePathError({ message: `file '${relativePath}' does not exist` });
        if (!stat.isFile())
            throw new FsFilePathError({ message: `path '${relativePath}' is not a regular file` });
        if (stat.size > maxBytes) {
            throw new FsFilePathError({ message: `file '${relativePath}' is ${stat.size} bytes and exceeds the ${maxBytes}-byte import limit` });
        }
        const stream = fs.createReadStream(target, { highWaterMark: Math.min(64 * 1024, maxBytes + 1) });
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        try {
            for await (const chunk of stream) {
                const bytes = chunk as Buffer;
                totalBytes += bytes.byteLength;
                if (totalBytes > maxBytes) {
                    throw new FsFilePathError({ message: `file '${relativePath}' is at least ${totalBytes} bytes and exceeds the ${maxBytes}-byte import limit` });
                }
                chunks.push(bytes);
            }
            return Buffer.concat(chunks, totalBytes);
        }
        catch (error) {
            if (error instanceof FsFilePathError)
                throw error;
            throw new FsFilePathError({ message: `path '${relativePath}' could not be read: ${error instanceof Error ? error.message : String(error)}` });
        }
        finally {
            stream.destroy();
        }
    }
    return {
        resolve: ({ relativePath }) => resolveFsFilePath({ rootPath, relativePath }),
        read: ({ relativePath }) => readFsFile({ rootPath, relativePath }),
        readBytes: ({ relativePath, maxBytes }) => openFsFileForRead({ rootPath, relativePath, maxBytes }),
        list: (_required, optional = {}) => listFsFiles({ rootPath, ...optional }),
        isDeniedFileName: ({ fileName }) => isDeniedFsFileName(fileName),
        isDeniedPathSegment: ({ segmentName }) => isDeniedFsPathSegment(segmentName),
    };
}
