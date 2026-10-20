import { firstExportFailure } from '../core/export-failure-summary.js';
import type { CommitExportArgs, CommitFile, CommitOptions, CommitOrchestrationArgs, PreviewCommitExportResult, SourceControlCommitOutcome } from './contracts.js';
import { validateCommitTarget } from './repository-target.js';

/** Normalize platform separators without changing the retained byte payload. */
export function toCommitFile(required: { outputFile: string; data: string | Buffer }): CommitFile {
  return { path: required.outputFile.replace(/\\/g, '/'), data: required.data };
}

type ExportResult = { ok: true; files: CommitFile[] } | { ok: false; code: 'EXPORT_FAILED'; message: string };
/** Export into a fresh run directory, reporting it through `claim` before any export I/O starts. */
async function exportIntoRunDirectory(input: CommitExportArgs, claim: (outputDir: string) => void): Promise<ExportResult> {
  try {
    const outputDir = input.layout.outputDirectory({ workspaceId: input.workspaceId, providerId: input.providerId, runId: input.ids.next({}) });
    claim(outputDir);
    const report = await input.files.export({ outputDir }, { clean: true });
    const failure = firstExportFailure({ report });
    if (failure) return { ok: false, code: 'EXPORT_FAILED', message: `refused to commit: ${failure.count} ${failure.kind}(s) failed to export (first: '${failure.identifier}' — ${failure.reason})` };
    return { ok: true, files: [...report.routes.succeeded.map(toCommitFile), ...report.assets.succeeded.map(toCommitFile)] };
  } catch (error) {
    return { ok: false, code: 'EXPORT_FAILED', message: `export failed before committing could start: ${input.describeError({ error })}` };
  }
}
async function exportForCommit(input: CommitExportArgs): Promise<ExportResult> {
  let outputDir: string | undefined;
  try {
    return await exportIntoRunDirectory(input, claimed => { outputDir = claimed; });
  } finally {
    if (outputDir !== undefined) {
      // Byte payloads are retained by the report; cleanup cannot invalidate the commit.
      try { await input.layout.cleanup({ outputDir }); } catch { /* Best effort, matching the original service. */ }
    }
  }
}

/** Run a real fresh export, without credentials or repository I/O. */
export async function previewCommitExport(required: CommitExportArgs, optional: CommitOptions = {}): Promise<PreviewCommitExportResult> {
  const error = validateCommitTarget(required, optional);
  if (error) return { ok: false, code: 'INVALID_CONFIG', message: error };
  const exported = await exportForCommit(required);
  if (!exported.ok) return exported;
  return { ok: true, fileCount: exported.files.length, totalBytes: exported.files.reduce((sum, file) => sum + Buffer.byteLength(file.data), 0), paths: exported.files.map(file => file.path).sort().slice(0, 50) };
}

const PROVIDER_FAILURE_CODES = { 'repository-not-found': 'REPOSITORY_NOT_FOUND', 'no-changes': 'NO_CHANGES', diverged: 'DIVERGED_BRANCH', 'network-unreachable': 'NETWORK_UNREACHABLE', 'provider-error': 'PROVIDER_ERROR' } as const;
type ResolvedCredential = NonNullable<Awaited<ReturnType<CommitOrchestrationArgs['credentials']['resolve']>>>;
type CommitRefusal = Extract<SourceControlCommitOutcome, { ok: false }>;

/** The credential must exist and belong to the requested provider; failures never reveal the token. */
async function resolveProviderCredential(required: CommitOrchestrationArgs): Promise<{ ok: true; credential: ResolvedCredential } | CommitRefusal> {
  let credential: ResolvedCredential | null;
  try { credential = await required.credentials.resolve({ workspaceId: required.workspaceId, providerId: required.providerId }); }
  catch (error) { return { ok: false, code: 'NO_CREDENTIALS_CONFIGURED', message: `credential could not be resolved: ${required.describeError({ error })}` }; }
  if (!credential) return { ok: false, code: 'NO_CREDENTIALS_CONFIGURED', message: `No source control credential is configured for '${required.providerId}'.` };
  if (credential.providerId !== required.providerId) return { ok: false, code: 'NO_CREDENTIALS_CONFIGURED', message: `The resolved default credential is not a '${required.providerId}' connection.` };
  return { ok: true, credential };
}

/** One provider call; the adapter's failure codes map onto the host-facing outcome codes. */
async function commitExportedFiles(required: { args: CommitOrchestrationArgs; token: string; files: CommitFile[] }, optional: CommitOptions): Promise<SourceControlCommitOutcome> {
  const { args, token, files } = required;
  try {
    const result = await args.adapter.commitSite({ token, owner: args.owner, repo: args.repo, commitMessage: args.commitMessage, files }, optional.branch !== undefined ? { branch: optional.branch } : {});
    if (!result.ok) return { ok: false, code: PROVIDER_FAILURE_CODES[result.code], message: result.message };
    return { ...result, owner: args.owner, repo: args.repo, divergedPaths: result.divergedPaths ?? [] };
  } catch (error) { return { ok: false, code: 'PROVIDER_ERROR', message: args.describeError({ error }) }; }
}

/** Resolve one provider's credential, export into an isolated host-owned directory and commit once. */
export async function commitSiteToSourceControl(required: CommitOrchestrationArgs, optional: CommitOptions = {}): Promise<SourceControlCommitOutcome> {
  const configError = validateCommitTarget(required, optional);
  if (configError) return { ok: false, code: 'INVALID_CONFIG', message: configError };
  const resolved = await resolveProviderCredential(required);
  if (!resolved.ok) return resolved;
  const exported = await exportForCommit(required);
  if (!exported.ok) return exported;
  return commitExportedFiles({ args: required, token: resolved.credential.token, files: exported.files }, optional);
}
