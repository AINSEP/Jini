/** Shared guarded-reader contracts and refusal identity; native filesystem effects remain in platform. */
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
