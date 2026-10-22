# MCP API

Public callable boundaries take a required object and an optional settings object. Native
SDK, fetch, stream, and process signatures remain inside adapters. Existing export names
remain stable except the separately authorized retirement of the duplicated OAuth engine.
Effectful lifecycle operations receive an empty required object. Native SDK callbacks and
zero-argument getters retain their ABI.

| Entry | Runtime | Surface |
| --- | --- | --- |
| `@jini-ai/mcp` | Node | Tool/resource hosting, daemon proxy, configuration, token storage, agent installation |
| `@jini-ai/mcp/bin` | Node | Spawnable binary; library invocation `serve({}, deps)` |
| `@jini-ai/mcp/tools/ask-choice` | Universal | Human question orchestration and optional answer-ticket store |
| `@jini-ai/mcp/federation` | Node | Protocol/HTTP, trust, admission, bootstrap/reload, fingerprints, approvals |
| `@jini-ai/mcp/federation/approvals` | Node | Human confirmation, remembered approvals, current-roster revocation |
| `@jini-ai/mcp/federation/stdio` | Node | Child-process transport and launch resolvers |
| `@jini-ai/mcp/federation/testing` | Universal | Scripted transports, sessions, in-memory approval stores |

Federation's main entry needs Node for approval hashing. It does not import process
adapters. Testing modules import their protocol contracts as types and use no Node APIs.
The package root does not re-export federation's `McpLaunchSpec`, avoiding a collision
with its agent-install launch type. Import the federation type from the federation entry.

```ts
getDaemonJson({ baseUrl, route }, { fetchImpl, headers, signal });
postDaemonJson({ baseUrl, route, body }, { fetchImpl, timeoutMs });
new DaemonHttpError({ message, status });
new DaemonResponseTooLargeError({ limitBytes });
new McpProtocolError({ message }, { cause });

readMcpConfig({ dataDir }, { filesystem });
writeMcpConfig({ dataDir, body }, { filesystem });
setToken({ dataDir, serverId, token }, { filesystem, now });
buildClaudeMcpJson({ servers }, { tokens });
planAgentInstall({ slug, spec, ctx }, { env });

createMcpToolServer({ name, version, tools, resolveBaseUrl }, {
  resources, fetchImpl, createServer, createTransport,
});
tool.handler({ args, ctx });
resource.read({ ctx });
createExecuteDelegatedToolTool({ runId }, { generateToolUseId, delegatedToolTimeoutMs });
```

`requireString({ value, name })` returns the validated string. `isAgentSlug(args)` narrows
`args.value`. Root exports include the filesystem, token-clock/store, install-payload,
server-required-arguments, delegated-tool-required-arguments, and idle-timer port types.

```ts
const ask = createAskChoiceTool({
  toolId, description, permission, policy, presentation,
  pendingQuestions, surfaceExchanges, messages,
});
await ask.handler({ ctx });
// policy.authorize({ ctx, toolId }) runs before render or redemption.
presentation.render({ toolName, principalId, question, baseParams }, { cancelParams });
```

The host owns rendered resource identity, copy, permissions, actor/execution binding,
single-use exchanges, and callback routing. Answer tickets remain hidden from model
context; live exchange IDs and fallback tickets keep their existing wire keys. Ticket
creation requires clock, ID generation, and lifetime; there is no host-layout default.

```ts
const connect = createDefaultConnect({ resolver, clientInfo, messages, bearerToken }, {
  fetch, spawnChannel, onAuthenticationChallenge, logger,
});
await attachFederatedMcpTools({ registry, deps, connect }, { extraConnections, logger });
createFederationReloadCoordinator({ coordDeps, initiallyAdmitted });

await session.callTool({ name, arguments: input }, { signal });
await exchange.send({ url, method, headers }, { body, signal });
await bearerToken({ url }, { signal });
resolver.resolve({ spec });
await session.close({});
await server.run({});
await coordinator.reload({});
idle.noteActivity({});
idle.dispose({});
channel.send({ message });
channel.onMessage({ listener: ({ message }) => consume(message) });
channel.onClose({ listener: ({ reason }) => report(reason) });
```

The HTTP authentication challenge hook receives `(challenge, { signal })`. It shares the POST's
remaining timeout and caller cancellation. A hook failure is reported through the optional injected
`logger.warn({ message })`; hook and logger failures never replace `McpAuthFailedError`. A hook that
ignores cancellation may continue its own work, but it cannot keep the caller waiting after abort.

`FederationDeps` requires `permissionGate`, `errorCode`, and `messages`. `scope` is an optional opaque host partition. Its optional
gates receive named objects: `assertConnectionUsable({ connectionId, call })`,
`onAuthFailed({ connectionId, error })`, and `confirmCall({ context, request })`.
The registration handler follows the core contract `(context, optionalPorts)` and carries
the optional surface emitter into the confirmation context. Ordering stays current-row
liveness/revocation, permission, confirmation, then remote execution. Arguments are frozen
before the human gate. Missing confirmation channels refuse protected actions.

Logger methods take `{ message }`. Presets resolve `{ env }`. Spawn callbacks take
`{ resolved }`; filesystem probes take `{ candidatePath }`; tool-list page callbacks take
`{ params }`. Scripted stdio callbacks receive `{ message }`, scripted HTTP callbacks
receive `{ request }`, and in-memory tool handlers receive `{ name, args }`. Scripted
helpers use `deliver({ message })`, `fail({ reason })`, `idFor({ method })`, and
`lastRequestFor({ method })`; stderr tails use `append({ chunk })`.

`createInMemoryConversationToolApprovalStore({})`, `new InMemoryExternalMcpToolApprovalRepo({})`,
and `resetFederatedMcpPresetsForTests({})` also use empty objects. `listTools()`,
`listFederatedMcpPresets()`, `admittedConnectionIds()`, and stderr `text()` are getters.
An internal question error is constructed with `{ message }` and optional `{ cause }`.

Delegated gateway `generateToolUseId` ports receive `{}`. Idle `onIdle` and `trackRequest`'s
`fn` ports also receive `{}`; native scheduler callbacks retain the Node callback ABI.
The default correlation-id generator still uses `randomUUID()` without changing its options.

`sanitizeMcpServer` preserves defaults for omitted discriminators but rejects supplied invalid
transport/authentication modes. `stdioLaunchResolverFromEnv` selects identity when both host-named
environment variables are absent. A partial toolchain configuration or missing `npx-cli.js` throws
`McpLaunchUnavailableError` unless the second object explicitly sets `allowIdentityFallback: true`.
Permitted fallback includes a warning; it never silently chooses a broader execution path.

Approval construction takes `createFederatedCallConfirmer({ messages, fingerprintDomain,
errorCode, humanConfirm, surfaceExchanges }, { scope, approvals, webhooks, onPersistenceError })`;
the returned function accepts `{ context, request }`. The domain and error namespace are REQUIRED
host wire values with no defaults. Missing human channels use `${errorCode}_NO_CONFIRMATION_CHANNEL`.
The pure fingerprint helper takes `{ identity, fingerprintDomain }`; canonical JSON and its digest
are unchanged when the host supplies its previous domain. `buildFederatedCallConfirmSpec` requires
`{ request, messages, errorCode }`. Remembered approval dependencies require core `Clock.nowMs()`.

Revocation takes `createFederatedConnectionRevocationGate({ roster, errorFactory }, { scope,
webhooks, onDiagnostic })`. Roster and approval repository methods receive storage scope in their
second object. `listByWorkspaceId` becomes `listByScope({}, { scope })`. Approval records expose
optional `scope`; no partition is inferred. Existing JSON key bytes are preserved when scope is
supplied. Webhook required payloads keep every non-tenancy field; the second object carries opaque
scope. In particular, `approvalRemembered` still has REQUIRED payload `scope: "chat" | "always"`
for approval duration, independently of its optional storage scope.

Compose host credential checks after the per-call roster check, including separate checks for
presets. Stores remain injected ports.

OAuth orchestration belongs to the independent OAuth package and the host. MCP imports
neither an OAuth implementation nor database repositories. HTTP credentials are supplied
per exchange; a 401 exposes its challenge and is not automatically retried. App-specific
client information, federation messages, environment-variable names, and trust policy come from
the host. All execution verification is deferred by owner directive.


Federation copy comes from required `FederationMessages`/`FederationRefusalMessages` objects;
`defaultFederationMessages` is an exported neutral English choice. Refusal APIs return structured
`kind`/`reason` data alongside rendered explanations. Both boot and attempt channels use the same
reason wording. Invalid names are still replaced, default-deny boot noise suppressed, admitted
names subtracted, and prefixes capped at ten entries. Hosts can supply their current wording.
HTTP session construction, stdio connection/spawn, launch resolvers and scripted channels all take
`messages` in place of prose branding. `clientInfo` remains protocol name/version data.

Bootstrap/reload logger ports now use core `Logger`, including `error`. Default logs go through
`createConsoleLogger({ prefix: "agent-daemon" })`; info uses `console.info`. Token clock options
use `{ clock: Clock }`, with `nowMs()`; an explicit numeric expiry `now` remains supported.
Secret stores delegate to platform's `writeFileAtomicAsync` with 0600, owner-only verification and
parent creation. File sync precedes rename and directory sync follows it; a directory-sync error
is observable after replacement. No new symlink-refusal policy is selected.

The executable retains its injected resolver port using `McpDaemonUrlOptions`, a required shape
for its environment-only inputs. It assembles its spawning host's URL directly without importing
a CLI shell. Policy warnings use the shared platform loopback classifier and hide URL userinfo.

## Managed project containment

Managed-project detection resolves real/lexical paths as before, then uses the
browser-safe `pathContains` helper from `@jini-ai/core/primitives`. Comparison
follows the host's path case policy and respects directory boundaries. A legal
project directory beginning with `..` is accepted; escaping the managed root
or selecting the root itself is still refused. Platform remains required for
other Node integrations, not for this pure containment check.

Permanent deletion always needs a fresh one-call confirmation. Destructive cards offer neither
chat nor always approval; matching remembered grants cannot skip them, and forged remember choices
are discarded. Write-shaped protected calls also remain unrememberable. The host must keep its
persisted fingerprint domain stable when adopting federation; changing it invalidates saved grants.
