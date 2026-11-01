export interface NpmPackEntry { filename: string; files?: { path: string }[] }
/** Reads `npm pack --json` for one package in both the npm 11 (array) and npm 12 (keyed object) shapes. */
export declare function parseNpmPackJson(required: { stdout: string }): NpmPackEntry;
