# Devops API composition

Every public helper/factory receives one required argument object and, when
needed, one optional argument object. Port methods use the same convention.
SDK-facing adapters alone translate to a native library's calling convention.
All subpaths declare the Node runtime. The root entry is a domain marker.

| Subpath | Required dependencies and policy | Main exports |
| --- | --- | --- |
| `./deploy` | Targets; reachability fetch; polling clock/sleep; host toolkit and credentials | `publishDeploy`, `createDeployPublishToolRegistration`, naming, redirect and reachability helpers; `DeployTargetModule`, `DeployHostKit` |
| `./source-control` | Trusted catalog, descriptor filename/extensions, guarded HTTP/fetch, error descriptions, credentials, exporter, unique artifact layout and IDs | Provider registry/build/selection helpers, `createSourceControlProviderKit`, `repositoryTargetError`, `previewCommitExport`, `commitSiteToSourceControl` |
| `./static-export` | Manifest, app session, artifact writer, object fetch, asset/theme inventory/layout, asset URL prefixes, request headers, security and error-page policies | `exportSite`, path/base-path/asset/redirect transforms, `firstExportFailure` |
| `./static-export/node` | Host app factory; absolute, caller-owned artifact/theme paths | `createNodeAppFactory`, `createNodeArtifactWriter`, `createNodeAssetSource` |
| `./packaging/electron` | Filesystem, resolver, archive/parser/alias/packer/process/snapshot/sleep ports; explicit roots and staging/native/exclusion rules | Staging/closure/pruning, archive verification, import and stability policies; Node and archive SDK adapters |
| `./packaging/electron/typescript` | The host's TypeScript compiler module | `createTypeScriptImportReader` |
| `./agent-jobs` | Jobs; repository/executable/model/effort/sandbox/addDirs/concurrency/dispatchPrefix/outputDirectory; filesystem and CLI runner | `runAgentJobs`, `parseCodexRun`, `buildCodexInvocation`, Node CLI/filesystem adapters, `readPromptJobs` |
| `./checks/published-types` | Projects, npm scope, filesystem, process runner and installer; scratch/shadow paths and compiler requests | `check`, `registryDependencies`, `parseDiagnosticBlocks`, `diagnosePublishedTypes` |
| `./checks/coverage` | LCOV/root/source inventories, classifiers, thresholds, baseline/diff/source-reader ports | Parsing, floors, tier/diff, integrity, baseline and disk/runner inventory helpers |
| `./checks/node` | Executable/runner for installation; Node adapter factories take `{}` when no inputs are needed | `createNodeFilesystem`, `createNodeProcessRunner`, `createNodeEnvLoader`, `createNpmInstaller` |
| `./local-dev` | Complete environment-file path/filesystem/loader; listener command factory/runner | `loadRepoRootEnvFile`, `parseLsofListeners`, `listenersOn` |

## Fetch composition

Source control and static export receive `fetch({ url }, { init })`. Select the
transport explicitly at the host boundary:

```ts
import { createSourceControlFetchAdapter, createSourceControlProviderKit } from '@jini-ai/devops/source-control';
import { createExportFetchAdapter, exportSite } from '@jini-ai/devops/static-export';

const kit = createSourceControlProviderKit({
  httpClient,
  fetch: createSourceControlFetchAdapter({ fetch: guardedFetch }),
  describeTransportError,
});
const report = await exportSite({
  outputDir, manifest, app, writer, assetSource, themeLayout,
  assetUrlPrefixes, requestHeaders, security, errorPage, describeError,
  fetch: createExportFetchAdapter({ fetch: hostFetch }),
}, { clean: true, basePath: '/preview' });
```

The kit and exporter force manual redirects. The host's transport owns DNS/egress
policy and credential redaction. `DeployHostKit.fetch({ url, timeoutMs }, { init })`
additionally requires a timeout, while reachability uses `{ url }` and its own
options. Bind these distinct port shapes explicitly rather than sharing an
unadapted method. Native adapters preserve request/response identity and failures.

## Shared HTTP and delay contracts

`SourceControlProviderKit.httpClient` is the canonical `HttpClientPort` from
`@jini-ai/core/primitives`, also exported by `./source-control`. Import request
and response types directly from core; the old `SourceControlHttpRequest` and
`SourceControlHttpResponse` declarations are removed. Request fields fit the
kernel contract, including the existing `timeoutMs` socket-idle budget:

```ts
import type { HttpClientPort, HttpRequest } from '@jini-ai/core/primitives';

const request: HttpRequest = {
  method: 'GET', url: 'https://provider.example/api', headers: {}, timeoutMs: 5_000,
};
async function readProvider({ httpClient }: { httpClient: HttpClientPort }) {
  return httpClient.send({ request }, { redirect: 'manual' });
}
```

The kit preserves the guarded client instance and does not adapt or resend its
requests. Core additionally supports `idleTimeoutMs`, whole-operation deadlines
and bounded binary response data. The host still owns egress policy and redaction.

`./packaging/electron` exports `SleepPort`, with
`sleep({ milliseconds }): Promise<void>`. `observeMovingPaths` still receives it
under the existing `clock` argument and compares two snapshots across the same
interval; only the port type's name changes.

## Provider and artifact ownership

The trusted catalog admits modules only after activation, digest verification
and realpath containment. Descriptor filenames and UI/help messages are required
host inputs. Old provider modules need an ABI adapter for object arguments.
Registry instances are loaded fresh, with deterministic provider order.

Commit orchestration checks provider/credential identity, retains bytes and blocks
both route and asset failures. Layout ports allocate unique per-run output
directories and clean them after export. Static export closes every opened app
session in `finally`; filesystem adapters reject escaping paths and symlinks.
The host owns output roots and isolation from hostile concurrent filesystem writes.

Packaging receives explicit exclusion, native target, payload and source-map rules.
`stagePackedWorkspace` delegates to the host's existing workspace packer port.
Archive and AST adapters bind the host's maintained SDKs; only the TypeScript
adapter's declarations require the optional `typescript@^5.6.0` peer. No new runtime
archive dependency is needed.

## Convention migration

Existing deploy exports retain their names. Required data/dependencies go in the
first object, publish metadata/response headers and registration options in the
second. `DeployError` takes `({ message }, { status, details, code })`. Polling
receives `now({})`, `sleep({ ms })`, and fetch ports explicitly. Detectors receive
`{ resp, body }`. Deploy's loose `Record<string, unknown>` option and metadata
bags are named `UnknownRecord`; they do not require JSON-serializable values.

Runtime tests and packaging remain deferred under the owner's directive; the
approved build phase permits this package's typecheck and build.

## Deployment outbound policy

Reachability now requires `{ url, fetch, guard }` (polling also requires clock/sleep).
`DeploymentUrlGuard.assertSafeUrl({ raw, label })` supplies synchronous URL policy;
the paired fetch port MUST enforce DNS policy at connection time. A separate DNS
preflight is insufficient because it allows rebinding before the socket connects.
The deploy core imports neither platform nor undici.

```ts
import { checkDeploymentUrl } from '@jini-ai/devops/deploy';
import { createNodeReachabilityPorts } from '@jini-ai/devops/deploy/node';
const ports = createNodeReachabilityPorts({});
await checkDeploymentUrl({ url: 'https://example.com', ...ports });
```

The Node defaults reject unsafe public URLs and pin validation to the connection
through platform's validating lookup. `lookupImpl` overrides move from probe
options to `createNodeReachabilityPorts({}, { lookupImpl?, fetch? })`.
Default dispatchers remain shared; each override binding retains its own lazy
pool. HTTPS-only probes, manual redirects and existing deadlines are preserved.
The Node adapter attaches the validating Agent as a native fetch runtime extension,
preserving its identity across differing Node and undici dispatcher type versions.
