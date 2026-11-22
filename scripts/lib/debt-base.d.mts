/** Debt file JSON at the trusted base commit, or null when the base has no such file yet. Throws when unreadable. */
export declare function debtAtBase(required: { root: string; file: string }, optional?: { baseRef?: string; firstCommit?: string }): unknown;
