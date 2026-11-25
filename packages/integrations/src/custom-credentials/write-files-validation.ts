import { isNonArrayRecord } from "@jini-ai/core";

import { CustomCredentialValidationError } from "../credentialed-http/sets/store.js";

/**
 * @file Shape/path/size validation for `custom_credential_write_files` — every check here runs
 * BEFORE the credential is resolved or any network call is made, mirroring this domain's own
 * established ordering (`tool-registrations.ts`'s `rejectUnexpectedSetTokenFields`/
 * `requireUsernameOrClearSentinel` both run before `requireToolPermission`/any I/O) and
 * `Jini packages/agent-plugins/src/lifecycle/package-paths.ts`'s "cheap majority of attempts caught before any
 * filesystem call" split.
 *
 * Owner and repo are the one exception to "before the credential is resolved": their rules belong to
 * the git host (`repositoryTargetError` in `@jini-ai/devops/source-control`: the host plugin's own
 * `validateTarget`, then a generic one-path-segment rule), and the host is known only from the saved
 * credential's base URL. So {@link validateRepositoryTarget} runs once the caller has picked the
 * provider from that URL, still before any decrypt, network call or dialog.
 *
 * `BRANCH_PATTERN`/`MAX_COMMIT_MESSAGE_LENGTH` are byte-identical to
 * `features/source-control/commit-site.ts`'s own constants of the same name — copied, not imported,
 * per this codebase's established convention for a tiny cross-feature constant.
 *
 * The path-safety rule set is the LEXICAL half of `package-paths.ts`'s `normalizePackageEntryPath`
 * (reject NUL, absolute paths, a Windows drive prefix, `..` segments) — never its filesystem half
 * (`assertContainedOnDisk`'s `realpath` containment check), because there is no local filesystem
 * write here to protect: every validated path becomes a `path` field in a git-tree entry on the host, a
 * remote API call this process never resolves against its own disk. One rule has no
 * `package-paths.ts` analog: a normalized path that IS (or is nested under) `.git` — case-insensitively
 * — is refused outright. That directory name is git's own reserved metadata location; committing a
 * tracked FILE at a path like `.git/config` or `.GIT/hooks/pre-commit` is exactly the shape of the
 * case-insensitive-filesystem `.git` collision class git itself started refusing at clone/checkout
 * time (CVE-2021-21300 and related) — refusing it here, at write time, is cheap and closes the same
 * hole from the other direction for any client that has not been patched.
 */

/** Git branch name — permissive (real branch names allow far more), but refuses whitespace/control
 *  characters before the value reaches a URL path segment. */
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,250}$/;
const MAX_COMMIT_MESSAGE_LENGTH = 500;

/**
 * Bounds on one `custom_credential_write_files` call. Concrete numbers, each justified rather than
 * left unbounded (an operator-controlled write into a real repository must never be unbounded — same
 * reasoning `agent-plugins/install.ts`'s own `LIMITS` gives for its structurally identical problem):
 *
 * - `maxFiles`: the confirmation dialog this tool opens (`file-write confirmation`) lists
 *   every path by name so a human can actually read and approve each one before anything is written;
 *   past a few dozen rows that review stops being real. The one caller that exists today (a
 *   bundled hosting plugin's skill) writes exactly 2 files. 25 is generous headroom above that for any plausible
 *   future caller while keeping the dialog reviewable.
 * - `maxPathLength`: far beyond any real repository path, while still bounding one hostile field.
 * - `maxFileBytes`: every known caller writes small hand-authored or LLM-authored text config
 *   (a platform config file, a GitHub Actions workflow YAML) — 1 MiB is generous for that class of file while
 *   keeping a single blob-creation request body bounded.
 * - `maxTotalBytes`: bounds the call's AGGREGATE payload independent of how the per-file cap is
 *   split across files — the same "per-item cap AND total cap" shape `agent-plugins/install.ts`'s
 *   `maxFileBytes`/`maxTotalExtractedBytes` pair uses for the identical reason.
 */
export const WRITE_FILES_LIMITS = {
  maxFiles: 25,
  maxPathLength: 1024,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 4 * 1_048_576,
} as const;

/** One validated, normalized file this call will write. */
export interface NormalizedWriteFile {
  readonly path: string;
  readonly content: string;
}

/** The host-independent half {@link validateWriteFilesInput} returns. */
export interface WriteFilesRequest {
  readonly branch: string;
  readonly commitMessage: string;
  readonly files: readonly NormalizedWriteFile[];
}

/** The fully validated call: {@link WriteFilesRequest} plus the {@link validateRepositoryTarget} target. */
export interface ValidatedWriteFilesInput extends WriteFilesRequest {
  readonly owner: string;
  readonly repo: string;
}

/**
 * Owner and repo for the git host that will receive the write: the host's own rules (its plugin
 * module's `validateTarget`, e.g. "invalid GitHub owner 'x'"), then the generic one-path-segment
 * rule. See this file's header for why this runs after the provider is picked.
 *
 * @throws {CustomCredentialValidationError} Either value is not a string or fails a rule.
 * @complexity O(1).
 */
export function validateRepositoryTarget(target: {
  owner: unknown; repo: unknown;
  repositoryTargetError: (required: { owner: string; repo: string }, optional?: { validateTarget?: (required: { owner: string; repo: string }) => string | null }) => string | null;
}, { validateTarget }: { validateTarget?: (required: { owner: string; repo: string }) => string | null } = {}): { owner: string; repo: string } {
  if (typeof target.owner !== "string") throw new CustomCredentialValidationError(`invalid owner '${String(target.owner)}'`);
  if (typeof target.repo !== "string") throw new CustomCredentialValidationError(`invalid repo '${String(target.repo)}'`);
  const error = target.repositoryTargetError({ owner: target.owner, repo: target.repo }, validateTarget === undefined ? {} : { validateTarget });
  if (error !== null) throw new CustomCredentialValidationError(error);
  return { owner: target.owner, repo: target.repo };
}

export function validateBranch({ value }: { value: unknown }, _optional = {}): string {
  if (typeof value !== "string" || !BRANCH_PATTERN.test(value)) {
    throw new CustomCredentialValidationError(`invalid branch name '${typeof value === "string" ? value.slice(0, 60) : String(value)}'`);
  }
  // BRANCH_PATTERN alone would admit these — `.`, `-`, and `/` are all in its character class — but a
  // `..` or empty `/`-separated segment is a dot-segment the URL constructor normalizes away, so a
  // branch like '../tags/release' would silently retarget the ref read/update into another namespace.
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "..")) {
    throw new CustomCredentialValidationError(`invalid branch name '${value.slice(0, 60)}' — must not contain an empty or '..' path segment`);
  }
  return value;
}

export function validateCommitMessage({ value }: { value: unknown }, _optional = {}): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_COMMIT_MESSAGE_LENGTH) {
    throw new CustomCredentialValidationError(`commitMessage must be 1-${MAX_COMMIT_MESSAGE_LENGTH} characters`);
  }
  return value;
}

/** Rejects a `.git`-named or `.git/`-nested path, case-insensitively — see this file's header for
 *  the collision class this closes. Applied AFTER lexical normalization, so `./.git`/`.GIT/x` are
 *  both caught the same way regardless of how the caller spelled the segment. */
function isReservedGitPath({ normalized }: { normalized: string }, _optional = {}): boolean {
  return normalized.split("/").some(segment => segment.toLowerCase() === ".git");
}

/**
 * Rejects an absolute path, a NUL byte, a Windows drive prefix, a lexical `..`/`.` segment, or a
 * path naming/nesting under `.git` — BEFORE any network call. See this file's header for why this
 * is the lexical half only of `package-paths.ts`'s `normalizePackageEntryPath`, with one addition
 * that function has no analog for.
 *
 * @throws {CustomCredentialValidationError} The path is unsafe by construction.
 * @complexity O(n) in the path's own length.
 */
export function normalizeWriteFilePath({ rawPath }: { rawPath: string }, _optional = {}): string {
  if (rawPath.length > WRITE_FILES_LIMITS.maxPathLength) {
    throw new CustomCredentialValidationError(`file path exceeds the ${WRITE_FILES_LIMITS.maxPathLength}-character cap: '${rawPath.slice(0, 80)}...'`);
  }
  if (rawPath.includes("\0")) {
    throw new CustomCredentialValidationError(`file path contains a NUL byte: '${rawPath.slice(0, 80)}'`);
  }

  const portable = rawPath.replaceAll("\\", "/");

  if (portable.startsWith("/") || /^[a-zA-Z]:/.test(portable)) {
    throw new CustomCredentialValidationError(`file path must be relative, not absolute: '${rawPath}'`);
  }

  const segments = portable.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new CustomCredentialValidationError(`file path escapes the repository root: '${rawPath}'`);
  }
  const normalized = segments.filter((segment) => segment !== "." && segment !== "").join("/");
  if (normalized === "") {
    throw new CustomCredentialValidationError(`file path is empty or resolves to nothing: '${rawPath}'`);
  }

  if (isReservedGitPath({ normalized })) {
    throw new CustomCredentialValidationError(`file path names or nests under the reserved '.git' directory: '${rawPath}'`);
  }

  return normalized;
}

function requireStringFileEntry({ raw }: { raw: unknown }, _optional = {}): { readonly path: string; readonly content: string } {
  const entry = { value: raw };
  if (!isNonArrayRecord(entry) || typeof entry.value.path !== "string" || typeof entry.value.content !== "string") {
    throw new CustomCredentialValidationError("each entry in 'files' must be an object with a string 'path' and a string 'content'");
  }
  return { path: entry.value.path, content: entry.value.content };
}

function addFileBytesWithinLimits({ normalized, content, totalBytes }: { normalized: string; content: string; totalBytes: number }, _optional = {}): number {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > WRITE_FILES_LIMITS.maxFileBytes) {
    throw new CustomCredentialValidationError(`file '${normalized}' is ${bytes} bytes, over the ${WRITE_FILES_LIMITS.maxFileBytes}-byte per-file cap`);
  }
  const nextTotalBytes = totalBytes + bytes;
  if (nextTotalBytes > WRITE_FILES_LIMITS.maxTotalBytes) {
    throw new CustomCredentialValidationError(`'files' totals over the ${WRITE_FILES_LIMITS.maxTotalBytes}-byte aggregate cap`);
  }
  return nextTotalBytes;
}

/**
 * Validates and normalizes the `files` array: shape, per-file path safety, per-file and aggregate
 * size caps, the file-count cap, and duplicate-path detection within the same call — mirroring
 * `agent-plugins/install.ts`'s own "duplicate archive entry... refusing a second write over an
 * already-vetted first one" rule, adapted from an archive's entries to this call's own file list.
 *
 * @throws {CustomCredentialValidationError} Any shape, path, or size violation.
 * @complexity O(n) in the number of files, plus O(m) in each file's own content length.
 */
function validateFiles({ rawFiles }: { rawFiles: unknown }, _optional = {}): readonly NormalizedWriteFile[] {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new CustomCredentialValidationError("'files' must be a non-empty array of {path, content} objects");
  }
  if (rawFiles.length > WRITE_FILES_LIMITS.maxFiles) {
    throw new CustomCredentialValidationError(`'files' has ${rawFiles.length} entries, over the ${WRITE_FILES_LIMITS.maxFiles}-file cap`);
  }

  const seen = new Set<string>();
  const files: NormalizedWriteFile[] = [];
  let totalBytes = 0;

  for (const raw of rawFiles) {
    const { path, content } = requireStringFileEntry({ raw });

    const normalized = normalizeWriteFilePath({ rawPath: path });
    if (seen.has(normalized)) {
      throw new CustomCredentialValidationError(`duplicate file path '${normalized}' — refusing a second write over an already-vetted first one`);
    }
    seen.add(normalized);

    totalBytes = addFileBytesWithinLimits({ normalized, content, totalBytes });

    files.push({ path: normalized, content });
  }

  return files;
}

/**
 * The entry point every `custom_credential_write_files` call validates through before the credential
 * is resolved or any network call is made — `branch`/`commitMessage` shape, plus every file's path
 * safety and the count/size caps. Owner/repo wait for the host ({@link validateRepositoryTarget}). Mirrors this domain's own established
 * ordering (see this file's header) of "shape/security validation before permission check or I/O".
 *
 * @throws {CustomCredentialValidationError} Any field fails its own validation.
 * @complexity O(n) in the number of files, plus O(m) in each file's own content length.
 */
export function validateWriteFilesInput(input: { branch: unknown; commitMessage: unknown; files: unknown }, _optional: Record<string, never> = {}): WriteFilesRequest {
  return {
    branch: validateBranch({ value: input.branch }),
    commitMessage: validateCommitMessage({ value: input.commitMessage }),
    files: validateFiles({ rawFiles: input.files }),
  };
}
