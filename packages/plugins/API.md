# Glue API

The universal `@jini-ai/plugins/glue` entry provides the following APIs without runtime
dependencies. Every public callable takes a required argument object and optional settings object;
empty settings use `Record<string, never>`.

| API | Required inputs | Result |
|---|---|---|
| `validateGlueManifest` | `manifest`, `vocabulary: { capabilities, callSites }` | Collected validation errors |
| `resolveCallSiteDispatch` | `callSite`, `wiredCallSites` | Wired status or `UNWIRED_CALL_SITE` |
| `dispatchGlueAttachment` | `moduleId`, `callSite`, `payload`, `wiredCallSites`, `dispatch` | Wired result or unwired status |
| `buildGlueCapabilityGate` | `moduleId`, `vocabulary`, `capabilities`, `coreDelegates` | Frozen delegate handle |
| `attachGlueContentLifecycle` | `moduleId`, `filter`, `declaredFields`, `hostPort` | Delegates attachment |
| `subscribeGlueEvent` | `moduleId`, `eventName`, `handler`, `hostPort` | Delegates subscription |
| `mergeGlueToolRegistrations` | `coreToolIds`, `glueModules`, `hostPort` | Registered module IDs and quarantines |
| `GlueCapabilityDeniedError` | `moduleId`, `capability` | Error identifying the denied invocation |

```ts
import { buildGlueCapabilityGate, dispatchGlueAttachment } from '@jini-ai/plugins/glue';

const gate = buildGlueCapabilityGate({
  moduleId: 'search', vocabulary: ['items.read', 'items.write'], capabilities: ['items.read'],
  coreDelegates: { 'items.read': ({ itemId }, { includeArchived } = {}) => loadItem({ itemId }, { includeArchived }) },
}, {});
gate['items.read']!({ itemId: 'one' }, { includeArchived: false });

dispatchGlueAttachment({
  moduleId: 'search', callSite: 'render', payload: { itemId: 'one' },
  wiredCallSites: ['render'], dispatch: ({ moduleId, callSite, payload }) => render({ moduleId, callSite, payload }),
}, {});
```

Grants and own delegate references are snapshots; inherited delegates never grant a capability.
Denied calls throw `GlueCapabilityDeniedError({ moduleId, capability })`. Unwired attachments never
call the dispatcher. Vocabulary and wired-site policy belong to the host.

`GlueHostPort` methods receive argument objects. Content filters receive `{ entry, ctx }`, event
handlers receive `{ payload }`, and contribution builders receive `{}`. Content/event failures
propagate. Tool contributions quarantine independently; duplicate IDs reject a whole module before
mounting. `registerTools({ moduleId, registrations })` must mount atomically or throw without a
partial mount. A failed mount does not reserve IDs against later modules.

This entry adds no plugin loader, lifecycle, persistence, quarantine threshold or application policy.
The package remains private, with its version unchanged. Verification is deferred by owner directive.
