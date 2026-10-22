Spec ID: SPEC-JINI-DEVOPS-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:f10a8af2743a110ddd562344225e557f4616d0e62f6a5ae5ba6c761d2a154dfc
spec_mode: reverse_spec


# DevOps API contract

All 12 `package.json` exports are covered below. Current functions use a required object and, where implemented, an optional object defaulting to `{}`. A required-only function has no implemented second argument. Structural callback ports and the SigV4 factory retain their current signatures. No provider implementations are bundled.

## Root: `@jini-ai/devops`

The root is an empty domain marker (`export {}`); it exports no callable API. Import a capability subpath. `./ci-cd` is planned, not exported.

## `./deploy`

| Entry point | Current signature and return |
|---|---|
| `safeProjectLabel` | `({ raw: unknown, maxLength: number }) => string` |
| `safeDnsLabel` | `({ raw: unknown }) => string` (63-character cap) |
| `normalizeDeploymentUrl` | `({ url: unknown }) => string` |
| `checkDeploymentUrl` | `({ url: unknown, fetch: ReachabilityFetchPort }, optional: ReachabilityOptions = {}) => Promise<DeploymentUrlCheck>` |
| `waitForReachableDeploymentUrl` | `({ urls: unknown[], fetch, now({}), sleep({ ms }) }, optional: ReachabilityWaitOptions = {}) => Promise<ReachabilityWaitResult>` |
| `redirectGuardInit` | `({ init: RequestInit }) => RequestInit` |
| `assertNotRedirected` | `({ resp: Response, providerLabel: string }) => void` |
| `publishDeploy` | `({ targets: readonly DeployTarget[], targetId, files, projectName }, optional: DeployPublishOptions = {}) => Promise<DeployPublishResult>` |
| `createRoleGatedDeployPublishPolicy` | `({}, optional: { allowedRoles?: readonly string[] } = {}) => ToolPolicy` |
| `createDeployPublishToolRegistration` | `({ targets }, optional: { policy?: ToolPolicy; requiresConfirmation?: boolean; timeoutMs?: number } = {}) => ToolRegistration` |
| `DeployError` | `new ({ message: string }, optional: { status?: number; details?: UnknownRecord | string; code?: string } = {})` |

`DeployFile = { file: string; data: Buffer | Uint8Array | string; contentType?: string; sourcePath?: string }`. `DeployPublishInput = { files: DeployFile[]; projectName: string }`; `DeployPublishOptions = { metadata?: UnknownRecord; responseHeaders?: ResponseHeaderSet }`. `UnknownRecord = Record<string, unknown>`; `ResponseHeaderSet = Readonly<Record<string, string>>`. `DeployPublishResult` requires targetId/url/status and optionally deploymentId/statusMessage/reachableAt/providerMetadata. `DeployLinkStatus = 'ready' | 'protected' | 'failed' | 'link-delayed'`. `DeploymentUrlCheck` has reachable and optional status/statusCode/statusMessage; wait results require status/url/statusMessage and optional reachableAt.

Consumer `DeployTarget` requires id, `publish(required: DeployPublishInput, optional?: DeployPublishOptions)` and `checkReachability({ url }) => Promise<DeploymentUrlCheck>`. `ReachabilityFetchPort({ url }, { init? }?) => Promise<Response>` must enforce connection-time DNS policy and honor manual redirects and signal. Reachability required inputs also include `guard: DeploymentUrlGuard` with `assertSafeUrl({ raw, label }): URL`. `ProtectedResponseDetector({ resp, body }) => boolean` is optional. Reachability options permit timeoutMs/detectProtected/protectedMessage; `lookupImpl` belongs to `createNodeReachabilityPorts` at `@jini-ai/devops/deploy/node`; wait options additionally intervalMs/providerLabel. The host owns DNS overrides.

`DeployHostKit` is a consumer-supplied object: `fetch({ url, timeoutMs }, { init? }?)`, timeouts `{ QUICK, DEPLOY, UPLOAD }`, `sleep({ ms })`, the exported naming/reachability/redirect helpers, `DeployError`, and `createSigV4Client(options: SigV4ClientOptions)`. SigV4 options require accessKeyId/secretAccessKey/service/region; `SigV4Client.fetch({ input }, { init? }?) => Promise<Response>` and `sign({ input }, { init? }?) => Promise<Request>`. `DeployTargetModule.create({ credential, config, kit }) => DeployTarget`; optional module methods validateConfig({ config }), basePath({ config }), verifyCredential({ credential, kit }). `DeployTargetCredential` requires token and optional string fields. `DeployCredentialCheck` returns ok/accountLabel? or false/reason rejected|unreachable/statusCode?. Create/check contexts are exported types. No kit construction factory is exported.

Public constants: `DeployTargetToken` (many-token id `jini.deployTarget`), `DEPLOY_PUBLISH_TOOL_ID = 'deploy.publish'`, `DEFAULT_DEPLOY_PUBLISH_ROLE = 'deploy:publish'`, `denyAllDeployPublishPolicy`. Tool input includes targetId/files/projectName/metadata?. Registration argument/options types are exported.

Exported aliases for the shapes above: `DeployPublishToolInput` (tool input), `DeployErrorDetails` (UnknownRecord|string|undefined), `DeployFetchTimeouts` (QUICK/DEPLOY/UPLOAD), `DeployTargetCreateContext` (credential/config/kit), `DeployCredentialCheckContext` (credential/kit), `ReachabilityArgs` (url/fetch), `ReachabilityWaitArgs` (urls/fetch/now/sleep), `CreateDeployPublishToolRegistrationArgs` (targets) and `CreateDeployPublishToolRegistrationOptions` (policy/requiresConfirmation/timeoutMs).

```ts
import { createDeployPublishToolRegistration, createRoleGatedDeployPublishPolicy } from '@jini-ai/devops/deploy';
const registration = createDeployPublishToolRegistration({ targets: [hostTarget] }, {
  policy: createRoleGatedDeployPublishPolicy({}), requiresConfirmation: true,
});
// hostTarget implements DeployTarget; the host registers this with its tool registry/executor.
```

## `./source-control`

| Entry point | Current signature and return |
|---|---|
| `repositoryTargetError` | `({ owner, repo }, { validateTarget? } = {}) => string | null` |
| `validateCommitTarget` | `({ owner, repo, commitMessage }, { validateTarget?, branch? } = {}) => string | null` |
| `createSourceControlProviderKit` | `({ httpClient, fetch, describeTransportError }) => SourceControlProviderKit` |
| `createSourceControlFetchAdapter` | `({ fetch: typeof fetch }) => SourceControlFetchPort` |
| `parseSourceControlProvidersFile` | `({ raw: string, readExtensions }) => { ok: true; descriptors: SourceControlProviderDescriptor[] } | { ok: false; reason: string }` |
| `loadSourceControlProviderRegistry` | `({ workspaceId, descriptorFileName, catalog, readExtensions, describeError }) => Promise<SourceControlProviderRegistry>` |
| `buildLoadedSourceControlProvider` | `({ loaded, kit }) => SourceControlProvider` |
| `buildSourceControlProvider` | `(required: BuildProviderArgs) => Promise<BuildSourceControlProviderResult>` |
| `buildSourceControlProviders` | `(required: BuildProvidersArgs) => Promise<{ providers; refusals; noProviderMessage }>` |
| `buildSourceControlProviderForApi` | `(required: BuildProvidersArgs & { baseUrl: string }) => Promise<BuildSourceControlProviderResult>` |
| `findReservedPath` | `({ folder }, { reservedPaths? } = {}) => string | undefined` |
| `isUnderWorkflowPath` | `({ filePath }, { workflowPaths? } = {}) => boolean` |
| `originOf` | `({ url: string }) => string | undefined` |
| `pickSourceControlProviderForApi` | `({ providers, baseUrl, noProviderMessage }) => { ok: true; provider } | { ok: false; message }` |
| `toCommitFile` | `({ outputFile, data: string | Buffer }) => CommitFile` |
| `previewCommitExport` | `(required: CommitExportArgs, optional: CommitOptions = {}) => Promise<PreviewCommitExportResult>` |
| `commitSiteToSourceControl` | `(required: CommitOrchestrationArgs, optional: CommitOptions = {}) => Promise<SourceControlCommitOutcome>` |

Consumer ports and shapes:

- `CommitFile = { path; data: string | Buffer }`; target `{ owner, repo }`; validator `(target) => string | null`.
- `CommitExportArgs` requires workspaceId/owner/repo/commitMessage/providerId, files `export({ outputDir }, { clean? }?) => Promise<ExportReport>`, layout `outputDirectory({ workspaceId, providerId, runId }) => string` and `cleanup({ outputDir }) => Promise<void>`, ids `next({}) => string`, safe `describeError({ error }) => string`. Orchestration adds credentials `resolve({ workspaceId, providerId }) => Promise<{ providerId; token } | null>` and adapter.commitSite. Options permit branch and validateTarget.
- Preview returns fileCount/totalBytes/paths on success; commit returns owner/repo/branch/branchCreated/commitSha/commitUrl/filesChanged/filesDeleted/divergedPaths. Failures carry ok false/code/message (see errors contract).
- Host facts require id/label/apiOrigin; optional maxFileBytes/reservedPaths/workflowPaths. A descriptor adds module and optional credential/i18n. These are metadata, not automatic provider enforcement.
- `SourceControlProviderOperations`: commitSite({ token, owner, repo, commitMessage, files }, { branch? }?); readAccountLabel({ token }); planFileWrite({ baseUrl, authorization, owner, repo, branch, files }); commitFiles(same target plus branch/commitMessage/files/plan); inspectBackupRepository(target plus folder, { branch? }?); uploadBackupBlob({ target, file: { path, content: Uint8Array } }); commitBackupTree(target plus branch/folder/commitMessage/parentCommitSha/baseTreeSha/htmlUrl/blobs). All return Promises of their exported discriminated result types; readAccountLabel returns string|null.
- `FileWritePlan` requires parentCommitSha/baseTreeSha/fileStates `{ path; exists }[]`; `WriteFile` has path/content. `BackupRepositoryState` adds branch/htmlUrl/folderExists; `UploadedBackupBlob` has path/blobSha/bytes/sha256. Credentialed target requires baseUrl/authorization/owner/repo. Provider call failures, file plan/commit/backup inspection result aliases and failure-code unions are exported.
- `HttpClientPort` is imported and re-exported from `@jini-ai/core/primitives`: `send({ request: HttpRequest }, { redirect? }?) => Promise<HttpResponse>`. Import request/response types from core. Requests retain method/url/headers and require `timeoutMs` or `idleTimeoutMs`; optional body/signal/maxResponseBytes/totalDeadlineMs and bounded binary response fields use the kernel contract. `SourceControlFetchPort({ url }, { init? }?) => Promise<Response>`.
- Kit exposes fetch({ url, init }), redirectGuardInit({ init }), assertNotRedirected({ response, hostName }), isRedirectRefusal({ error }), httpClient, describeTransportError({ error }) => `{ refusal: string | undefined; logDetail: string }`.
- Catalog `list({ workspaceId, descriptorFileName }) => Promise<readonly CatalogPackage[]>`; entries are refused(reason), inactive(descriptorText), or trusted(descriptorText/importModule({ relativePath })). The catalog must verify activation/digest/realpath containment before permitting import. `DescriptorExtensionReader({ entry, at })` returns ok/extensions or false/reason.
- Provider module `create({ kit })` returns operations plus optional validateTarget. Loaded provider pairs descriptor/pluginId/module. Registry exposes list({}), get({ providerId }), readonly refusals and switchedOff map.
- `BuildProviderArgs` requires workspaceId/providerId/kit/load({ workspaceId })/noProviderMessage({ registry, providerId }); plural builder omits providerId and accepts noProviderMessage({ registry }). Build result is ok/provider or false/message/refusals.

Exported names for these structural ports: `RepositoryTarget`, `RepositoryTargetValidator`, `CredentialResolverPort`, `FileSourcePort`, `CommitLayoutPort`, `SourceControlHostFacts`, `SourceControlProviderModule`, `LoadedSourceControlProvider`, `ProviderCatalogPort`, `DescriptorExtensions`, `DescribedTransportError`. `CommitSiteInput` requires token/owner/repo/commitMessage/files; `CommitBackupTreeInput` extends `CredentialedRepositoryTarget` with branch/folder/commitMessage/parentCommitSha/baseTreeSha/htmlUrl/blobs. `FileWriteState` is path/exists. `SourceControlCommitResult` is provider success or repository-not-found/no-changes/diverged/network-unreachable/provider-error. `ProviderCallFailure` is provider-error/message or network-unreachable/message/logDetail; `FileWritePlanResult` adds success/plan or branch-not-found; `CommitFilesResult` adds success/commitSha/commitUrl or diverged. `InspectBackupRepositoryResult` adds success/state or `InspectBackupRepositoryFailureCode`: repo-not-found/repo-not-private/no-push-permission/repo-empty/branch-not-found/folder-is-file. `CommitFailureCode` is the uppercase orchestration failure union in [errors.spec.md](errors.spec.md).

```ts
import { commitSiteToSourceControl } from '@jini-ai/devops/source-control';
const result = await commitSiteToSourceControl({
  workspaceId: 'w1', providerId: 'host-git', owner: 'team', repo: 'site', commitMessage: 'Publish content',
  files, layout, ids, describeError, credentials, adapter,
}, { branch: 'published' });
// Supply the export, isolated staging, credential and provider ports above.
```

## `./static-export` and `./static-export/node`

| Entry point | Current signature and return |
|---|---|
| `exportSite` | `(required: ExportSiteArgs, optional: ExportSiteOptions = {}) => Promise<ExportReport>` |
| `createExportFetchAdapter` | `({ fetch: typeof fetch }) => ExportFetchPort` |
| `firstExportFailure` | `({ report }) => ExportFailureSummary | undefined` |
| `normalizeBasePath` | `({ raw: string }) => string` |
| `rewriteRouteBodyForBasePath` | `({ path, body, basePath }) => string` |
| `redirectOutcomeFor` | `({ status, locationHeader: string | null }, { manifestTarget? } = {}) => { kind: 'failed'; reason } | { kind: 'redirect-to'; location }` |
| `renderRedirectStub` | `({ location }, { basePath? } = {}) => string` |
| `extractAssetUrls` | `({ html, prefixes: readonly string[] }) => string[]` |
| `extractCssUrls` | `({ css, cssUrl, prefixes }) => string[]` |
| `safeRelativeOutputFile` | `({ value: string }) => string` |
| `outputFileForUrl` | `({ url: string }, { contentRoute?: boolean } = {}) => string` |
| Node `createNodeArtifactWriter`, `createNodeAssetSource` | `({}) => ArtifactWriterPort / AssetSourcePort` |
| Node `createNodeAppFactory` | `({ createApp({}): RequestListener | Promise<RequestListener> }) => AppFactoryPort` |

`ExportSiteArgs` requires outputDir, manifest.build({}), app.open({}) => `{ baseUrl; close({}) }`, writer.prepare({ outputDir }, { clean? }?) and write({ outputDir, outputFile, data }), fetch({ url }, { init? }?), assetSource.listThemeFiles({ theme }), themeLayout.resolve({ theme }) => `{ pagesDir; assetUrlPrefix }`, assetUrlPrefixes, requestHeaders, security.transformHtml({ html }), errorPage `{ outputFile; acceptStatus({ status }) }`, safe describeError({ error }). Effects return Promises except layout/security/status/error callbacks. Options: clean/basePath/fetchTimeoutMs.

`RouteManifest` has routes `{ path, kind, label, redirectTarget?, redirectStatusCode? }[]`, skipped `{ reason, detail }[]`, activeTheme? `{ id, dir, apiVersion? }`. Corresponding `ManifestRouteKind`, `ManifestRoute`, `ManifestActiveTheme`, `ManifestSkip`, `RouteManifestPort`, `AppSession`, `AppFactoryPort`, `ArtifactWriterPort`, `AssetSourcePort`, `ThemeLayoutPort`, `ExportFetchPort` are exported. `ExportReport` contains outputDir, routes/assets succeeded and failed, skippedManifestEntries, unreferencedThemeFiles and optional basePath/rewrite warning. Exported route/asset records retain exact written data and contentType?; failed records retain path or url/kind/reason. `ExportFailureSummary` gives kind/identifier/reason/count. `ExportPathError` and `ExportOutputNotEmptyError` use inherited Error constructors.

Record aliases: `ExportedRoute` is path/kind/outputFile/data: string/contentType?: string|null; `ExportedAsset` is url/outputFile/data: Buffer/contentType?: string|null; `FailedRoute` is path/kind/reason; `FailedAsset` is url/reason.

```ts
import { exportSite, createExportFetchAdapter } from '@jini-ai/devops/static-export';
import { createNodeArtifactWriter, createNodeAssetSource, createNodeAppFactory } from '@jini-ai/devops/static-export/node';
const report = await exportSite({ outputDir: '/srv/export/run-1', manifest,
  app: createNodeAppFactory({ createApp }), writer: createNodeArtifactWriter({}),
  assetSource: createNodeAssetSource({}), fetch: createExportFetchAdapter({ fetch: hostFetch }),
  themeLayout, assetUrlPrefixes, requestHeaders, security, errorPage, describeError });
// Supply host routing/layout/security policy and the actual application factory.
```

## `./agent-jobs`

`parseCodexRun({ jsonl }, { decoder?: AgentEventDecoderPort } = {}) => ParsedCodexRun`; `buildCodexInvocation({ options: AgentJobOptions, prompt: string }) => CodexInvocation`; `runAgentJobs({ jobs: readonly AgentJob[], options, fs, runner }, { decoder? } = {}) => Promise<{ success: boolean; results: AgentJobResult[] }>`; `createNodeAgentCliRunner({ env: NodeJS.ProcessEnv }) => AgentCliRunnerPort`; `createNodeJobFilesystem({}) => JobFilesystemPort`; `readPromptJobs({ directory }) => Promise<AgentJob[]>`.

`AgentJob = { id; prompt }`; options require repository/executable/model/effort/sandbox ('read-only'|'workspace-write')/addDirs/concurrency/dispatchPrefix/outputDirectory. Invocation requires executable/cwd/args/stdin. Filesystem mkdir/exists/read/write/remove take path objects; write also text; all async. Runner.run(invocation plus jsonlPath/stderrPath) returns Promise<{ exitCode: number | null }> after log closure. Decoder.decode({ line }) returns unknown. Parsed result is success/finalMessage/usage or false/reason; job results contain id/status skipped|succeeded|failed plus optional exitCode/reason.

```ts
import { runAgentJobs, createNodeAgentCliRunner, createNodeJobFilesystem } from '@jini-ai/devops/agent-jobs';
const batch = await runAgentJobs({ jobs, options, fs: createNodeJobFilesystem({}), runner: createNodeAgentCliRunner({ env: approvedEnvironment }) });
// jobs, validated absolute-path options and approvedEnvironment are supplied by the host.
```

## `./packaging/electron` and `./packaging/electron/typescript`

All signatures below take one required object unless options are shown. Filesystem/SDK/process effects must be supplied by the consumer.

| Entry point | Required object; optional object; return |
|---|---|
| `treeQuietProblems` | `{ surface, watcherRunning, gitDirtyPaths?, movingPaths? } => string[]` |
| `isBundleInput` | `{ relPath } => boolean` |
| `shellStalenessFailure` | `{ builtAt, sourceAt, shell: StalenessShell } => string | null` |
| `parseNpmLsPaths` | `{ stdout, modulesDir, separator } => string[]` |
| `prebuildTarget` | `{ entryName } => PrebuildBuilt | undefined` |
| `resolveTargets` | `{ host: Target }`, `{ platform?, arch? } = {} => Target[]` |
| `resolveNpmLsCommand` | `{ platform, execPath }`, `{ npmExecPath? } = {} => { command; args; shell }` |
| `strippableReason` | `{ relPath, keepScopes: ReadonlySet<string> } => 'declaration' | 'sourceMap' | undefined` |
| `filesUnderPrefixes` | `{ headerFiles: Record<string, AsarHeaderNode> | undefined, prefixes } => string[]` |
| `toArchiveEntryPath` | `{ relPath, separator } => string` |
| `verifyAsarAgainstSource` | `{ archivePath, sourceRoot, prefixes, separator, fs, archive } => AsarVerification` |
| `isEmptyVerification` | `{ checkedCount } => boolean` |
| `formatMismatchReport` | `{ mismatches: readonly AsarMismatch[] } => string` |
| `bundledNpmFailures` | `{ resourcesDirs, requiredFiles, fs } => string[]` |
| `isExcluded` | `{ name, excluded: ReadonlySet<string> } => boolean` |
| `declaredDependencies` | `{ packageDir, fs } => string[]` |
| `stageDir` | `{ source, destination, fs }`, `{ dropNestedModules? } = {} => void` |
| `stageTransitiveDependencies` | `{ roots, outDir, excluded, fs, resolver } => number` copied packages |
| `stagedPackageDirs` | `{ modulesDir, fs } => string[]` |
| `assertClosureComplete` | `{ outDir, excluded, fs } => void` |
| `stagePackedWorkspace` | `{ repoRoot, packagesDir, rootNames, destDir, packer } => { closure; tarballPathByName: ReadonlyMap<string, string> }` |
| `productionDependencyOutput` | `{ command, args, cwd, shell, runner } => string` |
| `newestMtime`, `diskBytes` | `{ absolutePath, fs } => number` |
| `stripNonRuntimeFiles` | `{ outDir, keepScopes, fs } => StripTally` |
| `pruneNativePrebuilds` | `{ outDir, targets: readonly Target[], fs } => PruneTally` |
| `stagePayloadFiles` | `{ repoRoot, outDir, relativePaths, fs } => void` |
| `hasNativeBinaryMagic` | `{ bytes: Uint8Array } => boolean` |
| `stageBundledNpm` | `{ npmSource, outDir, marker, droppedDirectoryNames, droppedFileSuffixes, fs } => { fileCount; bytes }` |
| `undeclaredDistImports` | `(required: DistImportInput) => string[]` |
| `assertDistImportsDeclared` | `(required: DistImportInput) => void` |
| `observeMovingPaths` | `{ roots, intervalMs, snapshots, clock } => Promise<string[]>` |
| `createNodePackagingFilesystem` | `{}` => `PackagingFilesystemPort` |
| `createNodePackageResolver` | `{ fs } => PackageResolverPort` |
| `createAsarArchiveReader` | `{ asar: { getRawHeader(path); extractFile(path, entryPath) } } => ArchiveReaderPort` |
| TypeScript `createTypeScriptImportReader` | `{ compiler: typeof import('typescript') } => ImportReaderPort` |

Packaging ports are synchronous except `SleepPort.sleep({ milliseconds })`. `PackagingFilesystemPort` supplies exists/read/stat/entries/realpath/copy/remove; stat returns `FileInfo { kind: 'file'|'directory'|'other'; mtimeMs; diskBytes }` with lstat semantics, read returns Uint8Array. Copy takes `{ from, to }`, optional dropNestedModules/exclude({ path, directory }). Resolver.resolve({ fromDirectory, packageName }) returns string|undefined. `ProcessRunnerPort.run({ command, args, cwd, shell })` returns stdout/exitCode. ArchiveReaderPort.header({ archivePath }) returns files tree; read({ archivePath, entryPath }) returns bytes. `AsarHeaderNode` has optional files/link/size/offset. `ImportReaderPort.imports({ file, source })` uses an AST; `ImportAliasPort.resolve({ specifier, fromFile, distDir })` returns string|undefined. `DistImportInput` combines distDir/entry/declared/fs/imports/aliases. `WorkspacePackagePackerPort.pack` takes repoRoot/packagesDir/rootNames/destDir and returns closure/map. `SnapshotPort.snapshot({ roots })` returns a readonly path->fingerprint map.

`Target` has platform/arch; `PrebuildBuilt` platform/architectures; `StalenessShell` relative/marker/buildWith. `AsarMismatch` relPath/reason; `AsarVerification` checkedCount/mismatches. `StripTally` declaration/sourceMap/coverage/bytes; `PruneTally` prebuilds/buildInputs/bytes. Inventories are supplied explicitly; no package layout is assumed beyond staged node_modules and native prebuild conventions.

```ts
import { createNodePackagingFilesystem, undeclaredDistImports } from '@jini-ai/devops/packaging/electron';
import { createTypeScriptImportReader } from '@jini-ai/devops/packaging/electron/typescript';
const problems = undeclaredDistImports({ distDir, entry, declared, aliases,
  fs: createNodePackagingFilesystem({}), imports: createTypeScriptImportReader({ compiler }) });
// Host supplies built paths, declarations, aliases and its TypeScript compiler module.
```

## `./checks/published-types`, `./checks/coverage`, `./checks/node`, `./local-dev`

| Published-types entry | Current signature and return |
|---|---|
| `registryDependencies` | `({ manifest: DependencyManifest, scope: string }) => Record<string, string>` |
| `parseDiagnosticBlocks` | `({ output: string }) => string[]` |
| `check` | `({ projects, scope, fs, runner, installer }, { logger?: CheckLoggerPort } = {}) => Promise<PublishedTypesReport>` |
| `diagnosePublishedTypes` | `({ scope, logs: readonly TypecheckLog[] }) => TypecheckDiagnosis` |

`DependencyManifest` permits dependencies/devDependencies/overrides. `PublishedTypesProject` has key/directory/manifestPath/mode: links|drift|published; compile modes additionally require shadowAnchor/scratchParent/prerequisites/compiler. `LinksProject`, `CompileProject` are exported variants. Report contains ok/projects; each `PublishedTypesResult` carries projectKey/status/versions/linkedPackages/diagnostics/baselineDiagnostics/output. `PublishedTypesStatus` values appear in the errors contract. `TypecheckLog` combines projectKey with ProcessResult; diagnosis returns ok and failures augmented with hits.

| Coverage entry | Required object; optional object; return |
|---|---|
| `pct` | `{ hit, found } => number` |
| `toRepoRelative` | `{ sourceFile, repoRoot } => string` |
| `isIntegrationTestFile` | `{ file, suffixes, directories } => boolean` |
| `isMeasurableSourceFile` | `{ file, rules: SourceClassificationRules } => boolean` |
| `parseLcov` | `{ text, repoRoot } => FileCoverage[]` |
| `loadLcov` | `{ lcovPath, repoRoot, reader } => FileCoverage[]` |
| `loadRouteCoverage` | `{ lcovPath, repoRoot, reader, isMeasurable } => FileCoverage[]` |
| `mergeCoverage` | `{ reports, isMeasurable } => ReadonlyMap<string, FileCoverage>` |
| `evaluateFloor` | `{ files, floors: CoverageFloor } => FloorResult` |
| `evaluateArea` | `{ area: AreaFloor, all, isMeasurable } => AreaFloorResult` |
| `resolveBaseRef` | `{ fallbackRef, remote }`, `{ override?, positional?, pullRequestBase?, eventBefore? } = {} => string` |
| `evaluateFileTiers` | `{ file, unitRec, integrationRec, thresholds } => FileTierEvaluation` |
| `checkCoverageDiff` | `{ baseRef, repoRoot, sourceRoots, diff, reader, isMeasurable, unitCoveragePath, integrationCoveragePath, thresholds } => Promise<{ ok; files }>` |
| `applyBaseline` | `{ contaminated, baselineSet } => readonly GatedVerdict[]` |
| `parseBaseline` | `{ baselineJson } => ReadonlySet<string>` |
| `serializeBaseline` | `{ paths }`, `{ comment? } = {} => string` |
| `parseArgs` | `{ argv } => ParsedArgs` |
| `parseLcovBlocks` | `{ lcovText } => LcovBlock[]` |
| `isPureReExportBarrelSource` | `{ sourceText } => boolean` |
| `classifyBlock` | `{ block, repoRoot, isFirstParty }`, `{ sourceText? } = {} => BlockVerdict` |
| `checkCoverageIntegrity` | `{ lcovText, repoRoot, isFirstParty }`, `{ readSource? } = {} => IntegrityReport` |
| `isMeasurableSource` | `{ file } => boolean` |
| `isInExcludedDir` | `{ file, excludeDirs } => boolean` |
| `parseNodeTestScript` | `{ script } => RunnerGlobs[]` |
| `runnerSplitDrift` | `{ passes, scriptPasses } => string[]` |
| `evaluateDiskArea` | `{ area: CoverageArea, onDisk, coverage } => DiskAreaResult` |
| `formatDiskArea` | `{ result, area } => string` |

Coverage exported types: `FileCoverage` (file, lf/lh/brf/brh/fnf/fnh), `SourceClassificationRules` (prefixes/extensions/excludedDirectories/excludedBasenames/testPattern), `SourceClassifier({ file }) => boolean`, `CoverageFloor` (line/branch/funcs), `AreaFloor` (+prefix), `FloorResult` (count/percentages/failures), `AreaFloorResult` (+area), `TierThresholds` (unit/integration), `TierResult` (ok/pctValue/detail), `FileTierEvaluation` (file/unit/integration/ok), `DiffPort.changedFiles({ baseRef, repoRoot, sourceRoots }) => Promise<readonly string[]>`, `LcovBlock` (file/fnda/da/fnf?/fnh?), `BlockStatus`, `BlockVerdict` (file/status/severe/reason), `IntegrityReport` (contaminated/evaluated/skipped), `GatedVerdict` (+baselined/fails), `ParsedArgs` (lcovArg?/baselinePath?/updateBaseline), `LcovCounters`, `CoverageAxis`, `CoverageArea` (id/dirs?/excludeDirs?/extensions?/floors?/knownUnmeasured?/minFilesOnDisk?), `RunnerGlobs` (nodeArgs/globs), `TestPass` (+id), `DiskAreaResult` (id/actual/measuredCount/onDiskCount/unmeasured/newlyUnmeasured/recovered/failures). `DEFAULT_BASELINE_COMMENT` is exported. Source readers take readText({ path }); optional integrity readSource({ file }) returns string|undefined.

Check ports: `ProcessRequest { command; args; cwd }`, `ProcessResult { exitCode: number | null; stdout; stderr }`, async `ProcessRunnerPort.run(request)`; `PackageInstallerPort.install({ directory }) => Promise<ProcessResult>`; `CheckLoggerPort.log({ projectKey, status, message }) => void`. `FilesystemPort` provides readText/exists/isSymbolicLink/readDirectory/writeText/createTempDirectory/createDirectory/ensureDirectory/copyDirectory/removeDirectory, synchronously with object arguments; createDirectory must fail for existing paths. `SourceReaderPort` is also exported by coverage. These differ from the synchronous packaging ports.

Node factories: `createNodeFilesystem({}) => FilesystemPort`; `createNodeEnvLoader({}) => EnvLoaderPort`; `createNodeProcessRunner({}, { maxBuffer?: number; timeoutMs?: number } = {}) => ProcessRunnerPort`; `createNpmInstaller({ runner, command }, { args?: readonly string[] } = {}) => PackageInstallerPort`. They are opt-in host adapters.

Local-dev APIs: `loadRepoRootEnvFile({ environmentFile, fs: EnvironmentFilesystemPort, loader: EnvLoaderPort }) => boolean`; `parseLsofListeners({ stdout }) => PortListener[]`; `listenersOn({ port, runner, listenerCommand({ port }): ProcessRequest }) => Promise<PortListener[]>`. Ports expose exists({ path }) and load({ path }); listener records have pid/command strings.

```ts
import { check } from '@jini-ai/devops/checks/published-types';
import { parseLcov, evaluateFloor } from '@jini-ai/devops/checks/coverage';
import { createNodeFilesystem, createNodeProcessRunner, createNpmInstaller, createNodeEnvLoader } from '@jini-ai/devops/checks/node';
import { loadRepoRootEnvFile } from '@jini-ai/devops/local-dev';
const fs = createNodeFilesystem({});
const runner = createNodeProcessRunner({});
const report = await check({ projects, scope: '@example', fs, runner,
  installer: createNpmInstaller({ runner, command: hostNpmExecutable }) });
const floor = evaluateFloor({ files: parseLcov({ text: lcovText, repoRoot }), floors: { line: 90, branch: 80, funcs: 90 } });
loadRepoRootEnvFile({ environmentFile, fs, loader: createNodeEnvLoader({}) });
// Host supplies projects, executable, captured LCOV and filesystem paths.
```

Evidence: current subpath barrels/implementations and their existing tests, read without execution. Future provider discovery, deploy orchestration and CI/CD design material is not an implemented API.

## ./deploy/node

`createNodeReachabilityPorts({}, {fetch?: typeof globalThis.fetch,lookupImpl?: typeof node:dns.lookup} = {}): Pick<ReachabilityArgs, "fetch"|"guard">` supplies URL admission and connection-time DNS validation. The default undici dispatcher is shared/lazy; a lookup override owns an instance dispatcher. The selected native fetch receives dispatcher and RequestInit. Universal deploy code requires these ports and does not import this Node adapter.

## Current manifest boundary

The current `package.json` exposes `./source-control`, `./static-export`, `./static-export/node`, `./packaging/electron`, `./packaging/electron/typescript`, `./agent-jobs`, `.`, `./deploy`, `./checks/published-types`, `./checks/coverage`, `./checks/node`, `./local-dev`, `./deploy/node`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
