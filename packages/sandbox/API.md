# Sandbox API

Public calls use `(requiredArgs, optionalArgs?)`. Existing names remain available. This is a breaking signature change, including the session and provider ports.

| Entry | Runtime | API |
| --- | --- | --- |
| `@jini-ai/sandbox/core` | Universal | Driver-neutral session/provider ports and `new SandboxOperationError({ category, message }, { cause? })` |
| `@jini-ai/sandbox/e2b` | Node | `createE2bSandboxProvider({}, config?)`, E2B session adapter and template data |
| `@jini-ai/sandbox/node-worker` | Node | `runInWorkerSandbox(requiredHarness, budgets?)`, `renderInWorkerSandbox(requiredHarness, budgets?)`, `resolveDefaultTimeoutMs({ rawValue, defaultTimeoutMs, maxTimeoutMs })`, `createNodeWorkerFactory({ env }, bootstrap?)`, `createNodeWorkerScheduler({})` |

Session methods:

```ts
const session = await provider.boot({}, { template: 'host-image' });
await session.mountFiles({ files });
const bytes = await session.readFile({ path: 'src/main.ts' });
const paths = await session.listFiles({}, { directory: 'src' });
await session.runCommand({ command: 'npm' }, { args: ['run', 'build'], onOutput });
await session.installDependencies({}, { packages: ['example'], onOutput });
const process = await session.startProcess({ command: 'npm' }, { args: ['run', 'dev'] });
const unsubscribeOutput = process.onOutput({ listener: onOutput });
const unsubscribeFiles = session.onFileChange({ listener: onFileChange });
await session.teardown();
```

`onOutput` receives `{ stream, text }`; `onFileChange` receives `{ path, kind }`. E2B handle output callbacks receive `{ data }`; the SDK adapter translates native strings. Foreground E2B commands resolve with `E2bCommandResult`; background commands resolve with `E2bCommandHandle`. The adapter types its implementation against that port union while retaining the mode-specific overloads. `getPreview`, `kill`, `teardown` and unsubscribe functions carry no data. Core imports no E2B or worker adapter.

Worker harness dependencies are required: `workerEntry`, `input`, `errorLabel`, `defaultTimeoutMs`, `defaultResourceLimits`, `workerFactory` and `scheduler`. The generic runner additionally requires `decodeResult({ message })`. Caller options override timeout/resource limits. The render helper preserves the `{ ok, html/error }` reply shape. First reply, error, timeout or exit settles the operation and terminates the worker. Event registration failure also terminates it.

Custom worker ports use `once({ event, listener })`: listener payloads are `{ message }`, `{ error }` or `{ code }`. `spawn({ workerEntry, payload, resourceLimits })` owns execution, and the scheduler must defer work until after `schedule` returns. Supply JS entry paths or URLs. For TypeScript entries, explicitly supply `typescriptBootstrap: { registerModulePath }` and an absolute entry path. No application layout or environment name is selected by the harness.
