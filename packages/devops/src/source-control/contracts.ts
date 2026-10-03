import type { HttpClientPort } from '@jini-ai/core/primitives';
import type { ExportReport } from '../static-export/contracts.js';

/** Repository-relative bytes, passed unchanged to the provider. */
export interface CommitFile { readonly path: string; readonly data: string | Buffer }
export type SourceControlCommitResult =
  | { ok: true; branch: string; branchCreated: boolean; commitSha: string; commitUrl: string; filesChanged: number; filesDeleted: number; divergedPaths?: readonly string[] }
  | { ok: false; code: 'repository-not-found' | 'no-changes' | 'diverged' | 'network-unreachable' | 'provider-error'; message: string };
export interface CommitSiteInput { readonly token: string; readonly owner: string; readonly repo: string; readonly commitMessage: string; readonly files: readonly CommitFile[] }
export type ProviderCallFailure = { ok: false; code: 'provider-error'; message: string } | { ok: false; code: 'network-unreachable'; message: string; logDetail: string };
export interface CredentialedRepositoryTarget { readonly baseUrl: string; readonly authorization: string; readonly owner: string; readonly repo: string }
export interface WriteFile { readonly path: string; readonly content: string }
export interface FileWriteState { readonly path: string; readonly exists: boolean }
export interface FileWritePlan { readonly parentCommitSha: string; readonly baseTreeSha: string; readonly fileStates: readonly FileWriteState[] }
export type FileWritePlanResult = { ok: true; plan: FileWritePlan } | { ok: false; code: 'branch-not-found'; message: string } | ProviderCallFailure;
export type CommitFilesResult = { ok: true; commitSha: string; commitUrl: string } | { ok: false; code: 'diverged'; message: string } | ProviderCallFailure;
export interface BackupRepositoryState { readonly branch: string; readonly parentCommitSha: string; readonly baseTreeSha: string; readonly htmlUrl: string; readonly folderExists: boolean }
export type InspectBackupRepositoryFailureCode = 'repo-not-found' | 'repo-not-private' | 'no-push-permission' | 'repo-empty' | 'branch-not-found' | 'folder-is-file';
export type InspectBackupRepositoryResult = { ok: true; state: BackupRepositoryState } | { ok: false; code: InspectBackupRepositoryFailureCode; message: string } | ProviderCallFailure;
export interface UploadedBackupBlob { readonly path: string; readonly blobSha: string; readonly bytes: number; readonly sha256: string }
export interface CommitBackupTreeInput extends CredentialedRepositoryTarget { readonly branch: string; readonly folder: string; readonly commitMessage: string; readonly parentCommitSha: string; readonly baseTreeSha: string; readonly htmlUrl: string; readonly blobs: readonly UploadedBackupBlob[] }

export interface SourceControlHostFacts {
  readonly id: string;
  readonly label: string;
  readonly apiOrigin: string;
  readonly maxFileBytes?: number;
  readonly reservedPaths?: readonly string[];
  readonly workflowPaths?: readonly string[];
}

/** New module ABI: all required inputs, including an approved write plan, are one object. */
export interface SourceControlProviderOperations {
  commitSite(required: CommitSiteInput, optional?: { branch?: string }): Promise<SourceControlCommitResult>;
  readAccountLabel(required: { token: string }): Promise<string | null>;
  planFileWrite(required: CredentialedRepositoryTarget & { branch: string; files: readonly WriteFile[] }): Promise<FileWritePlanResult>;
  commitFiles(required: CredentialedRepositoryTarget & { branch: string; commitMessage: string; files: readonly WriteFile[]; plan: FileWritePlan }): Promise<CommitFilesResult>;
  inspectBackupRepository(required: CredentialedRepositoryTarget & { folder: string }, optional?: { branch?: string }): Promise<InspectBackupRepositoryResult>;
  uploadBackupBlob(required: { target: CredentialedRepositoryTarget; file: { path: string; content: Uint8Array } }): Promise<{ ok: true; blob: UploadedBackupBlob } | ProviderCallFailure>;
  commitBackupTree(required: CommitBackupTreeInput): Promise<CommitFilesResult>;
}
export interface RepositoryTarget { readonly owner: string; readonly repo: string }
export type RepositoryTargetValidator = (required: RepositoryTarget) => string | null;
export type SourceControlProvider = SourceControlProviderOperations & SourceControlHostFacts & { readonly validateTarget?: RepositoryTargetValidator };
export interface DescribedTransportError { readonly refusal: string | undefined; readonly logDetail: string }

/** Structural guarded HTTP port: the host owns origin/DNS/redirect policy and secret redaction. */
export type { HttpClientPort } from '@jini-ai/core/primitives';
/** The host binds guarded/native HTTP through object arguments. */
export type SourceControlFetchPort = (required: { url: string }, optional?: { init?: RequestInit }) => Promise<Response>;
export interface SourceControlProviderKit {
  fetch(required: { url: string; init: RequestInit }): Promise<Response>;
  redirectGuardInit(required: { init: RequestInit }): RequestInit;
  assertNotRedirected(required: { response: Response; hostName: string }): void;
  isRedirectRefusal(required: { error: unknown }): boolean;
  readonly httpClient: HttpClientPort;
  describeTransportError(required: { error: unknown }): DescribedTransportError;
}
export interface SourceControlProviderModule { create(required: { kit: SourceControlProviderKit }): SourceControlProviderOperations; validateTarget?: RepositoryTargetValidator }

export interface SourceControlProviderDescriptor extends SourceControlHostFacts { readonly module: string; readonly credential?: unknown; readonly i18n?: unknown }
export interface LoadedSourceControlProvider { readonly descriptor: SourceControlProviderDescriptor; readonly pluginId: string; readonly module: SourceControlProviderModule }
export interface SourceControlProviderRegistry {
  list(required: Record<string, never>): readonly LoadedSourceControlProvider[];
  get(required: { providerId: string }): LoadedSourceControlProvider | undefined;
  readonly refusals: readonly string[];
  readonly switchedOff: ReadonlyMap<string, string>;
}
export type CatalogPackage =
  | { pluginId: string; state: 'refused'; reason: string }
  | { pluginId: string; state: 'inactive'; descriptorText: string }
  | { pluginId: string; state: 'trusted'; descriptorText: string; importModule(required: { relativePath: string }): Promise<unknown> };
/** Only trusted entries may expose importModule. The adapter must verify activation, digest and realpath containment before import. */
export interface ProviderCatalogPort { list(required: { workspaceId: string; descriptorFileName: string }): Promise<readonly CatalogPackage[]> }
export type DescriptorExtensions = { credential?: unknown; i18n?: unknown };
export type DescriptorExtensionReader = (required: { entry: Readonly<Record<string, unknown>>; at: string }) => { ok: true; extensions: DescriptorExtensions } | { ok: false; reason: string };

export interface CredentialResolverPort { resolve(required: { workspaceId: string; providerId: string }): Promise<{ providerId: string; token: string } | null> }
export interface FileSourcePort { export(required: { outputDir: string }, optional?: { clean?: boolean }): Promise<ExportReport> }
export interface CommitLayoutPort {
  outputDirectory(required: { workspaceId: string; providerId: string; runId: string }): string;
  cleanup(required: { outputDir: string }): Promise<void>;
}
export interface CommitExportArgs {
  workspaceId: string;
  owner: string;
  repo: string;
  commitMessage: string;
  providerId: string;
  files: FileSourcePort;
  layout: CommitLayoutPort;
  ids: { next(required: Record<string, never>): string };
  /** Must return caller-safe text without credentials. */
  describeError(required: { error: unknown }): string;
}
export interface CommitOrchestrationArgs extends CommitExportArgs { credentials: CredentialResolverPort; adapter: Pick<SourceControlProviderOperations, 'commitSite'> }
export interface CommitOptions { branch?: string; validateTarget?: RepositoryTargetValidator }
export type CommitFailureCode = 'INVALID_CONFIG' | 'NO_CREDENTIALS_CONFIGURED' | 'EXPORT_FAILED' | 'REPOSITORY_NOT_FOUND' | 'NO_CHANGES' | 'DIVERGED_BRANCH' | 'NETWORK_UNREACHABLE' | 'PROVIDER_ERROR';
export type SourceControlCommitOutcome =
  | { ok: false; code: CommitFailureCode; message: string }
  | { ok: true; owner: string; repo: string; branch: string; branchCreated: boolean; commitSha: string; commitUrl: string; filesChanged: number; filesDeleted: number; divergedPaths: readonly string[] };
export type PreviewCommitExportResult = { ok: true; fileCount: number; totalBytes: number; paths: string[] } | { ok: false; code: 'INVALID_CONFIG' | 'EXPORT_FAILED'; message: string };
