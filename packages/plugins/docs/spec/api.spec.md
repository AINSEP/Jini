Spec ID: SPEC-JINI-PLUGINS-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:227299b6b1370ef1e9f53cd05e2080069aed78f13fcef0b7cb24c2c4bc30d585
spec_mode: reverse_spec


# API Contract: Plugin Glue

## Purpose and entry points

`@jini-ai/plugins/glue` is the sole exported subpath. There is no package-root import or implemented host-plugin format. The runtime is universal; the consumer supplies vocabulary and all effects. Evidence: `package.json`, `src/glue/index.ts`, and its re-exported modules.

## Callable contracts

These are current source signatures. Each function accepts `(required, optional = {})`; the optional record is empty and ignored.

| Entry point | Required record | Return |
|---|---|---|
| `validateGlueManifest` | `{ manifest: unknown, vocabulary: GlueVocabulary }` | `{ errors: readonly GlueManifestValidationError[] }` |
| `resolveCallSiteDispatch` | `{ callSite: string, wiredCallSites: readonly string[] }` | `{ wired: true } \| { wired: false, code: 'UNWIRED_CALL_SITE' }` |
| `buildGlueCapabilityGate` | `{ moduleId: string, vocabulary: readonly string[], capabilities: readonly string[], coreDelegates: Readonly<Record<string, GlueCapabilityDelegate>> }` | Frozen `Readonly<Record<string, GlueCapabilityDelegate>>` |
| `dispatchGlueAttachment` | `{ moduleId: string, callSite: string, payload: Readonly<Record<string, unknown>>, wiredCallSites: readonly string[], dispatch: GlueDispatcherPort }` | Unwired result or `{ wired: true, result: unknown }` |
| `attachGlueContentLifecycle` | `{ moduleId: string, filter: GlueContentLifecycleFilter, declaredFields: readonly GlueFieldDecl[], hostPort: Pick<GlueHostPort, 'attachContentLifecycleFilter'> }` | `void` |
| `subscribeGlueEvent` | `{ moduleId: string, eventName: string, handler: (required: { payload: unknown }) => void \| Promise<void>, hostPort: Pick<GlueHostPort, 'subscribeEvent'> }` | `void` |
| `mergeGlueToolRegistrations` | `{ coreToolIds: readonly string[], glueModules: readonly GlueToolModuleContribution[], hostPort: Pick<GlueHostPort, 'registerTools'> }` | `{ registeredModuleIds: readonly string[], quarantined: readonly GlueToolQuarantineEntry[] }` |
| `new GlueCapabilityDeniedError` | `{ moduleId: string, capability: string }` | Error with `moduleId`, `capability`, and `name` |

`dispatchGlueAttachment` is synchronous: if the delegate returns a promise, `result` holds that promise. It does not await it.

## Data and dependency contracts

`GlueVocabulary` supplies `capabilities` and `callSites` as readonly string arrays. `GlueCapability` and `GlueCallSite` are string aliases with no package-owned enumeration. `GlueManifest` has required `id`, `version`, `sdkRange`, `capabilities`, and `attachments`; each attachment has `callSite` and arbitrary payload keys. Validation errors carry `{ code: string, file: string | null, message: string }`.

`GlueCapabilityDelegate` and tool handlers accept a readonly required record and an optional readonly record and return `unknown`. `GlueDispatcherPort` receives `{ moduleId, callSite, payload }` and returns `unknown`. `GlueContentLifecycleFilter` receives `{ entry: Readonly<Record<string, unknown>>, ctx: { moduleId, workspaceId } }` and returns a readonly entry or a promise of it. `GlueFieldDecl` is `{ path: string, type: 'string' | 'integer' | 'number' | 'boolean' }`.

`GlueToolModuleContribution` is `{ moduleId: string, build: (required: Record<string, never>) => readonly GlueToolRegistration[] }`; each registration is `{ toolId, handler }`. Quarantine entries contain `{ moduleId, reason: 'THROW' | 'DUPLICATE_TOOL_ID', detail }`.

`GlueHostPort` is consumer-implemented. Its methods currently have one required record, without a second argument:

| Method | Input | Return / consumer obligation |
|---|---|---|
| `attachContentLifecycleFilter` | `{ moduleId, filter, declaredFields }` | `void`; host owns filtering, declared-field containment, and persistence |
| `registerTools` | `{ moduleId, registrations }` | `void`; register the entire module atomically |
| `subscribeEvent` | `{ moduleId, eventName, handler }` | `void`; host owns event dispatch and subscription lifetime |
| `registerAdminNav`, `contributeRender`, `registerHttpRoute` | `{ moduleId, payload: Readonly<Record<string, unknown>> }` | `void`; host defines payload semantics |
| `runChangeSet` | `{ command: GlueChangeSetCommand }` | `Promise<unknown>`; command is an opaque `unknown` |
| `snapshotBlob` | `{ content: Uint8Array \| string }` | `Promise<{ hash: string }>` |
| `restoreBlob` | `{ hash: string }` | `Promise<Uint8Array>` |

Exported record names for the table's inputs are `ValidateGlueManifestRequired` / `ValidateGlueManifestOptional`, `BuildGlueCapabilityGateRequired` / `BuildGlueCapabilityGateOptional`, `AttachGlueContentLifecycleRequired` / `AttachGlueContentLifecycleOptional`, `SubscribeGlueEventRequired` / `SubscribeGlueEventOptional`, and `MergeGlueToolRegistrationsRequired` / `MergeGlueToolRegistrationsOptional`. Optional records are empty. Result names include `ValidateGlueManifestResult`, `GlueCallSiteDispatchStatus`, and `MergeGlueToolRegistrationsResult`; attachment and quarantine records are named `GlueManifestAttachment` and `GlueToolQuarantineReason`.

All result, manifest, port, quarantine, delegate, field, and contribution types in these tables are exported by the subpath. There are no built-in persistence adapters or default host delegates.

## Minimal wiring

```ts
import { validateGlueManifest, buildGlueCapabilityGate,
  dispatchGlueAttachment } from '@jini-ai/plugins/glue';

const vocabulary = { capabilities: ['data.read'], callSites: ['tools'] };
const manifest = { id: 'example', version: '1', sdkRange: '*',
  capabilities: ['data.read'], attachments: [{ callSite: 'tools' }] };
const validation = validateGlueManifest({ manifest, vocabulary });
if (validation.errors.length) throw new Error('Invalid manifest');
const handle = buildGlueCapabilityGate({ moduleId: manifest.id,
  vocabulary: vocabulary.capabilities, capabilities: manifest.capabilities,
  coreDelegates: { 'data.read': ({ key }) => ({ key }) } });
const result = dispatchGlueAttachment({ moduleId: manifest.id,
  callSite: 'tools', payload: {}, wiredCallSites: ['tools'],
  dispatch: () => handle['data.read']!({ key: 'example' }, {}) });
```

## Current manifest boundary

The current `package.json` exposes `./glue`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
