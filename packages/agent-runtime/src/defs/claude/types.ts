export interface ClaudeRuntimeBuildOptions {
  /** Executor-created per-run CLAUDE_CODE_TMPDIR; its /claude-<uid> child must fit 44 bytes. Absent grants no runtime scratch. */
  filesystemRuntimeTempBase?: string;
}
