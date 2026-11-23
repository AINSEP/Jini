import { redactSecrets } from '@jini-ai/core';
import type { ExportReport } from '../static-export/contracts.js';
import { firstExportFailure } from '../core/export-failure-summary.js';
import type { CommitExportArgs, CommitFailureCode, CommitFile, CommitOptions, CommitOrchestrationArgs, PreviewCommitExportResult, SourceControlCommitOutcome } from './contracts.js';
import { validateCommitTarget } from './repository-target.js';
import { normalizeRepositoryFolder, prefixRepositoryPath } from './repository-path.js';

/**
 * @file Source-control commit orchestration: validate the target, resolve a credential, run one fresh
 * export into an isolated directory, then hand the files to a provider in ONE call.
 *
 * Wrap, do not reimplement: the host's own exporter runs behind `FileSourcePort`, the provider's HTTP lives
 * behind `adapter`, and this module does neither. A commit is not a hosted site, so no export here ever
 * takes a base path. The destination is the repository root or one explicit folder: the provider owns the
 * folder prefix and the folder-local reconciliation, the host owns any packaging of the files (see
 * `CommitLayoutPort.arrangeFiles`).
 *
 * Never throws for an expected outcome. Every failure (invalid target, no credential, a credential store
 * that throws, a failed export, a refused provider call, a provider that throws) is RETURNED as
 * `{ ok: false, code, message }`, because the caller is a tool handler in a long-lived process: one
 * uncaught rejection there would take the whole process down, not just answer one call with an error.
 * Each code is its own so a caller can tell a human what to do next; none is folded into a generic one.
 * No network call and no credential read happens before the target and folder have been validated.
 */

/** Folder validation precedes credentials, rendering and all provider effects. */
function folderError(required: { folder?: string; supportsFolder?: boolean }, optional: { committing?: boolean } = {}): string | null {
  try {
    const folder = normalizeRepositoryFolder(required);
    if (folder && optional.committing && required.supportsFolder !== true) return 'This provider does not support folder commits.';
    return null;
  } catch (error) { return (error as Error).message; }
}

/** Normalize platform separators without changing the retained byte payload. An export's `outputFile` is already
 *  commit-relative but uses the platform separator (`path.relative`), and a stray backslash from a Windows host would
 *  be a wrong path in a git tree entry, not a normalized one. */
export function toCommitFile(required: { outputFile: string; data: string | Buffer }): CommitFile {
  return { path: required.outputFile.replace(/\\/g, '/'), data: required.data };
}

type ExportResult = { ok: true; files: CommitFile[] } | { ok: false; code: 'EXPORT_FAILED'; message: string };

/** The files to commit: the host's arrangement when its layout supplies one, else the succeeded routes then assets. */
function arrangeCommitFiles(required: { input: CommitExportArgs; report: ExportReport }): ExportResult {
  const { input, report } = required;
  try {
    const files = input.layout.arrangeFiles
      ? [...input.layout.arrangeFiles({ report })]
      : [...report.routes.succeeded.map(toCommitFile), ...report.assets.succeeded.map(toCommitFile)];
    return { ok: true, files };
  } catch (error) {
    return { ok: false, code: 'EXPORT_FAILED', message: input.describeError({ error, stage: 'arrange' }) };
  }
}

/**
 * Export into a fresh run directory, reporting it through `claim` before any export I/O starts.
 *
 * The directory is minted per RUN (the layout receives a new `runId` every call), never a fixed path per
 * provider: with a fixed path two overlapping commits would `clean` and rewrite the same directory under each
 * other. It is disposable once the export returns, because every byte the commit needs travels in the
 * report's `data` fields and nothing re-reads the directory. A failed route AND a failed asset both refuse
 * the commit (a page can export fine while its stylesheet or hero image 404s, and committing that is worse
 * than refusing).
 */
async function exportIntoRunDirectory(input: CommitExportArgs, claim: (outputDir: string) => void): Promise<ExportResult> {
  try {
    const outputDir = input.layout.outputDirectory({ workspaceId: input.workspaceId, providerId: input.providerId, runId: input.ids.next({}) });
    claim(outputDir);
    const report = await input.files.export({ outputDir }, { clean: true });
    const failure = firstExportFailure({ report });
    if (failure) return { ok: false, code: 'EXPORT_FAILED', message: `refused to commit: ${failure.count} ${failure.kind}(s) failed to export (first: '${failure.identifier}' — ${failure.reason})` };
    const arranged = arrangeCommitFiles({ input, report });
    // Validate every folder-relative path while export failures still use the safe outcome channel.
    if (arranged.ok) for (const file of arranged.files) prefixRepositoryPath({ folder: input.folder, path: file.path });
    return arranged;
  } catch (error) {
    return { ok: false, code: 'EXPORT_FAILED', message: `export failed before committing could start: ${input.describeError({ error, stage: 'export' })}` };
  }
}
/** The run directory is removed on every path out: success, refusal and throw alike. */
async function exportForCommit(input: CommitExportArgs): Promise<ExportResult> {
  let outputDir: string | undefined;
  try {
    return await exportIntoRunDirectory(input, claimed => { outputDir = claimed; });
  } finally {
    if (outputDir !== undefined) {
      // Byte payloads are retained by the report; cleanup cannot invalidate the commit. Best effort by design: a
      // directory that could not be removed is disposable scratch, and failing the commit over it would
      // turn a finished export into a refusal.
      try { await input.layout.cleanup({ outputDir }); } catch { /* Best effort, matching the original service. */ }
    }
  }
}

/**
 * Run a real fresh export, without credentials or repository I/O: the file count and byte total are real, not
 * estimated, and the answer is a summary instead of a commit. It validates like the commit does and never
 * resolves a credential or calls the provider (no network before a human has confirmed). `paths` is sorted and
 * capped at 50 so a large export cannot blow out a dry-run answer.
 * @complexity One export pass; no credential read, no provider call.
 */
export async function previewCommitExport(required: CommitExportArgs, optional: CommitOptions = {}): Promise<PreviewCommitExportResult> {
  const error = validateCommitTarget(required, optional) ?? folderError(required);
  if (error) return { ok: false, code: 'INVALID_CONFIG', message: error };
  const exported = await exportForCommit(required);
  if (!exported.ok) return exported;
  return { ok: true, fileCount: exported.files.length, totalBytes: exported.files.reduce((sum, file) => sum + Buffer.byteLength(file.data), 0), paths: exported.files.map(file => prefixRepositoryPath({ folder: required.folder, path: file.path })).sort().slice(0, 50) };
}

const PROVIDER_FAILURE_CODES = { 'repository-not-found': 'REPOSITORY_NOT_FOUND', 'no-changes': 'NO_CHANGES', diverged: 'DIVERGED_BRANCH', 'network-unreachable': 'NETWORK_UNREACHABLE', 'provider-error': 'PROVIDER_ERROR' } as const;
type ResolvedCredential = NonNullable<Awaited<ReturnType<CommitOrchestrationArgs['credentials']['resolve']>>>;
type CommitRefusal = Extract<SourceControlCommitOutcome, { ok: false }>;

/**
 * The credential must exist and belong to the requested provider; failures never reveal the token.
 *
 * A resolver that throws (a decrypt failure: a missing site key, a tampered row) is a real possibility, not a
 * theoretical one. It surfaces through this function's refusal channel, as `NO_CREDENTIALS_CONFIGURED`, the
 * closest existing code (there is no dedicated "exists but cannot be unlocked" code, and adding one is a wider
 * API change than that case needs). The wrong-provider guard is unreachable in practice, because the resolver
 * was asked for this provider, but it stays an explicit typed check so a future bug in that invariant fails
 * loudly here instead of forwarding one host's token to another host's API.
 */
async function resolveProviderCredential(required: CommitOrchestrationArgs): Promise<{ ok: true; credential: ResolvedCredential } | CommitRefusal> {
  let credential: ResolvedCredential | null;
  try { credential = await required.credentials.resolve({ workspaceId: required.workspaceId, providerId: required.providerId }); }
  catch (error) { return { ok: false, code: 'NO_CREDENTIALS_CONFIGURED', message: `credential could not be resolved: ${required.describeError({ error, stage: 'credential' })}` }; }
  if (!credential) return { ok: false, code: 'NO_CREDENTIALS_CONFIGURED', message: required.describeMissingCredential?.({ providerId: required.providerId }) ?? `No source control credential is configured for '${required.providerId}'.` };
  if (credential.providerId !== required.providerId) return { ok: false, code: 'NO_CREDENTIALS_CONFIGURED', message: `The resolved default credential is not a '${required.providerId}' connection.` };
  return { ok: true, credential };
}

/** Own keys only: a plugin's `constructor` or `__proto__` code must not resolve to an inherited member. */
function outcomeCode(required: { code: string }): CommitFailureCode {
  return Object.hasOwn(PROVIDER_FAILURE_CODES, required.code) ? PROVIDER_FAILURE_CODES[required.code as keyof typeof PROVIDER_FAILURE_CODES] : 'PROVIDER_ERROR';
}

/** Provider text may echo the Authorization value, so it never leaves this module without the exact token redacted
 *  (the shared redactor also catches shapes the token's own prefix would reveal). */
function redactToken(required: { text: string; token: string }): string {
  return redactSecrets({ input: required.text }, { exactSecrets: [required.token] });
}

/**
 * One provider call; the adapter's failure codes map onto the host-facing outcome codes. A provider is
 * plugin code: its throw must not break the never-throw contract, and its raw message may carry provider
 * detail, so the text of a throw comes from the host's `describeError` (stage `'commit'`), which keeps detail
 * for its own log and returns caller-safe words.
 */
async function commitExportedFiles(required: { args: CommitOrchestrationArgs; token: string; files: CommitFile[] }, optional: CommitOptions): Promise<SourceControlCommitOutcome> {
  const { args, token, files } = required;
  try {
    const folder = normalizeRepositoryFolder(args);
    const result = await args.adapter.commitSite({ token, owner: args.owner, repo: args.repo, commitMessage: args.commitMessage, files, ...(folder ? { folder } : {}) }, optional.branch !== undefined ? { branch: optional.branch } : {});
    if (!result.ok) return { ok: false, code: outcomeCode({ code: result.code }), message: redactToken({ text: result.message, token }) };
    return { ...result, owner: args.owner, repo: args.repo, divergedPaths: result.divergedPaths ?? [] };
  } catch (error) { return { ok: false, code: 'PROVIDER_ERROR', message: redactToken({ text: args.describeError({ error, stage: 'commit' }), token }) }; }
}

/** Plain words for a stopped run: nothing has reached the repository, because the push is the last step and is guarded. */
const ABORTED_MESSAGE = 'The commit was stopped before anything was pushed to the repository. Nothing was changed there; start it again when you are ready.';

/** The refusal for a run whose signal has fired, else null. Checked between steps, not mid-request: the provider call is
 *  one atomic commitSite, so the last safe point to honour Stop is immediately before it. */
function abortedRefusal(optional: CommitOptions): CommitRefusal | null {
  return optional.signal?.aborted ? { ok: false, code: 'ABORTED', message: ABORTED_MESSAGE } : null;
}

/**
 * Resolve one provider's credential, export into an isolated host-owned directory and commit once.
 *
 * Always runs a FRESH export immediately before committing and never reuses an earlier export directory:
 * correctness over one extra pass. The target is validated here even when the caller already validated it
 * before opening a confirmation dialog (defense in depth for a caller that skips that check).
 * This function reads as one guard per phase (credential, export, commit) rather than one long chain; `optional.signal`
 * is checked in front of each phase, so a Stop/timeout never pushes.
 * @complexity One export pass (O(routes + assets) requests against the host's own app) plus one provider call.
 */
export async function commitSiteToSourceControl(required: CommitOrchestrationArgs, optional: CommitOptions = {}): Promise<SourceControlCommitOutcome> {
  const configError = validateCommitTarget(required, optional) ?? folderError(required, { committing: true });
  if (configError) return { ok: false, code: 'INVALID_CONFIG', message: configError };
  const resolved = abortedRefusal(optional) ?? await resolveProviderCredential(required);
  if (!resolved.ok) return resolved;
  const exported = abortedRefusal(optional) ?? await exportForCommit(required);
  if (!exported.ok) return exported;
  // The push guard: an abort that landed during the export must not still reach the git host.
  const stopped = abortedRefusal(optional);
  if (stopped) return stopped;
  return commitExportedFiles({ args: required, token: resolved.credential.token, files: exported.files }, optional);
}
