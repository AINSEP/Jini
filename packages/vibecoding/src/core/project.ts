import type { EditHistory } from './history.js';
import type { EditTarget } from './target.js';
import type { ApplyOutcome } from './types.js';
import type { ProposedEdit } from './apply.js';

/** Creates name a relative path; existing files use the same canonical path as PartId. */
export type FileChange =
  | { readonly op: 'create'; readonly relativePath: string; readonly content: string }
  | { readonly op: 'replace'; readonly id: string; readonly content: string }
  | { readonly op: 'delete'; readonly id: string };
export interface RevisionToken {
  readonly revisionId: string;
  readonly generation: number;
}
export interface ProjectDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly relativePath?: string;
}
/** Byte reads return copies, so a validator cannot mutate the eventual commit. */
export interface ProjectCandidate {
  readonly paths: readonly string[];
  readBytes(input: { readonly relativePath: string }, options?: Record<string, never>): Promise<Uint8Array>;
}
export interface ProjectValidator {
  validate(input: { readonly candidate: ProjectCandidate; readonly signal: AbortSignal }, options?: Record<string, never>): Promise<{
    readonly ok: boolean;
    readonly diagnostics?: readonly ProjectDiagnostic[];
  }>;
}
export type ProjectErrorCode = 'CONFLICT' | 'INVALID_PATH' | 'INVALID_CHANGE' | 'LIMIT' |
  'CANCELLED' | 'VALIDATION' | 'STORAGE' | 'CORRUPT' | 'CLOSED' | 'SNAPSHOT_EXPIRED';
/** Stable project-boundary errors; native causes remain available to the host. */
export class ProjectError extends Error {
  constructor(input: { code: ProjectErrorCode; message: string; cause?: unknown }) {
    super(input.message, { cause: input.cause });
    this.name = 'ProjectError';
    this.code = input.code;
  }
  readonly code: ProjectErrorCode;
}
export interface ProjectLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTreeBytes: number;
  readonly maxDepth: number;
  readonly maxChanges: number;
  readonly validationTimeoutMs: number;
}
export type TurnResult = {
  readonly status: 'committed' | 'unchanged' | 'rejected';
  readonly revision: RevisionToken;
  readonly diagnostics: readonly ProjectDiagnostic[];
};
export interface ProjectSnapshot { readonly revisionId: string }
export interface FileTreeProject {
  readonly target: EditTarget;
  readonly history: EditHistory;
  getRevision(): Promise<RevisionToken>;
  /** Captures external edits as an ordinary undoable revision, without rewriting the tree. */
  capture(): Promise<RevisionToken>;
  applyTurn(input: { readonly expectedRevision: RevisionToken; readonly changes: readonly FileChange[] },
    options?: { readonly label?: string; readonly signal?: AbortSignal }): Promise<TurnResult>;
  /** Session adapter: replacements share the same whole-candidate validation and history. */
  applyEdits(input: { readonly edits: readonly ProposedEdit[] }, options?: { readonly label?: string }): Promise<readonly ApplyOutcome[]>;
  snapshot(): Promise<ProjectSnapshot>;
  restore(input: { readonly snapshot: ProjectSnapshot }, options?: { readonly label?: string }): Promise<RevisionToken>;
  close(): Promise<void>;
}
