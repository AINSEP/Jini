Spec ID: SPEC-JINI-SANDBOX-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:0d69153730953f78c62d19344ba7bd152d604c00814c91ab3820581ba24b7b94
spec_mode: reverse_spec


# API Contract: sandbox

## Purpose and entry points

The export map exposes `@jini-ai/sandbox/core`, `@jini-ai/sandbox/e2b`, and `@jini-ai/sandbox/node-worker`, with ESM and CommonJS branches. There is no root import. `./core` loads no optional adapter. `./e2b` requires the optional `@e2b/code-interpreter` peer; `./node-worker` uses Node worker threads.

Signatures describe current source. `optional = {}` means a source default; `optional?` means the declaration permits omission. One-object and zero-argument APIs are current exceptions to the `(required, optional = {})` convention. This specification does not fabricate converted methods or relocate shared types.

## `./core`: consumer-supplied provider

```ts
interface SandboxProviderPort {
  boot(required: Record<string, never>, optional?: BootOptions): Promise<SandboxSession>;
}
interface SandboxSession {
  mountFiles(required: { files: readonly SandboxFile[] }): Promise<void>;
  readFile(required: { path: string }): Promise<Uint8Array>;
  listFiles(required: Record<string, never>, optional?: { directory?: string }): Promise<readonly string[]>;
  runCommand(required: { command: string }, optional?: RunCommandOptions & { args?: readonly string[] }): Promise<CommandResult>;
  installDependencies(required: Record<string, never>, optional?: RunCommandOptions & { packages?: readonly string[] }): Promise<CommandResult>;
  startProcess(required: { command: string }, optional?: { args?: readonly string[] }): Promise<ProcessHandle>;
  getPreview(): Promise<PreviewTarget>;
  onFileChange(required: { listener: (event: FileChangeEvent) => void }): Unsubscribe;
  teardown(): Promise<void>;
}
interface ProcessHandle {
  kill(): Promise<void>;
  onOutput(required: { listener: (chunk: ProcessOutputChunk) => void }): Unsubscribe;
}
```

Data: `BootOptions = {template?: string}`, `SandboxFile = {path: string, content: string|Uint8Array}`, `CommandResult = {stdout: string, stderr: string, exitCode: number}`, `PreviewTarget = {url: string}`, `FileChangeEvent = {path: string, kind: FileChangeKind}`, `FileChangeKind = 'created'|'modified'|'deleted'`, `ProcessOutputChunk = {stream:'stdout'|'stderr', text:string}`, `RunCommandOptions = {onOutput?: (chunk: ProcessOutputChunk) => void}`, `Unsubscribe = () => void`. Paths conventionally refer to the project root.

Runtime class: `new SandboxOperationError({category: SandboxErrorCategory, message: string}, optional?: ErrorOptions)`. Error categories and recovery are in [errors.spec.md](errors.spec.md).

```ts
import type { SandboxProviderPort } from '@jini-ai/sandbox/core';
async function readText(provider: SandboxProviderPort) {
  const session = await provider.boot({});
  try {
    await session.mountFiles({ files: [{ path: 'message.txt', content: 'hello' }] });
    return new TextDecoder().decode(await session.readFile({ path: 'message.txt' }));
  } finally { await session.teardown(); }
}
```

## `./e2b`: provider and utilities

| Current signature | Return / dependency |
|---|---|
| `createE2bSandboxProvider({}, optional = config)` | `SandboxProviderPort`; SDK or injected SDK factory |
| `wrapE2bSandbox({handle: E2bSandboxHandle, config: E2bSessionConfig}, optional = {fetchImpl?})` | `Promise<SandboxSession>`; caller owns native handle |
| `mapE2bFileChangeKind({type: E2bFilesystemEventType})` | `FileChangeKind|null` |
| `categorizeE2bError({error: unknown})` | `SandboxErrorCategory` |
| `toArrayBuffer({bytes: Uint8Array})` | `ArrayBuffer` |
| `shellQuote({value: string})` | `string` |
| `DEFAULT_VITE_REACT_TEMPLATE` | `readonly SandboxFile[]`; eight starter files |

Provider configuration exports `E2bProviderConfig` with optional `apiKey`, `timeoutMs`, `projectRoot`, `previewPort`, `previewCheckTimeoutMs`. The actual factory also accepts `createSandbox?({options: {apiKey?, timeoutMs?, template?}}): Promise<Sandbox>` and `fetchImpl?: typeof fetch`. Omitted credentials/lifetime are passed through as absent to the SDK; the package does not perform its own environment lookup. `boot({}, {template?})` creates a new SDK sandbox and wraps it.

`E2bSessionConfig` requires `{projectRoot: string, previewPort: number, previewCheckTimeoutMs: number}`. The handle port requires `commands.run({command}, optional?: {cwd?, onStdout?, onStderr?}): Promise<E2bCommandResult>` and a background overload `commands.run({command, background:true}, optional?): Promise<E2bCommandHandle>`; stream callbacks receive `{data:string}`. Filesystem methods: `write({files: readonly E2bWriteEntry[]}): Promise<unknown>`, `read({path, format:'bytes'}): Promise<Uint8Array>`, `list({path}, optional?: {depth?:number}): Promise<readonly E2bEntryInfo[]>`, `watchDir({path, onEvent}, optional?: {recursive?:boolean}): Promise<E2bWatchHandle>`. `getHost({port}): string` and `kill(): Promise<boolean>` complete the handle.

Other exported adapter types: `E2bCommandResult` mirrors command result; `E2bCommandHandle.kill(): Promise<boolean>`; `E2bRunOptions` includes `background?`, `cwd?`, stream callbacks; `E2bWriteEntry = {path, data:string|ArrayBuffer}`; `E2bEntryInfo = {path, type?: E2bFileType}`; `E2bFileType = 'file'|'dir'|'symlink'`; `E2bFilesystemEvent = {name:string, type:E2bFilesystemEventType}`; event types are `'chmod'|'create'|'remove'|'rename'|'write'`; `E2bWatchHandle.stop(): Promise<void>`. `E2bCommands` and `E2bFilesystem` name the method groups above.

```ts
import { createE2bSandboxProvider, DEFAULT_VITE_REACT_TEMPLATE } from '@jini-ai/sandbox/e2b';
const provider = createE2bSandboxProvider({}, { apiKey: 'consumer-supplied-key' });
const session = await provider.boot({});
try {
  await session.mountFiles({ files: DEFAULT_VITE_REACT_TEMPLATE });
  await session.installDependencies({});
  const server = await session.startProcess({ command: 'npm' }, { args: ['run', 'dev'] });
  // Host polls getPreview() and attaches output listeners according to its own UI policy.
} finally { await session.teardown(); }
```

`toE2bHandle` is exported only by an internal module for direct tests; it is not available through `./e2b` or the export map.

## `./node-worker`: bounded invocation

| Current signature | Return |
|---|---|
| `resolveDefaultTimeoutMs({rawValue: string|undefined, defaultTimeoutMs: number, maxTimeoutMs: number})` | `number` |
| `runInWorkerSandbox<TPayload,TResult>(required: WorkerSandboxRequired<TPayload> & {decodeResult: ({message:unknown}) => TResult}, optional: WorkerSandboxOptions = {})` | `Promise<TResult>` |
| `renderInWorkerSandbox<TPayload>(required: WorkerSandboxRequired<TPayload>, optional: WorkerSandboxOptions = {})` | `Promise<string>` |
| `createNodeWorkerFactory({env: NodeJS.ProcessEnv}, optional: NodeWorkerFactoryOptions = {})` | `WorkerFactory` |
| `createNodeWorkerScheduler({})` | `WorkerScheduler` |

Required worker data/ports: `{workerEntry: string|URL, input: TPayload, errorLabel:string, defaultTimeoutMs:number, defaultResourceLimits:ResourceLimits, workerFactory:WorkerFactory, scheduler:WorkerScheduler}`. Options replace `timeoutMs` or the entire `resourceLimits` object. Payload must be structured-cloneable. Decoder runs synchronously on the first message.

`WorkerFactory.spawn({workerEntry, payload, resourceLimits}): WorkerHandle`. `WorkerHandle.once(WorkerSubscription): void` subscribes to `{event:'message', listener:({message})=>void}`, `{event:'error', listener:({error:Error})=>void}`, or `{event:'exit', listener:({code:number})=>void}`; `terminate(): Promise<number>` requests teardown. `WorkerScheduler.schedule({delayMs, run}): () => void` must defer execution until after returning cancellation. `NodeWorkerFactoryOptions` has `typescriptBootstrap?: {registerModulePath:string}`; that mode requires an absolute string entry. `SandboxRenderResult = {ok:true, html:string}|{ok:false, error:string}` is the render wire shape.

```ts
import { createNodeWorkerFactory, createNodeWorkerScheduler, renderInWorkerSandbox } from '@jini-ai/sandbox/node-worker';
const html = await renderInWorkerSandbox({
  workerEntry: new URL('./renderer-worker.js', import.meta.url), input: { text: 'hello' },
  errorLabel: 'Preview', defaultTimeoutMs: 5000,
  defaultResourceLimits: { maxOldGenerationSizeMb: 64 },
  workerFactory: createNodeWorkerFactory({ env: {} }), scheduler: createNodeWorkerScheduler({}),
});
// The supplied worker posts {ok:true, html:string} using parentPort.
```

Sources: [core](../../src/core/ports.ts), [E2B barrel](../../src/e2b/index.ts), [provider](../../src/e2b/provider.ts), [handle](../../src/e2b/e2b-sandbox-handle.ts), [worker](../../src/node-worker.ts). No other package subpaths are declared.

## Current manifest boundary

The current `package.json` exposes `./core`, `./e2b`, `./node-worker`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
