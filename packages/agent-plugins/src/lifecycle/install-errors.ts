/** One extraction/install failure reason. A caller (an admin route, a future marketplace installer)
 * branches on `code` rather than parsing `message` — this codebase's own convention
 * (`PluginLoadError.reason` in `plugin-runtime/loader.ts` is the direct precedent). */
export type AgentPluginInstallErrorCode =
  | "PLUGIN_ID_CONFLICT"
  | "ARCHIVE_TOO_LARGE"
  | "DIGEST_MISMATCH"
  | "TOO_MANY_ENTRIES"
  | "UNSAFE_ENTRY_PATH"
  | "SYMLINK_ENTRY_REJECTED"
  | "UNSUPPORTED_ENTRY_KIND"
  | "DUPLICATE_ENTRY"
  | "FILE_TOO_LARGE"
  | "DECOMPRESSION_BOMB"
  | "TOTAL_SIZE_EXCEEDED"
  | "MANIFEST_MISSING"
  | "MANIFEST_INVALID"
  | "PUBLISH_FAILED";

export class AgentPluginInstallError extends Error {
  readonly code: AgentPluginInstallErrorCode;

  constructor({ code, message }: { readonly code: AgentPluginInstallErrorCode; readonly message: string }, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "AgentPluginInstallError";
    this.code = code;
  }
}

