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

## Executable contributions (owner dispatch 2026-10-09)

The existing loader builds one capability-scoped SDK per load. Declare every name in
`contributes.routes/tools/widgets` and request `http.route.register`, `tools.register`, or
`render.contribute` respectively. Registrations occur during `setup`; late registration fails.
`routes.add`, `tools.add`, `widgets.add`, and `addContribution({kind,value}, {})` all accept two
argument objects. Claims are checked before code import and registrations before publication.

```js
export default { definition: { setup(sdk) {
  sdk.routes.add({method:'POST',path:'/echo',access:'member',
    handler:async ({body,auth,sdk})=>({body:{body,memberId:auth.principalId}})}, {});
  sdk.tools.add({name:'echo',description:'Echo a site payload',inputSchema:{type:'object'},
    handler:async ({input,auth,sdk,signal})=>input}, {});
  sdk.widgets.add({name:'sample-banner',render:()=>'<strong>Hello</strong>'}, {});
} } };
```

Tovu mounts relative routes at `/api/p/<pluginId>/...`; only literal segments and `:parameter`
segments are supported. The host authenticates public/member/admin access, then parses JSON,
form, text, or binary input at 128 KiB. JSON responses are `{status?,body?}`; exceptions are redacted.
No raw request/response, session tokens, app dependency bag, or route-mount handle reaches a plugin.
Tools use `p_<pluginId with hyphens folded to underscores>__<name>`, the existing assistant registry
and executor, host operator authorization, and conservative confirmation. Input schemas are JSON
object schemas, detached from the author object and limited to 64 KiB. Plugin handlers must validate
their domain-specific input. Disable/reload removes or replaces complete generations, and pending
confirmation handlers recheck activation and generation before execution.

Widgets are public SSR fragments. Place one using the existing theme partial marker:
`<div data-embed-config='{"type":"partial","id":"sample-banner"}'></div>`.
Unknown/disabled names retain authored fallback; invalid/failed/expired renders produce an empty
fragment. Work is bounded to 32 names per page, 2 seconds per renderer and 64 KiB per fragment.
The CMS HTML validator rejects scripts, SVG, iframe, event/style attributes and executable URLs.
TODO: client JS requires an ADR-025 owner amendment. Tier-3 still has full in-process machine
access; TODO: hardened worker at the contribution boundary. Tier-2 contributions are refused until
its existing worker RPC gains these contracts.

No action hooks are cataloged, so `addAction` now fails explicitly rather than silently doing
nothing. Its present callable capability-denial surface remains for CIC U-003 compatibility.
Legacy positional `addContribution` calls also fail explicitly; explicit route/tool/widget records
use each surface's own grant. SDK content reads/extends retain their existing beforeSave-only
invocation contract; passing the SDK to a route/tool does not invent new content permissions.

## Server provider contributions

`contributes.providers` declares `{ contract, id, contractVersion: 1 }` records. Both names follow
core's provider id grammar (`^[a-z][a-z0-9_]{0,63}$`). A provider plugin is tier-3 and requests
`providers.register`. The callable `sdk.providers.register({ contract, id, contractVersion: 1,
factory }, {})` is always present and throws `CapabilityDeniedError` without that grant. Host
`PluginSdkBinding.buildSdk` must preserve this supplied handle when assembling its SDK.

`loadPlugin` accepts `providerContributions: { registry, isSelected }`. `registry` is the existing
`PluginContributionRegistry`; `isSelected({ pluginId }, {})` must verify installed, enabled and
configured state, including the current configuration revision for a pending load. Selection is
checked before import and after setup. Registration uses a private, bounded capture sealed on
success or failure; factories publish only after setup and registry admission succeed. Failures
add `PROVIDER_NOT_SELECTED` and `PROVIDER_ADMISSION_FAILED` to `PluginLoadFailureReason`.
No new installer, executable importer, activation or quarantine owner is introduced.

```ts
import { createPluginContributionRegistry, createPluginProviderHost } from '@jini-ai/plugins/host';

const contributions = createPluginContributionRegistry({});
const providers = createPluginProviderHost({
  contributions,
  contracts: [{ contract: 'observability', validate: ({ provider }) => validateObservabilityPort(provider) }],
}, { disposeTimeoutMs: 2000, onError: ({ pluginId, phase, error }) => report({ pluginId, phase, error }) });
// After the existing installer + loader admits the selected plugin:
const lease = await providers.initialize({ contract: 'observability', id: 'selected_provider',
  input: { config, credentials, effects } }, { factoryOptions: {} });
if (lease?.isCurrent({})) startApplicationWork({ observability: lease.port });
// Disable/quarantine removes the snapshot; replacement publishes a new sealed snapshot.
contributions.detach({ pluginId });
await providers.dispose({}); // also required on failed boot
```

Factories have `(requiredObject, optionalObject = {})` and return `{ port, dispose }` synchronously
or asynchronously. `dispose({}, {})` releases only owned clients/timers. Domain validation is
injected as `PluginProviderContract.validate({ provider })`; optional `seed` uses core definitions.
Provider identity is an exclusive `contract:id` claim, refused by the existing conflict detector at
manifest resolution and again at snapshot publication. Returned ports pass core's `createProviderRegistry` validation.
`initialize` returns a lease, `undefined` for an unavailable/retired generation, or rejects for
factory/contract failures. Retirement (detach, replacement, shutdown) settles a pending
`initialize` with `undefined` without waiting for the factory; `initializeTimeoutMs` (default
10000) rejects one that never settles. A result arriving after either is disposed on arrival.
Hosts await boot initialization and retain their existing noop when no provider is selected. Calls for distinct accounts may initialize independent resources.

Retirement blocks new work through `lease.isCurrent({})`, disposes acquired resources and
immediately disposes any late initialization result. `lease.dispose({})` and `providers.dispose({})`
are idempotent. All teardown starts independently, and each wait is bounded (default 2000 ms).
Thrown/rejected cleanup and diagnostics cannot suppress another provider's cleanup. Timeout bounds
waiting, not arbitrary in-process effects. Do not retain a port beyond its lease's generation.

New exports from `./host`: `PLUGIN_PROVIDER_CAPABILITY`, `createPluginProviderHost`,
`PluginProviderError`; types `PluginProviderDeclaration`, `PluginProviderResource`,
`PluginProviderFactory`, `PluginProviderContribution`, `PluginProvidersSdk`, `PluginProviderContract`,
`PluginProviderFailure`, `PluginProviderLease`, `PluginProviderHost`. Existing capture adds
`providers.register`, SDK dependencies add optional `providers`, and contribution snapshots add
optional `providers`. `PLUGIN_CONTRIBUTION_CAPABILITIES` now includes `providers.register`.
