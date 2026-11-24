import type { SourceControlCredential } from "../../../source-control/models.js";

/**
 * @file The Git backup card's port onto the host's site-backup routes (plan, push) and
 * the Source Control connections list it reuses. Same `useX(dependencies)` split as
 * the site-transfer section, so the hook is tested against a fake. The live implementation
 * stays in the host, beside its admin HTTP client.
 */

/** What the plan route takes. Optional fields left out let the server pick (default branch, the
 *  site's folder name). */
export interface GitBackupPlanInput {
  credential: string;
  owner: string;
  repo: string;
  branch?: string;
}

/** A refusal from either route: the service's own code and message (the server backup service). */
export interface GitBackupRefusal {
  planned?: false;
  pushed?: false;
  code?: string;
  message?: string;
  reason?: "expired" | "abandoned";
  cancelled?: boolean;
}

/** The plan route's success: the facts shown before pushing. */
export interface GitBackupPlan {
  planned: true;
  planId: string;
  repository: string;
  branch: string;
  folder: string;
  folderExists: boolean;
  fileCount: number;
  totalSize: string;
  skipped: readonly unknown[];
}

export interface GitBackupProgress {
  filesDone: number;
  filesTotal: number;
}

export type GitBackupPushResult =
  | { pushed: true; commitUrl: string; repository: string }
  | { pushed: false; inProgress: true; planId: string; progress: GitBackupProgress }
  | GitBackupRefusal;

export interface GitBackupPort {
  /** Every saved Source Control connection (`GET …/system/source-control/credentials`). */
  listConnections(): Promise<readonly SourceControlCredential[]>;
  plan(input: GitBackupPlanInput, optional?: {}): Promise<GitBackupPlan | GitBackupRefusal>;
  /** Waits ~1.5 s server-side, then answers the outcome or the job's progress. */
  push(input: { planId: string }, optional?: {}): Promise<GitBackupPushResult>;
}

/** An in-memory {@link GitBackupPort} for tests. Unlisted calls reject, so a test that reaches one
 *  it did not describe fails loudly. */
export function createFakeGitBackupPort({ overrides = {} }: { overrides?: Partial<GitBackupPort> } = {}, _optional = {}): GitBackupPort {
  const unexpected = ({ name }: { name: string }, _options = {}) => () => Promise.reject(new Error(`${name} was not expected`));
  return {
    listConnections: () => Promise.resolve([]),
    plan: unexpected({ name: "plan" }),
    push: unexpected({ name: "push" }),
    ...overrides,
  };
}
