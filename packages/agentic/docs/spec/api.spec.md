Spec ID: SPEC-JINI-AGENTIC-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:d90dedd427451b6297d85f996eec6e2c65016361d4336e5cfd8c806404453782
spec_mode: reverse_spec


# Agentic API contract

## Public entry points

| Import from `@jini-ai/agentic` | Surface |
| --- | --- |
| Root, `/core` | Same headless capability, page-driver, handle/guard and protocol API |
| `/dom` | DOM driver and native model-context adapter |
| `/a2ui` | Wire schemas, catalog, dynamic resolution, tree traversal and interpreter |
| `/skills/install` | Skill validation, archive/download, filesystem/layout ports, installer and live registration; includes Node filesystem factory |
| `/skills/install/node` | `createNodeSkillFilesystem` only |

Current functions generally accept `(required, optional = {})`. An empty optional object below means no configurable fields. Installer/registry methods with one object retain that convention; native Zod schema methods retain Zod's own signatures. Shared port types are documented where currently declared, before any core-type migration.

## Capability vocabulary and page execution

`CapabilityDef` is `{ id, description, inputSchema, risk: 'read' | 'write', surface: 'session' | 'server', requiresConfirmation? }`. Its schema is an object schema with `properties` (`type`, optional `description`/`enum`), optional `required` and `additionalProperties`.

| Function | Signature | Return |
| --- | --- | --- |
| Lookup | `findCapability({ capabilities, id }, {} = {})` | `CapabilityDef \| undefined` |
| Input check | `findCapabilityInputError({ capability, input }, {} = {})` | `string \| null` |
| Session filter | `availableCapabilities({ capabilities, hasSession }, {} = {})` | `readonly CapabilityDef[]` |
| Execute | `executePageCapability({ driver, capabilityId, input }, {} = {})` | `Promise<unknown>`; concrete outputs below |
| State projection | `projectElementState({ raw }, {} = {})` | `AgentElementState` |

`PAGE_CAPABILITIES` contains these session tools, with extra input fields disallowed:

| Id | Input | Output |
| --- | --- | --- |
| `page.find_elements` | `{ role?, query?, withState? }` | `{ elements, pages, untrustedFields, stateUnavailable?, stateTruncated? }` |
| `page.highlight` | `{ handle, durationMs? }` | `{ highlighted, durationMs }` |
| `page.scroll_to` | `{ handle }` | `{ scrolledTo }` |
| `page.click` | `{ handle }` | `{ clicked, ...writeObservation }` |
| `page.fill` | `{ handle, text }` | `{ filled, ...writeObservation }` |
| `page.select_option` | `{ handle, option, selected? }` | `{ selected: handle, option, optionSelected, ...writeObservation }` |
| `page.navigate` | `{ page }` | `{ navigatedTo, before, after }` |

The first three tools are read-risk; the remaining tools are write-risk. `PageWriteObservation` contains optional before/after element state and `targetChanged`; navigation instead returns page/count snapshots. Observations reflect what the injected driver can see, not a proof of successful business effects.

`PageDriver` is the consumer-supplied port:

| Method | Return |
| --- | --- |
| `findElements({}, filter?: { role?, query? })` | `Promise<readonly AgentElementDescriptor[]>` |
| `listPages({}, {}?)` | `Promise<readonly PageSummary[]>` |
| `describeField({ handle }, {}?)` | `Promise<FieldDescriptor \| null>` |
| `highlight({ handle, durationMs }, {}?)`, `scrollTo({ handle }, {}?)`, `click({ handle }, {}?)`, `fill({ handle, text }, {}?)`, `navigate({ page }, {}?)` | `Promise<void>` |
| `selectOption({ handle, option }, { selected? }?)` | `Promise<void>` |
| Optional `describeState({ handle }, {}?)` | `Promise<AgentElementRawState \| null>` |
| Optional `settle({}, {}?)` | `Promise<void>`; the host must bound settling |

Descriptors contain `handle`, `role`, `label`, `labelTruncated`, `page`; summaries contain `id`, `label`. `AgentElementRole` is `button | checkbox | field | form | list | status | region | link`. Raw state includes `text`, optional `textIsValue`, `value`, `checked`, `disabled`, `visible`, `field`, `options`. Projected state records normalized/truncated text and guarded values with withholding flags. `FieldDescriptor` contains optional `type`, `autocomplete`, `name`, `id`, `accessibleLabels`, `readOnly`, `disabled`.

```ts
import { executePageCapability } from '@jini-ai/agentic/core';
// pageDriver implements the port over the consumer's own UI or remote surface.
const result = await executePageCapability({
  driver: pageDriver,
  capabilityId: 'page.find_elements',
  input: { role: 'field', withState: true },
});
```

## Handles and field guards

| Function | Current signature / return |
| --- | --- |
| `isValidElementHandle` | `({ handle }, {} = {}) → boolean` |
| `resolveHandleSelector` | `({ handle }, {} = {}) → string` |
| `agentHandle` | `({ handle }, { role?, label?, page? } = {}) → AgentHandleProps` |
| `agentSubHandle` | `({ base, action }, {} = {}) → string` |
| `agentHandleProps` | `({}, { base?, action?, role?, label?, page? } = {}) → AgentHandleProps \| {}` |
| `buildAgentListHandles` | `({ prefix, ids }, {} = {}) → string[]` |
| `findFieldReadRefusal` / `findFieldFillRefusal` | `({ field }, {} = {}) → FieldReadRefusal \| null` / `FieldRefusal \| null` |
| `describeFieldReadRefusal` / `describeFieldRefusal` | `({ refusal }, {} = {}) → string` |
| `normalizeAgentLabel` | `({ raw }, { maxLength = 200 } = {}) → { text, truncated }` |

Markup constants are `AGENT_ELEMENT_ATTRIBUTE`, `AGENT_ROLE_ATTRIBUTE`, `AGENT_LABEL_ATTRIBUTE`, `AGENT_PAGE_ATTRIBUTE`, `AGENT_PRIVATE_ATTRIBUTE` for `data-agent-element`, `data-agent-role`, `data-agent-label`, `data-agent-page`, `data-agent-private`. `AGENT_ELEMENT_ROLES` enumerates roles. `MAX_AGENT_LABEL_LENGTH` is 200. `DEFAULT_HIGHLIGHT_MS`, `MAX_HIGHLIGHT_MS`, `MAX_STATEFUL_ELEMENTS` are 3000, 15000 and 50 respectively.

`WebMcpConfirmationRequiredError` and `InvalidWebMcpToolNameError` are also root/core exports; their constructors and caller handling are in `errors.spec.md`.

## WebMCP and AG-UI projections

| Function | Signature / return |
| --- | --- |
| `isValidWebMcpToolName` | `({ name }, {} = {}) → boolean` |
| `toWebMcpTool` | `({ capability, execute }, { requestUserInteraction?, title?, annotations?, signal?, exposedTo? } = {}) → WebMcpToolRegistration` |
| `toWebMcpTools` | `({ capabilities, execute }, sameOptions = {}) → readonly WebMcpToolRegistration[]` |
| `toAgUiTool` / `toAgUiTools` | `({ capability }, {} = {}) → AgUiTool` / `({ capabilities }, {} = {}) → readonly AgUiTool[]` |
| `createAgUiToolResult` | `({ messageId, toolCallId, outcome }, {} = {}) → AgUiToolResultMessage` |

WebMCP `execute` is the supplied `({ id, args }) => Promise<unknown>`. Confirmation is the supplied `requestUserInteraction({ capability, args }): Promise<boolean>`. Registration exposes native-shaped `execute(args)` plus name, description, schema, optional title, annotations and registration options. Annotations have optional `readOnlyHint`, `untrustedContentHint`. `signal`/`exposedTo` are passed through for a host to honor.

AG-UI tools use `{ name, description, parameters }`. Result messages use `{ id, role: 'tool', content, toolCallId }`; outcome is `{ ok: true, output } | { ok: false, error }`. `AG_UI_TOOL_CALL_EVENTS` supplies `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`. These projections open no transport.

```ts
import { PAGE_CAPABILITIES, executePageCapability, toWebMcpTools }
  from '@jini-ai/agentic/core';
const tools = toWebMcpTools({
  capabilities: PAGE_CAPABILITIES,
  execute: ({ id, args }) => executePageCapability({ driver: pageDriver, capabilityId: id, input: args }),
}, { requestUserInteraction: interaction => askUser(interaction) });
// The consumer registers tools with its model-context implementation.
```

## Custom GenUI encoder

`createGenUiEncoder({ clock }, {} = {}) → GenUiEncoder` requires `clock.nowMs(): number`. Its `encode({ event, runId }, { seq?, now? } = {}) → GenUiEvent | null` consumes `RunProtocolEvent` from the agent runtime; the optional `now` override is a function returning milliseconds. Events contain a timestamp/run id and optional sequence, with kinds `agent.message`, `tool_call`, `state_update`, `ui.surface_requested`, `ui.surface_responded`, `run.lifecycle`. Exported types are `GenUiEncodeContext`, `GenUiEncoder`, `GenUiEventBase`, `GenUiEventKind`, `GenUiEvent` and the six corresponding event interfaces.

This custom protocol is separate from the genuine AG-UI tool projection. The current encoder has no input branch producing `state_update` despite that exported event type.

## JSON-RPC and MCP UI vocabulary

| Function | Current signature / return |
| --- | --- |
| `isJsonRpcMessage` | `(required: { value: unknown }, {} = {}) → required is { value: JsonRpcMessage }` |
| `isJsonRpcRequest` | `(required: { message: JsonRpcMessage }, {} = {}) → required is { message: JsonRpcRequest }` |
| `createJsonRpcRequest` | `({ id, method }, { params? } = {}) → JsonRpcRequest` |
| `createJsonRpcNotification` | `({ method }, { params? } = {}) → JsonRpcNotification` |
| `createJsonRpcResult` | `({ id, result }, {} = {}) → JsonRpcResponse` |
| `createJsonRpcError` | `({ id, code, message }, { data? } = {}) → JsonRpcResponse` |
| `createPageActionRequest` | `({ id, capabilityId, input }, {} = {}) → JsonRpcRequest` |

Ids are strings or numbers. Request builder params are records. `JsonRpcMessage`, `JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcError` describe single messages, not batches. Constants: `MCP_UI_VIEW_METHODS`, `MCP_UI_HOST_NOTIFICATIONS`, `MCP_UI_VIEW_NOTIFICATIONS`, `MCP_UI_HOST_REQUESTS`, `MCP_UI_SANDBOX_NOTE`, `JINI_PAGE_ACTION_METHOD` (`x-jini/page-action`), `JSON_RPC_ERROR_CODES`. Host/view method lists and the sandbox note are vocabulary, not a handshake, sandbox or transport implementation.

## DOM subpath

`createDomPageDriver({ root, pages }, { currentPage? } = {}) → PageDriver` declares a DOM `ParentNode` root with `querySelector`, and a page map `{ [id]: { label, navigate({}): void } }`. The driver reads root/pages from the required object and uses the optional currentPage override.

`currentAgentPage({ root }, {} = {}) → string | undefined` finds a page marker. `getAgentModelContext({ host }, {} = {}) → AgentModelContextLike | undefined` requires `host.candidates({}): readonly unknown[]`; it adapts the first usable candidate. The returned port supports `registerTool({ tool }, { signal?, exposedTo? } = {}): Promise<void>` and optional `unregisterTool({ name }, {} = {}): void`. Native host methods are bridged internally. Consumers own DOM availability, candidate order, registration cleanup and transport security.

```ts
import { getAgentModelContext } from '@jini-ai/agentic/dom';
const context = getAgentModelContext({ host: { candidates: () => nativeContextCandidates } });
if (context) for (const tool of tools) await context.registerTool({ tool });
// The host supplies page navigation callbacks and a DOM root.
```

## A2UI schemas and messages

The subpath exports runtime Zod schemas and inferred wire types. Consumers call schema `.parse(value)` / `.safeParse(value)` using native Zod signatures.

| Schema group | Public schemas / shape |
| --- | --- |
| Common values | `ComponentIdSchema`, `CallIdSchema`, `DataBindingSchema` (`{ path }`), `FunctionCallSchema` (`{ call, args? }`), `DynamicValueSchema`, `DynamicStringSchema`, `DynamicNumberSchema`, `DynamicBooleanSchema`, `DynamicStringListSchema`, `IndexSystemFunctionSchema` (`@Index`), `AccessibilityAttributesSchema`, `ComponentCommonSchema`, `ChildSchema`, `ChildListSchema`, `CheckRuleSchema`, `CheckableSchema`, `AgentActionEventSchema`, `ActionSchema` |
| Agent → renderer | `WireComponentSchema` (`{ id, component, ...props }`), `ComponentsListSchema`, `CreateSurfaceMessageSchema`, `UpdateComponentsMessageSchema`, `UpdateDataModelMessageSchema`, `DeleteSurfaceMessageSchema`, `CallFunctionMessageSchema`, `ActionResponseMessageSchema` |
| Renderer → agent | `ActionMessagePayloadSchema`, `FunctionResponsePayloadSchema`, `ValidationFailedErrorSchema`, `GenericErrorSchema`, `ErrorPayloadSchema`, `ActionMessageSchema`, `FunctionResponseMessageSchema`, `ErrorMessageSchema` |

Messages require `version: 'v1.0'` and exactly one recognized payload key. `AGENT_TO_RENDERER_MESSAGE_KEYS` enumerates six keys. Surface creation carries `surfaceId`, `catalogId`, optional `surfaceProperties`, `sendDataModel`, `components`, `dataModel`. Component updates carry surface id/components; data updates carry surface id, optional path and required value. Function calls carry function call id, optional response request and call expression. Action responses carry action id and either value or `{ error: { code, message } }`.

`parseAgentToRendererMessage({ raw }, {} = {})` returns `{ ok: true, message } | ParseFailure`; `parseRendererToAgentMessage({ raw }, {} = {})` returns `{ ok: true, message } | { ok: false, reason }`.

Builder functions, all with empty optional objects, return validated message envelopes: `buildActionMessage({ payload })`, `buildFunctionResponseMessage({ payload })`, `buildValidationFailedMessage({ surfaceId, path, message })`, `buildGenericErrorMessage({ code, message, target })`. Generic targets are either `{ surfaceId }` or `{ functionCallId }`.

`isAgentEventAction(required: { action: Action }, {} = {})` and `isLocalFunctionAction(required: { action: Action }, {} = {})` narrow the required wrapper to `AgentEventAction` or `LocalFunctionAction` respectively. They inspect which action variant is present.

## A2UI catalog, pointers and dynamic values

`Catalog` contains `catalogId`, component map and function map. Component specs have `kind` and Zod `propsSchema`; function specs have `returnType`, `callableFrom: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent'`, optional synchronous `impl(args)`. Supply an allowlisted catalog for production; `createLabCatalog({}, {} = {})` is a demonstration subset, not a complete renderer.

| Function | Current signature / return |
| --- | --- |
| Catalog membership | `isComponentAllowed({ catalog, componentType }, {} = {}) → boolean`; `isFunctionRegistered({ catalog, functionName }, {} = {}) → boolean` |
| Function side | `callableFromOf({ catalog, functionName }, {} = {}) → CallableFrom` (unknown defaults to renderer-only) |
| Pointer parse/join | `parsePointerTokens({ pointer }, {} = {}) → string[]`; `joinPointer({ base, tokens }, {} = {}) → string` |
| Pointer read/write | `getAtPointer({ doc, pointer }, {} = {}) → { found, value }`; `setAtPointer({ doc, pointer, value }, {} = {}) → unknown` |
| Dynamic resolution | `resolveDynamicValue({ value, ctx }, { itemScope? } = {}) → ResolveResult` |
| Tree flatten | `flattenRenderTree({ components, rootId, getChildIds }, {} = {}) → RenderNode[]` |

Resolution context is `{ dataModel, catalog, side: 'renderer' | 'agent' }`; item scope is `{ basePath, index }`. Results are `{ ok: true, value }` or `{ ok: false, reason, detail }`. Render nodes contain `id`, `depth`, `status: 'ok' | 'missing' | 'cycle' | 'truncated'`. `getChildIds({ component })` is supplied by the consumer. `MAX_RENDER_NODES` is 50,000 plus a possible truncation sentinel.

## A2UI interpreter

`createA2uiInterpreter({ catalog, clock, ids }, {} = {}) → A2uiInterpreter` requires `clock.nowMs(): number` and `ids.next({}): string`.

| Method | Result |
| --- | --- |
| `applyAgentMessage({ raw }, {} = {})` | `{ rendererMessages, unattributedViolation? }` |
| `getSurface({ surfaceId }, {} = {})` | `SurfaceSnapshot \| undefined` |
| `listSurfaceIds({}, {} = {})` | `string[]` |
| `getRoot({ surfaceId }, {} = {})` | `ComponentInstance \| undefined`; literal component id `root` |
| `buildAction({ surfaceId, componentId }, { now? } = {})` | `BuildActionResult`: agent message, local result, or failure reason |
| `resolve({ surfaceId, value }, { itemBasePath?, itemIndex? } = {})` | `ResolveResult` |
| `subscribe({ listener }, {} = {})` | Unsubscribe accepting `{}`; listener also accepts `{}` |

Snapshots contain `surfaceId`, `catalogId`, component map and data model; component instances contain `id`, `component`, validated `props`. `buildParseFailureResult({ parsed, raw }, {} = {})` produces the same apply-result shape. `runLocalFunctionAction({ dataModel, catalog, action }, {} = {})` produces a local `BuildActionResult`.

```ts
import { createA2uiInterpreter, createLabCatalog } from '@jini-ai/agentic/a2ui';
const interpreter = createA2uiInterpreter({
  catalog: createLabCatalog({}),
  clock: { nowMs: () => Date.now() },
  ids: { next: () => crypto.randomUUID() },
});
const result = interpreter.applyAgentMessage({ raw: {
  version: 'v1.0', createSurface: { surfaceId: 'example', catalogId: createLabCatalog({}).catalogId },
} });
// A consumer renderer reads snapshots and sends result.rendererMessages over its transport.
```

## Skill validation, archive and download

| Function | Current signature / return |
| --- | --- |
| Base64 | `decodeSkillBase64({ value }, { maxBytes = 8388608 } = {}) → Buffer` |
| Path | `validateSkillPath({ filePath }, {} = {}) → void` |
| Markdown | `validateSkillMarkdown({ markdown, yamlReader }, {} = {}) → { name, description }` |
| File set | `validateSkillFiles({ files, yamlReader }, {} = {}) → { name, description, files: Map<string, Buffer> }` |
| Archive | `readSkillArchive({ base64, archiveReader }, {} = {}) → Promise<SkillUploadFile[]>` |
| GitHub | `fetchGitHubSkill({ githubUrl, fetch }, {} = {}) → Promise<{ files, source: { githubUrl, commit } }>` |
| Fetch bridge | `createSkillFetchAdapter({ fetch }, {} = {}) → SkillFetchPort` |
| State read | `readSkillState({ directory, stateFileName, filesystem }, {} = {}) → Promise<{ enabled, source }>` |
| Layout | `createSkillLayout({ root, stagingRoot, workspaceDirectory, stateFileName }, {} = {}) → SkillLayoutPort` |
| Node filesystem | `createNodeSkillFilesystem({}, {} = {}) → SkillFilesystemPort` |

`SkillUploadFile` is `{ path, contentBase64 }`. `YamlReaderPort.read({ yaml }): unknown`; `SkillFetchPort({ url }, optional?: RequestInit): Promise<Response>`; `ArchiveReaderPort.open({ bytes })` returns an async entry iterable plus `close({})`. Archive entries have `path`, `kind`, declared `size`, and `read({}): AsyncIterable<Uint8Array>`.

The YAML adapter must use failsafe parsing and reject duplicate keys. The archive adapter must expose strict names, accurate sizes and lazy entries without extracting files; early iterator return must release entry streams. Filesystem/loader adapters must preserve lstat semantics for symlinks. Staging and final roots must share a filesystem that supports the required rename operation.

`MAX_SKILL_BYTES`, `MAX_SKILL_FILES`, `MAX_SKILL_FILE_BYTES` are 8 MiB, 256 and 1 MiB. Skill markdown has a separate 128 KiB limit. Both installer subpaths depend on Node buffers; the main installer barrel also exports the Node filesystem adapter.

`SkillInputError` and the `SkillYamlPort` alias for `YamlReaderPort` are also exported; the error constructor is documented in `errors.spec.md`.

## Skill ports and installer

`SkillFilesystemPort` (also `FilesystemPort`) supports `mkdir({ path })`, `mkdtemp({ prefix })`, `writeFile({ path, bytes, mode, exclusive: true })`, `readFile({ path, maxBytes })`, `lstat({ path })`, `rename({ from, to })`, `remove({ path }, { recursive?, force? }?)`, all asynchronous. Stat returns `{ kind, size }`.

`SkillLayoutPort.resolve({ workspaceId })` returns `{ workspaceRoot, stagingRoot, stateFileName }`. `ToolSourceLoaderPort.load({ workspaceId }, { includeDisabled? }?)` returns descriptors `{ id, skillName, description, directory }[]`.

`createSkillInstaller({ layout, filesystem, archiveReader, yamlReader, fetch, ids, toolId, toolSourceLoader }, { onChanged? } = {}) → SkillInstaller`. `ids.next({})` supplies staging/state ids; `toolId({ name })` supplies stable tool identity. `onChanged({ workspaceId, toolId })` may be asynchronous.

| Installer method | Result |
| --- | --- |
| `installSkill({ workspaceId, ...source })`, source exactly one of `{ githubUrl }`, `{ files }`, `{ archiveBase64 }` | `Promise<ManagedSkill>` |
| `listManagedSkills({ workspaceId })` | `Promise<ManagedSkill[]>` |
| `setSkillEnabled({ workspaceId, toolId, enabled })` | `Promise<void>` |
| `uninstallSkill({ workspaceId, toolId })` | `Promise<void>` |

Managed skills contain `toolId`, `name`, `description`, `enabled`, `source: 'uploaded' | { githubUrl, commit }`.

```ts
import { createSkillInstaller, createSkillLayout, createSkillFetchAdapter }
  from '@jini-ai/agentic/skills/install';
import { createNodeSkillFilesystem } from '@jini-ai/agentic/skills/install/node';
const installer = createSkillInstaller({
  layout: createSkillLayout({ root: skillRoot, stagingRoot, workspaceDirectory: 'workspaces', stateFileName: 'skill-state.json' }),
  filesystem: createNodeSkillFilesystem({}), archiveReader, yamlReader,
  fetch: createSkillFetchAdapter({ fetch }),
  ids: { next: () => crypto.randomUUID() },
  toolId: ({ name }) => `skill.${name}`, toolSourceLoader,
});
const skills = await installer.listManagedSkills({ workspaceId: 'example' });
```

## Live registration and refresh

`SkillRegistration<Descriptor, Context>` contains a descriptor with `id`, `policy.authorize({ context })`, and `handler({ context })`. `SkillRegistryPort` has `list({})`, `has({ id })`, `register({ tool })`. Consumers supply the real registry and inactive-tool error factory.

- `createLiveSkillRegistration({ registry, inactiveError }, {} = {}) → ({ tools }) => boolean`; `inactiveError({ id }): Error`. The boolean reflects descriptor-set changes, not every handler change.
- `createSkillRefresher({ load, replace }, {} = {}) → { refreshInstalledSkills({}): Promise<boolean> }`; `load({})` returns tools asynchronously and `replace({ tools })` returns a change flag.
- `createSkillRefreshMiddleware({ registry }, { onChanged? } = {}) → ({ next }) => Promise<void>`; optional registry `refreshInstalledSkills({})` is awaited. `next({}, { error? }?)` receives refresh errors. `onChanged({})` is synchronous.

The package supplies no HTTP routing, tool-source parser, YAML parser, archive decoder, external registry or authorization policy implementation.

`defaultAgenticMessages` (root / `./core`) supplies the neutral navigation description. Hosts
replace copy through the existing `CapabilityDef.description` before projecting model tools;
IDs, schemas and capability policy remain intact. Both UI interpreters accept core `Clock`.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `A2uiIdsPort`, `ApplyMessageResult` | interface; [interpreter.ts](../../src/core/a2ui/interpreter.ts) |
| `AccessibilityAttributes`, `AgentActionEvent`, `ArgValue`, `CallId`, `CheckRule`, `Checkable`, `Child`, `ChildList`, `ChildListTemplate`, `ComponentCommon`, `ComponentId`, `DataBinding`, `DynamicBoolean`, `DynamicNumber`, `DynamicString`, `DynamicStringList`, `DynamicValue`, `IndexSystemFunction` | type; [common-types.ts](../../src/core/a2ui/common-types.ts) |
| `ActionMessage`, `ActionMessagePayload`, `ErrorMessage`, `ErrorPayload`, `FunctionResponseMessage`, `FunctionResponsePayload`, `GenericError`, `RendererToAgentMessage`, `ValidationFailedError` | type; [renderer-to-agent.ts](../../src/core/a2ui/renderer-to-agent.ts) |
| `ActionResponseMessage`, `AgentToRendererMessage`, `CallFunctionMessage`, `ComponentsList`, `CreateSurfaceMessage`, `DeleteSurfaceMessage`, `UpdateComponentsMessage`, `UpdateDataModelMessage`, `WireComponent` | type; [agent-to-renderer.ts](../../src/core/a2ui/agent-to-renderer.ts) |
| `AgentHandleOptions`, `AgentHandlePropsOptions` | type; [handle.ts](../../src/core/handle.ts) |
| `AgentModelContextRegisterToolOptions`, `AgentModelContextToolRegistration`, `ModelContextHostPort` | type; [model-context.ts](../../src/core/dom/model-context.ts) |
| `ArchiveEntry`, `SkillInstallDeps`, `SkillToolSource` | interface; [ports.ts](../../src/skills/install/ports.ts) |
| `CapabilityInputSchema`, `CapabilityRisk`, `CapabilitySurface` | type; [capability.ts](../../src/core/capability.ts) |
| `ComponentKind` | type; [catalog.ts](../../src/core/a2ui/catalog.ts) |
| `ComponentLike` | interface; [tree.ts](../../src/core/a2ui/tree.ts) |
| `ComponentSpec`, `FunctionSpec` | interface; [catalog.ts](../../src/core/a2ui/catalog.ts) |
| `DomPageDriverOptions`, `DomPageDriverPage`, `DomPageDriverRequired` | type; [dom-page-driver.ts](../../src/core/dom/dom-page-driver.ts) |
| `FindElementsFilter` | type; [page-driver.ts](../../src/core/page-driver.ts) |
| `FindElementsResult`, `PageActivitySnapshot`, `PageElementResult` | type; [page-executor.ts](../../src/core/page-executor.ts) |
| `FunctionCall` | interface; [common-types.ts](../../src/core/a2ui/common-types.ts) |
| `GenUiAgentMessageEvent`, `GenUiRunLifecycleEvent`, `GenUiStateUpdateEvent`, `GenUiSurfaceRequestedEvent`, `GenUiSurfaceRespondedEvent`, `GenUiToolCallEvent` | type; [index.ts](../../src/core/gen-ui/index.ts) |
| `GitHubSkillSource` | interface; [github.ts](../../src/skills/install/github.ts) |
| `ItemScope`, `ResolveContext`, `ResolveFailure`, `ResolveOk` | interface; [resolve.ts](../../src/core/a2ui/resolve.ts) |
| `NormalizedLabel` | type; [guards.ts](../../src/core/guards.ts) |
| `ParseSuccess` | interface; [agent-to-renderer.ts](../../src/core/a2ui/agent-to-renderer.ts) |
| `PointerGetResult` | interface; [json-pointer.ts](../../src/core/a2ui/json-pointer.ts) |
| `RenderNodeStatus` | type; [tree.ts](../../src/core/a2ui/tree.ts) |
| `RendererParseFailure`, `RendererParseSuccess` | interface; [renderer-to-agent.ts](../../src/core/a2ui/renderer-to-agent.ts) |
| `RequestUserInteraction`, `ToWebMcpToolOptions`, `WebMcpRegisterToolOptions`, `WebMcpToolAnnotations`, `WebMcpUserInteraction` | type; [webmcp.ts](../../src/core/webmcp.ts) |
| `ResolveFailureReason`, `ResolveSide` | type; [resolve.ts](../../src/core/a2ui/resolve.ts) |
| `SkillInstallInput` | type; [install-service.ts](../../src/skills/install/install-service.ts) |
| `SkillState` | interface; [state.ts](../../src/skills/install/state.ts) |
| `SkillsRefreshRegistry` | interface; [live-registration.ts](../../src/skills/install/live-registration.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./core`, `./dom`, `./a2ui`, `./skills/install`, `./skills/install/node`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
