Spec ID: SPEC-JINI-MCP-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:7ac98126f6d7ba09e9ff783810a01897efe19cd016d0f8c9d5e8b31f88ec798e
spec_mode: reverse_spec


# MCP consumer API contract

## Entry-point registry

| Import | Surface | Runtime |
|---|---|---|
| `@jini-ai/mcp` (`.`) | Config/token I/O, agent installation plans, daemon proxy tools/resources, server and idle lifecycle | Node |
| `@jini-ai/mcp/tools/ask-choice` | Choice-tool factory, pending-ticket adapter and host ports | Universal |
| `@jini-ai/mcp/federation` | Trust/admission, protocol, HTTP client, bootstrap/reload, approvals | Node |
| `@jini-ai/mcp/federation/approvals` | Confirmation and revocation ports/factories, also re-exported by federation | Node |
| `@jini-ai/mcp/federation/stdio` | Child transport, launch resolution, default connect factory | Node |
| `@jini-ai/mcp/federation/testing` | In-memory sessions/stores and scripted protocol seams | Universal |
| `@jini-ai/mcp/bin` | serve factory/dependencies and environment-key constants; also `jini-mcp` executable | Node |

Source signatures are authoritative for this specification. `required` names an object; `optional = {}` is shown only where implemented. Single-object and zero-argument methods retain their current arity. The two exports named McpLaunchSpec differ: root is an agent-install stdio shape; federation is a stdio/HTTP union. Do not substitute one without narrowing.

## Root: config and token storage

| Public signature | Return |
|---|---|
| `inferMcpAuthModeForUrl({rawUrl:string\|undefined})` | `McpAuthMode` |
| `sanitizeMcpServer({raw:unknown})` | `McpServerConfig \| null` |
| `sanitizeMcpConfig({raw:unknown})` | `McpConfig` |
| `readMcpConfig({dataDir:string}, optional:{filesystem?:McpConfigFilesystemPort} = {})` | `Promise<McpConfig>` |
| `writeMcpConfig({dataDir:string,body:unknown}, optional:{filesystem?:McpConfigFilesystemPort} = {})` | `Promise<McpConfig>` |
| `isManagedProjectCwd({cwd:string\|null\|undefined,projectsDir:string}, optional:{resolvePath?:({filePath:string})=>string} = {})` | `boolean` |
| `buildClaudeMcpJson({servers:McpServerConfig[]}, optional:{tokens?:Record<string,string>} = {})` | `unknown \| null` |
| `buildAcpMcpServers({servers:McpServerConfig[]})` | `AcpMcpServer[]` |
| `buildOpenCodeMcpConfigContent({servers:McpServerConfig[]}, optional:OpenCodeConfigBuildOptions = {})` | `string \| null` |
| `sanitizeTokensFile({raw:unknown}, optional:McpTokenClockOptions = {})` | `McpTokensFile` |
| `readTokensFile({dataDir:string}, optional:McpTokenStoreOptions = {})` | `Promise<McpTokensFile>` |
| `getToken({dataDir:string,serverId:string}, optional:McpTokenStoreOptions = {})` | `Promise<StoredMcpToken \| null>` |
| `setToken({dataDir:string,serverId:string,token:StoredMcpToken}, optional:McpTokenStoreOptions = {})` | `Promise<void>` |
| `clearToken({dataDir:string,serverId:string}, optional:McpTokenStoreOptions = {})` | `Promise<void>` |
| `readAllTokens({dataDir:string}, optional:McpTokenStoreOptions = {})` | `Promise<Record<string,StoredMcpToken>>` |
| `isTokenExpired({token:StoredMcpToken}, optional:{clock?:Clock,now?:number,skew?:number} = {})` | `boolean` |

`McpTransport` is stdio/sse/http; `McpAuthMode` is none/oauth. `McpServerConfig` requires id/transport/enabled and permits label/authMode/command/args/env/url/headers. `McpConfig` is `{servers:McpServerConfig[]}`. `AcpMcpServer` is `{type:'stdio',name,command,args,env:{name,value}[]}`.

Filesystem port: `readText({filePath}):Promise<string>` and `writeSecretText({filePath,contents}):Promise<void>`. Defaults use Node files and an atomic owner-only secret writer. Injected implementations must preserve that write guarantee. Token clock options supply clock? `Clock` (nowMs()); store options add filesystem?. `StoredMcpToken` requires accessToken/tokenType/savedAt; optional refreshToken/expiresAt/scope/tokenEndpoint/clientId/clientSecret/authServerIssuer/redirectUri/resourceUrl. `McpTokensFile` is `{servers:Record<string,StoredMcpToken>}`.

OpenCode options: tokens?, resolvePath?, absolute allowedDirectories?, extraConfig?. Builders perform no file write or process launch. The host persists or injects their output.

## Root: launch/install planning

```ts
buildMcpInstallPayload(inputs: BuildMcpInstallPayloadInputs, options: BuildMcpInstallPayloadOptions = {}): McpInstallPayload;
isAgentSlug(args: { value: string }): required is {value:AgentSlug};
planAgentInstall({ slug, spec, ctx }: { slug: AgentSlug; spec: McpLaunchSpec; ctx: PlanContext }, { env = process.env }: { env?: NodeJS.ProcessEnv } = {}): InstallPlan;
applyJsonInstall({ existingText, plan }: { existingText: string | null; plan: JsonInstallPlan }): string;
removeJsonInstall({ existingText, plan }: { existingText: string | null; plan: JsonInstallPlan }): string|null;
```

Install payload inputs require cliPath/cliExists/execPath/nodeExists/port/platform/dataDir/dataDirEnvVar/electronAsNode/isSidecarMode/sidecarEnv. Options carry webBaseUrl? and subcommand? (default mcp). Output is command/args/env/daemonUrl/webBaseUrl/platform/cliExists/nodeExists/buildHint.

Root McpLaunchSpec is `{command:string,args:string[],env:Record<string,string>}`. PlanContext requires home/platform/serverName. `AGENT_SLUGS` and `AgentSlug` cover claude/codex/cursor/copilot/openclaw/antigravity/pi/vibe/hermes/cline/kimi/trae/opencode. Plans are `CliInstallPlan` (slug/bin/addArgv/removeArgv/getArgv), `JsonInstallPlan` (slug/configPath/keyPath/serverKey/entry), or `ManualInstallPlan` (slug/format/configPath/snippet/reason), discriminated by kind. Execution, backup, permission enforcement and external CLI compatibility belong to the host.

## Root: server, daemon client and idle lifecycle

```ts
createMcpToolServer(requiredArgs: McpToolServerRequiredArgs, options: McpToolServerOptions = {}): McpToolServerHandle;
getDaemonJson<T=unknown>({ baseUrl, route }: { baseUrl: string; route: string }, options?: DaemonRequestOptions): Promise<T>;
postDaemonJson<T=unknown>({ baseUrl, route, body }: { baseUrl: string; route: string; body: unknown }, options?: DaemonRequestOptions): Promise<T>;
daemonCallOptions({ ctx }: { ctx: McpToolContext }): {fetchImpl:typeof fetch;headers?:Record<string,string>;signal?:AbortSignal};
toolsToList({ tools }: { tools: readonly McpToolDef[] }): Tool[];
buildToolIndex({ tools }: { tools: readonly McpToolDef[] }): Map<string,McpToolDef>;
handleToolCall({ name, tools, ctx }: { name: string; tools: ReadonlyMap<string, McpToolDef>; ctx: McpToolContext }, { rawArgs }: { rawArgs?: Record<string, unknown> | undefined } = {}): Promise<CallToolResult>;
okResult({ payload }: { payload: unknown }): CallToolResult;
errorResult({ message }: { message: string }): CallToolResult;
requireString({ value, name }: { value: unknown; name: string }): string;
resourcesToList({ resources }: { resources: readonly McpResourceDef[] }): Resource[];
buildResourceIndex({ resources }: { resources: readonly McpResourceDef[] }): Map<string,McpResourceDef>;
handleResourceRead({ uri, resources, ctx }: { uri: string; resources: ReadonlyMap<string, McpResourceDef>; ctx: McpToolContext }): Promise<ReadResourceResult>;
createMcpIdleExitController({ idleMs, onIdle, }: McpIdleExitControllerOptions, { timers = defaultTimers }: { timers?: McpIdleTimerPort } = {}): {
    noteActivity():void; trackRequest<T>(required:{fn:()=>T|Promise<T>}):Promise<T>; dispose():void;
  };
isTextualMime({ mime }: { mime: string | undefined }): boolean;
extractRelativeRefs({ text, fromPath, fromMime }: { text: string; fromPath: string; fromMime: string }): string[];
```

SDK result/list types in this block come from the MCP SDK. McpToolDef has name/description/inputSchema/annotations? and `handler({args,ctx}):unknown|Promise<unknown>`. McpToolContext has baseUrl/fetchImpl/authHeaders?/signal?. McpResourceDef has uri/name/description?/mimeType? and `read({ctx})` returning McpResourceReadResult `{text,mimeType?}` synchronously or asynchronously.

Server required args: name/version/tools/resolveBaseUrl `()=>string|Promise<string>`. Options: resources?, instructions?, idleMs?, fetchImpl?, authHeaders?, stdin?, stdout?, createServer? `({info,options})=>McpServerLike`, createTransport? `({}, {stdin?,stdout?})=>McpTransportLike`. Default adapters use the SDK stdio server. Handle exposes `run():Promise<void>` until disconnection/idle closure. McpServerLike exposes object-argument setRequestHandler/connect; McpTransportLike exposes onmessage({message})?/onclose()? and close(). Timer port exposes schedule({callback,delayMs}) and cancel({handle}).

DaemonRequestOptions supplies fetchImpl?, headers?, timeoutMs?, maxResponseBytes?, signal?. T is an unchecked assertion, not runtime response validation. Exported errors are `DaemonHttpError({message,status})` with status and `DaemonResponseTooLargeError({limitBytes})` with limitBytes; details in [errors.spec.md](errors.spec.md).

## Root: shipped tool/resource definitions

All named definitions below are McpToolDef objects invoked as `handler({args,ctx})`. Host them through handleToolCall for schema checking. Direct handler invocation bypasses that check.

| Export / wire name | Input / daemon dependency | Return payload |
|---|---|---|
| `startRunTool` / start_run | contextRef required; agentId/idempotencyKey optional; POST /api/runs | Parsed daemon response |
| `getRunTool` / get_run | runId; GET /api/runs/:id | Parsed response |
| `cancelRunTool` / cancel_run | runId, reason?; POST /api/runs/:id/cancel | Parsed response |
| `listAgentsTool` / list_agents | No required args; GET /api/agents | Parsed response |
| `getActiveContextTool` / get_active_context | No required args; GET /api/active | Active response, or `{active:false,hint}`; route 404 becomes explicit unsupported-host error |
| `searchToolsTool` / search_tools | query, limit? (1–25); GET /api/tools/search | Response hits |
| `describeToolTool` / describe_tool | id; GET /api/tools/:id | Parsed response |
| `searchComponentsTool` / search_components | query, limit? (1–25); GET /api/components/search | Response hits |
| `describeComponentTool` / describe_component | id; GET /api/components/:id | Parsed response |

`RUN_TOOLS`, `TOOL_CATALOG_TOOLS`, `COMPONENT_CATALOG_TOOLS` group these definitions in declaration order. `activeContextResource` (jini://active) reads /api/active as JSON text; `KERNEL_RESOURCES` contains it.

Both `createExecuteDelegatedToolTool({runId}, optional:CreateExecuteDelegatedToolToolOptions = {})` and `createExecuteReadonlyDelegatedToolTool(requiredArgs: CreateExecuteDelegatedToolToolRequiredArgs, options: CreateExecuteDelegatedToolToolOptions = {})` return McpToolDef. Required type is `CreateExecuteDelegatedToolToolRequiredArgs`; options supply generateToolUseId? and delegatedToolTimeoutMs?. Both accept toolId and optional object input, POST /api/delegated-tool-calls with fixed runId/generated toolUseId, and return response.result, unwrapping completed MCP content output. Readonly variant additionally sends requireReadOnly:true. `DEFAULT_DELEGATED_TOOL_TIMEOUT_MS` is 360000.

## Ask-choice subpath

```ts
createAskChoiceAnswerTicketStore({ now, newTicketId, ttlMs }: { now: (args: Record<string, never>) => number; newTicketId: (args: Record<string, never>) => string; ttlMs: number; }): AskChoicePendingStore;
createAskChoiceTool({ toolId, description, permission, policy, presentation, pendingQuestions, surfaceExchanges, messages }: { toolId: string; description: string; permission: string; policy: AskChoicePolicy; presentation: AskChoicePresentation; pendingQuestions: AskChoicePendingStore; surfaceExchanges: AskChoiceExchangeStore; messages: AskChoiceMessages; }): {
    descriptor: {id:string;name:string;description:string;sideEffects:'none';authorization:{permission:string};inputSchema:unknown};
    handler(required:{ctx:AskChoiceCall}):Promise<Record<string,unknown>>;
  };
```

`ASK_CHOICE_INPUT_SCHEMA` requires title and at least singleSelect or multiSelect, each with label and non-empty options `{value,label}[]`; optional description/submitLabel and multiSelect.hint. `ASK_CHOICE_ANSWER_TICKET_PARAM` is `__askChoiceAnswerTicket`.

Exported types: `AskChoiceSelect`, `AskChoiceQuestion`, `AskChoiceMessages`, `AskChoiceMessage`, `AskChoiceEmission`, `AskChoiceEmitter`, `AskChoiceExchange`, `AskChoiceExchangeStore`, `AskChoicePendingStore`, `AskChoiceCall`, `AskChoicePolicy`, `AskChoiceForm`, `AskChoicePresentation`. Call carries principalId/input/signal/emitSurface?. Policy must authorize({ctx,toolId}) and supply inputError({message})/shapeError({message,toolId,inputSchema}). Pending store supplies mint({principalId,question}) and redeem({ticket,principalId,params}). Exchange store supplies open({toolId,principalId,emit}); exchanges supply id/send({emission})/receive({})/close({}). Presentation supplies render(required form, optional cancelParams?) and buildResult({modelText,ui}). Messages requires pending/forgedAnswer/submitted/typed/noAnswer/cancelled/expired/abandoned copy.

Success is submitted:true with choice/selections/freeText and note. Nonanswers carry submitted:false with reason/note. Fallback returns the host's presentation-built record. No UI component, stylesheet or exchange lifetime policy is implemented.

## Federation subpath: protocol and HTTP

| Public signature | Return |
|---|---|
| `isHttpLaunchSpec({spec:McpLaunchSpec})` | Type guard narrowing the containing object to HTTP launch |
| `asRecord({value:unknown})` | `Record<string,unknown> \| null` |
| `buildInitializeParams({clientInfo:McpClientInfo})` | `Record<string,unknown>` |
| `parseInitializeResult({result:unknown})` | `McpServerIdentity` |
| `parseCallToolResult({result:unknown})` | `RemoteToolResult` |
| `parseToolsListPage({result:unknown})` | `{tools:RemoteToolDescriptor[],nextCursor:string\|undefined}` |
| `drainToolsList({requestPage:({params:Record<string,unknown>})=>Promise<unknown>})` | `Promise<RemoteToolDescriptor[]>` |
| `connectMcpHttpSession(required:Omit<McpHttpSessionDependencies,'onAuthenticationChallenge'>, optional:Pick<McpHttpSessionDependencies,'onAuthenticationChallenge'> = {})` | `Promise<McpSessionPort>` |
| `createFetchMcpHttpExchange({fetch:typeof fetch})` | `McpHttpExchange` |
| `isFederationEnabled({value:string\|undefined})` | `boolean` |
| `parseAllowedToolNames({value:string\|undefined})` | `string[] \| null` |
| `positiveIntOrDefault({value:string\|undefined,fallback:number})` | `number` |

Constants: CLIENT_PROTOCOL_VERSION = 2025-06-18, MAX_LIST_TOOLS_PAGES = 20, FEDERATED_CONNECTION_DEFAULTS = {connectTimeoutMs:60000,callTimeoutMs:30000,maxResultBytes:65536,maxTools:32}.

McpHttpSessionDependencies requires exchange/spec/requestTimeoutMs/clientInfo/bearerToken. Token supplier `({url},{signal?})` returns string|undefined synchronously or asynchronously; challenge hook receives url/status:401/wwwAuthenticate and returns void|Promise<void>. Session port exposes listTools():Promise<RemoteToolDescriptor[]>, callTool({name,arguments}, {signal?}):Promise<RemoteToolResult>, close({}):Promise<void>.

Other exported protocol types: `RemoteToolAnnotations`, `RemoteToolDescriptor`, `RemoteToolResult`, `McpToolCallRequiredArgs`, `McpToolCallOptions`, `JsonRpcResponse`, `McpServerIdentity`, `McpClientInfo`, `McpBearerTokenSupplier`, `McpAuthenticationChallengeHook`, `McpHttpRequestRequiredArgs`, `McpHttpRequestOptions`. Descriptors have name/description?/inputSchema?/annotations?; results have content?/structuredContent?/isError?. `McpStdioLaunchSpec` has command/args/env/cwd?; `McpHttpLaunchSpec` has url/headers. `McpLaunchSpec` is their union. McpHttpExchange.send requires url/method:POST|DELETE/headers with optional body/signal; McpHttpResponse carries status/contentType/text and optional sessionId/wwwAuthenticate. McpStdioChannel exposes send({message}):void, onMessage({listener}):void, onClose({listener}):void, close({}):void. `McpProtocolError({message}, optional:ErrorOptions = {})` and inherited `McpAuthFailedError` are exported here; see [errors.spec.md](errors.spec.md).

## Federation subpath: trust and diagnostics

| Public signature | Return |
|---|---|
| `assertValidConnectionId({connectionId})`, `assertNoNativeCollision({federatedToolIds,nativeToolIds,messages})` | `void`, throw on invalid/colliding identifiers |
| `federatedToolId({connectionId,remoteName})` | `string` |
| `parseFederatedConnectionId({toolId})` | `string \| null` |
| `isOperatorDeclaredReadOnly({remoteName,annotations,readList})` | `boolean` |
| `federatedCallConfirmationFor({annotations})`, `federatedCallConfirmationForAction({remoteName,annotations,args})` | `FederatedCallConfirmation` |
| `writeShapedInputNames({args:unknown})`, `writeShapedSchemaInputNames({schema:unknown})` | `string[]` |
| `refusalForAdmittedToolUnderCurrentGrants({tool,grants})` | `ToolRefusalReason \| null` |
| `admitRemoteTools({tools,config})` | `FederatedAdmissionReport` |
| `describeRemoteToolSurface({tools,config})` | `readonly RemoteToolSurfaceEntry[]` |
| `describeFederatedTool({label,remoteName}, optional:{remoteDescription?:string} = {})` | `string` |
| `wrapUntrustedResult({connectionLabel,remoteName,result,maxResultBytes})` | `string` |
| `extractFederatedImageBlocks({content,maxResultBytes})` | `{images:readonly FederatedImageBlock[],remainder:unknown}` |
| `safeRemoteName({remoteName:unknown,messages})`, `explainFederatedToolRefusal({reason,messages})` | `string` |
| `summarizeFederatedRefusals({snapshot,messages})` | `readonly FederationRefusalItem[]` |
| `findFederatedToolRefusal({toolId,snapshot,messages})` | `FederatedToolRefusalLookup \| null` |
| `buildFederatedRefusalPrefix({snapshot,messages})` | `string` |
| `federatedToolApprovalFingerprint({ identity, fingerprintDomain }: { identity: FederatedToolIdentity; fingerprintDomain: string })` | `string` (hex SHA-256) |

Identifier/text values are strings; tool/schema/result values have the exported types above; numeric limits are numbers. tools is a readonly descriptor list; config is FederatedMcpConnectionConfig. nativeToolIds is ReadonlySet<string>. grants contains allowedToolNames/writeAllowedToolNames. snapshot is readonly FederationAdmissionSnapshotEntry[].

Constants: FEDERATED_TOOL_ID_PREFIX = mcp__, FEDERATED_TOOL_PERMISSION = admin.integrations.manage, FEDERATED_ENTITY_TYPE = federated-mcp-connection, WRITE_SHAPED_INPUT_WORDS (classification vocabulary).

Exported trust/report types: ToolRefusalReason, AdmittedFederatedTool, FederatedCallConfirmation (none/confirm/confirm-destructive), FederatedAdmissionReport, RemoteToolSurfaceEntry, FederatedImageBlock, FederationAdmissionSnapshotEntry, FederationRefusalKind, FederationRefusalItem, FederatedToolRefusalLookup, FederatedToolIdentity, FederatedApprovalScope, ExternalMcpToolApprovalRecord, ExternalMcpToolApprovalRepoPort, ConversationToolApprovalKey, ConversationToolApprovalStore. Report includes admitted/refused/allowlistedButAbsent/writeAllowedButNotAllowlisted. Approval identity binds connection/name/hints/origin/description/schema. Repo methods return find(key, {scope}):Promise<ExternalMcpToolApprovalRecord|null>, upsert(record, {scope}):Promise<void>, listByScope({}, {scope}):Promise<ExternalMcpToolApprovalRecord[]>, delete(key, {scope}):Promise<boolean>. key is {serverId,toolName}, with optional second-object {scope}; conversation store has(key):Promise<boolean> and grant({key,grantedAt}):Promise<void>.

## Federation subpath: registration, bootstrap and reload

```ts
buildFederatedMcpRegistrations(params: { tools: Parameters<typeof admitRemoteTools>[0]["tools"]; session: McpSessionPort; config: FederatedMcpConnectionConfig; deps: FederationDeps; nativeToolIds: ReadonlySet<string>; }): FederatedRegistrationResult;
federateSession(params: { session: McpSessionPort; config: FederatedMcpConnectionConfig; deps: FederationDeps; nativeToolIds: ReadonlySet<string>; }): Promise<FederatedRegistrationResult>;
registerFederatedMcpPreset({ preset }: { preset: FederatedMcpPreset }):void;
listFederatedMcpPresets():readonly FederatedMcpPreset[];
resetFederatedMcpPresetsForTests(_required: Record<string, never>):void;
attachFederatedMcpTools(requiredArgs: AttachFederatedMcpToolsRequiredArgs, optionalArgs: AttachFederatedMcpToolsOptions = {}):Promise<AttachFederatedToolsResult>;
selectUnadmittedConnections({ allConnections, admittedConnectionIds }: { allConnections: readonly ResolvedFederatedConnection[]; admittedConnectionIds: ReadonlySet<string> }):readonly ResolvedFederatedConnection[];
createFederationReloadCoordinator({ coordDeps, initiallyAdmitted }: { coordDeps: FederationReloadCoordinatorDeps; initiallyAdmitted: Iterable<string> }):FederationReloadCoordinator;
```

Config requires connectionId/label/allowedToolNames/writeAllowedToolNames/connectTimeoutMs/callTimeoutMs/maxResultBytes/maxTools; optional readOnlyRemoteNames and origin. ResolvedFederatedConnection is `{config,launch}`. Origin is preset or roster with admissionRevision. No policy defaults are applied by constructing that interface.

FederationDeps requires permissionGate/messages/errorCode; optional scope is opaque; optional assertConnectionUsable/onAuthFailed/confirmCall. Permission gate receives context/permission/entityType/entityId and optional second-object scope. Usability gate receives connectionId/call (remoteName/declaredAnnotations/origin). Auth hook receives connectionId/error and must reject. Confirmation receives context/request and returns confirmed:true or confirmed:false/result. FederatedCallConfirmationRequest carries toolId/remoteName/connectionId/connectionLabel/frozen arguments/destructive/declaredAnnotations/origin/description/inputSchema/writeShapedInputs. Returned registrations are core ToolRegistration objects, with current core handler shape `(ctx, options = {})`, not the root McpToolDef handler shape.

Attach requires registry/deps/connect `({connection})=>Promise<McpSessionPort>`; options carry connections?/extraConnections?/logger?/env?. Result includes registeredToolIds/sessions/reports/connectFailures. Host owns session shutdown. core Logger uses info/warn/error({message}, {meta?,error?}). Preset resolver `({env})=>ResolvedFederatedConnection|null` is synchronous; same presetId replaces in position.

Reload deps require registry/deps/connect/resolveConnections `()=>Promise<readonly ResolvedFederatedConnection[]>`, optionally attach/logger. Coordinator exposes reload({}):Promise<FederationReloadResult> and admittedConnectionIds():ReadonlySet<string>. Result has newlyAdmittedConnectionIds/reports/connectFailures. No shutdown or session collection is exposed by reload.

Other exported bootstrap types: FederatedMcpPresetResolver/Preset, AttachFederatedMcpToolsParams/RequiredArgs/Options, FederatedToolPermissionGate, FederatedRegistrationResult, FederationReloadCoordinatorDeps/Coordinator/Result, FederatedConnectionOrigin/CallTarget, FederatedCallConfirmationOutcome, RemoteToolDescriptorAnnotations.

## Approvals subpath (also federation)

```ts
buildFederatedCallConfirmSpec({ request, messages, errorCode }: { request: FederatedCallConfirmationRequest; messages: FederationMessages; errorCode: string }, { offers = { offerChat: false, offerAlways: false } }: { offers?: FederatedCardOffers } = {}):FederatedConfirmationSpec;
createFederatedCallConfirmer<Context extends FederatedConfirmationContext, Exchanges>(required: FederatedCallConfirmerRequired<Context, Exchanges>, options: FederatedCallConfirmerOptions = {}):
    (required:FederatedConfirmCallInput<Context>)=>Promise<FederatedCallConfirmationOutcome>;
rosterRefusalFor({ record, call }: { record: ConnectionRosterSnapshot | null; call: FederatedCallTarget }):ExternalMcpRevocationReason|null;
createFederatedConnectionRevocationGate(required: { roster: ConnectionRosterReader; errorFactory: FederatedRevocationErrorFactoryPort; }, optional: { scope?: string; webhooks?: FederatedRevocationWebhookPort; onDiagnostic?: (required: FederatedRevocationDiagnostic) => void; } = {}):
    (required:{connectionId:string;call:FederatedCallTarget})=>Promise<void>;
```

Confirmer requires messages/fingerprintDomain/errorCode/surfaceExchanges/humanConfirm; optional scope/approvals/webhooks/onPersistenceError. Context minimally has principal.id/run.id. HumanConfirm.ask({context,surfaceExchanges,spec}) returns confirmed with optional choice or declined/result. Approval deps require mayAlwaysAllow/clock (core Clock.nowMs()); optional always/chat/conversationIdForRun stores/lookup. Host owns human identity, one-use answer binding, display, durable storage and webhook delivery.

Revocation roster port has findByServerId({serverId}, {scope}):Promise<ConnectionRosterSnapshot|null>. Snapshot has label/enabled/admissionRevision/disconnected/grants. Error factory creates a host Error; webhook has connectionRefused(refusal, {scope}). Refusal carries serverId/label/remoteName/reason.

Exported types: `FederatedConfirmationContext`, `FederatedConfirmationSpec`, `FederatedCardOffers`, `FederatedHumanConfirmOutcome`, `FederatedHumanConfirmPort`, `FederatedApprovalDeps`, `FederatedApprovalWebhookPort`, `FederatedApprovalDiagnostic`, `FederatedCallConfirmerRequired`, `FederatedCallConfirmerOptions`, `FederatedConfirmCallInput`, `ExternalMcpRevocationReason`, `ConnectionRosterSnapshot`, `ConnectionRosterReader`, `FederatedConnectionRefusal`, `FederatedRevocationErrorFactoryPort`, `FederatedRevocationWebhookPort`, `FederatedRevocationDiagnostic`. Spec is presentation data (title/description/details/warning/danger/confirmLabel/alternatives?), not a UI component.

## Stdio subpath

| Public signature | Return / dependencies |
|---|---|
| `connectMcpStdioSession({channel,requestTimeoutMs,clientInfo,messages})` | `Promise<McpSessionPort>`; host channel/identity/deadline |
| `spawnMcpStdioChannel(required:ResolvedStdioLaunch & {messages:FederationMessages})` | `McpStdioChannel`; Node child process with pipe stdio |
| `resolveStdioChildCwd({resolved}, optional:{neutralDir?:string} = {})` | `string\|undefined`; default os.tmpdir |
| `keepStderrTail({tail:string,chunk:string})` | `string` |
| `createStderrTail({secretValues:readonly string[]})` | `{append({chunk:string}):void;text():string}` |
| `describeChildExit({code:number\|null,signal:NodeJS.Signals\|null,stderrTail:string,secretValues:readonly string[]})` | `string` |
| `buildMcpChildEnv({command:string,specEnv:Record<string,string>}, optional:{launchEnv?,platform?,parentEnv?,execPath?} = {})` | `Record<string,string>` |
| `createBundledNodeLaunchResolver(required:BundledNodeLaunchResolverConfig, optional:BundledNodeLaunchResolverOptions = {})` | `McpStdioLaunchResolver` |
| `stdioLaunchResolverFromEnv({env,toolchainDirEnvVar,npmRootEnvVar,messages}, optional:StdioLaunchResolverFromEnvOptions = {})` | `McpStdioLaunchResolver` |
| `createDefaultConnect({resolver,clientInfo,messages,bearerToken}, optional:{spawnChannel?,fetch?,connectHttp?,onAuthenticationChallenge?,logger?} = {})` | `({connection:ResolvedFederatedConnection})=>Promise<McpSessionPort>` |

Resolver port resolve({spec:McpStdioLaunchSpec}) returns ResolvedStdioLaunch (command/args/env/launchEnv/cwd?/requestedCommand?/warning?). Bundled config requires messages/toolchainDir/npmRoot; options expose execPath/platform/parentEnv/isExecutable({candidatePath}). Environment selection requires host-owned variable names; options expose exists({candidatePath}) and allowIdentityFallback (false). `IDENTITY_STDIO_LAUNCH_RESOLVER` preserves spec with empty launchEnv. `NODE_TOOLCHAIN_LAYOUT` is bin/npm-cache/npm-prefix. `McpLaunchUnavailableError({message})` is exported.

Default connect supplies Node spawn, global fetch, HTTP connector and console warning sink unless replaced. spawnChannel receives `{resolved}`. A configured resolver warning is logged once per connector instance. Transport protocol ports are the federation types described above.

## Testing subpath

```ts
new InMemoryMcpSession(required:{tools:readonly RemoteToolDescriptor[]}, optional:{onCall?,onListTools?} = {});
new ScriptedMcpStdioChannel(required:{respond:({message:CapturedRpcMessage})=>unknown;messages:FederationMessages});
new ScriptedMcpHttpExchange(required:{respond:({request:CapturedHttpRequest})=>ScriptedHttpReply|undefined});
new InMemoryExternalMcpToolApprovalRepo(required:{});
createInMemoryConversationToolApprovalStore(_required: Record<string, never>):ConversationToolApprovalStore;
```

Session onCall receives {name,args}, returns RemoteToolResult|Promise thereof; onListTools is zero-argument async. Session exposes calls/closed/listTools()/callTool(required,optional)/close({}). Scripted channel exposes sent/closedReason/send/onMessage/onClose/close({}), deliver({message}), fail({reason}), idFor({method}). HTTP double exposes sent and send(required request,optional options). Undefined scripted response means silence; stdio replies arrive on a microtask. CapturedRpcMessage is parsed JSON-RPC; CapturedHttpRequest includes url/method/headers/message; ScriptedHttpReply has optional status/contentType/sessionId/wwwAuthenticate/body. Stores implement the approval interfaces above. They are process-memory doubles, not durable adapters.

## Bin subpath

`serve(required:{}, optional:ServeDeps = {}):Promise<void>` assembles the shipped tools/resources and runs the server. ServeDeps permits env/writeErr/exit/resolveDaemonUrl/createMcpToolServer/generateToolUseId/fetchImpl/stdin/stdout. Missing run id or server failure writes stderr and exits 1. Default import is guarded against execution; execution as the entry script runs serve({}).

Constants: RUN_ID_ENV_VAR = JINI_RUN_ID, DAEMON_URL_ENV_VAR = JINI_DAEMON_URL, DAEMON_TOKEN_ENV_VAR = JINI_DAEMON_TOKEN, DELEGATED_TOOL_TIMEOUT_ENV_VAR = JINI_DELEGATED_TOOL_TIMEOUT_MS. The executable advertises name jini-mcp/version 0.0.0. It resolves URL from environment only; no argv parser is installed.

## Minimal wiring by entry

```ts
import { createMcpToolServer, RUN_TOOLS } from '@jini-ai/mcp';
await createMcpToolServer({ name:'example',version:'1.0.0',tools:RUN_TOOLS,
  resolveBaseUrl:()=> 'http://127.0.0.1:4111' }, {authHeaders:{Authorization:'Bearer host-token'}}).run();
```

```ts
import { createAskChoiceTool, createAskChoiceAnswerTicketStore } from '@jini-ai/mcp/tools/ask-choice';
const pendingQuestions = createAskChoiceAnswerTicketStore({now:()=>Date.now(),newTicketId:()=>crypto.randomUUID(),ttlMs:60000});
// policy, presentation, surfaceExchanges and all messages are host adapters.
const tool = createAskChoiceTool({toolId:'ask',description:'Choose an option',permission:'host.ask',
  policy,presentation,pendingQuestions,surfaceExchanges,messages});
```

```ts
import { attachFederatedMcpTools, FEDERATED_CONNECTION_DEFAULTS } from '@jini-ai/mcp/federation';
import { createDefaultConnect, IDENTITY_STDIO_LAUNCH_RESOLVER } from '@jini-ai/mcp/federation/stdio';
const connect = createDefaultConnect({resolver:IDENTITY_STDIO_LAUNCH_RESOLVER,
  clientInfo:{name:'example',version:'1'},messages,bearerToken:()=>undefined});
// registry and deps (especially permissionGate) are host implementations.
const attached = await attachFederatedMcpTools({registry,deps,connect}, {connections:[{
  config:{...FEDERATED_CONNECTION_DEFAULTS,connectionId:'service',label:'Service',
    allowedToolNames:['search'],writeAllowedToolNames:[]},
  launch:{command:'server',args:[],env:{}}
}]});
await Promise.all(attached.sessions.map(session => session.close({})));
```

```ts
import { createFederatedCallConfirmer, createFederatedConnectionRevocationGate } from '@jini-ai/mcp/federation/approvals';
const confirmCall = createFederatedCallConfirmer({messages,fingerprintDomain,errorCode,surfaceExchanges,humanConfirm}, {scope});
const assertConnectionUsable = createFederatedConnectionRevocationGate({roster,errorFactory}, {scope});
// Inject both functions into the host's FederationDeps.
```

```ts
import { InMemoryMcpSession } from '@jini-ai/mcp/federation/testing';
const session = new InMemoryMcpSession({tools:[{name:'search',inputSchema:{type:'object'}}]});
const result = await session.callTool({name:'search',arguments:{query:'example'}});
await session.close({});
```

```ts
import { serve } from '@jini-ai/mcp/bin';
await serve({}, {env:{JINI_RUN_ID:'run-1',JINI_DAEMON_URL:'http://127.0.0.1:4111'}});
```

## Evidence and limits

Source: each package.json export target's src module and its re-export chain. Static test evidence: core/config and tokens, server/tool-protocol and daemon-client, ask-choice/ports, federation/trust, confirmation-policy, adapter and approval/revocation tests. Tests/builds were not run. Distribution resolution is not certified. Internal secure-write and SDK-transport helpers are not root exports and are not additional supported imports.


Architecture contract update: federation messages are required host objects; the exported
`defaultFederationMessages` provides neutral English. Required fingerprintDomain/errorCode have
no defaults. The no-channel suffix is derived from errorCode. Optional scope replaces tenancy
inputs in the second argument of approval repository, roster, permission and webhook ports;
approval duration remains the required event's scope field. See API.md for exact signatures.
MCP has no CLI or OAuth imports. Shared text functions are at core/text and the private atomic
writer has been deleted in favor of platform/fs writeFileAtomicAsync (0600, verified, fsynced).
Token clock options now take core Clock instead of a local now callback. Bootstrap and reload
loggers take core Logger. Scripted channels and all stdio/HTTP factories take messages.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `FederationRefusalMessages` | interface; [messages.ts](../../src/federation/messages.ts) |
| `McpDaemonUrlOptions` | interface; [serve.ts](../../src/bin/serve.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./tools/ask-choice`, `./federation`, `./federation/approvals`, `./federation/stdio`, `./federation/testing`, `./bin`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
