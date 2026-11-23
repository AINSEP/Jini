/** Debt file JSON at the trusted base commit, or null when the base has no such file yet. Throws when unreadable. */
export declare function debtAtBase(required: { root: string; file: string }, optional?: { baseRef?: string; firstCommit?: string }): unknown;
/** The trusted base commit SHA (zero ref falls back to the first push commit's parent). Throws when unresolvable. */
export declare function baseCommit(required: { root: string }, optional?: { baseRef?: string; firstCommit?: string }): string;
/** A file's text at a commit, or undefined when absent. */
export declare function fileAtCommit(required: { root: string; commit: string; file: string }): string | undefined;
