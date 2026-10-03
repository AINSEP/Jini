Spec ID: SPEC-JINI-CORE-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:46e3b6c8cf6b5118a3d4893a78e18f62638b22c45acd23d8e3cebcd4737abc5f
spec_mode: reverse_spec

# API Contract: @jini-ai/core

## Purpose and entry points

A dependency-free composition kernel with tool authorization, approval tokens, naming, and error policies. The public export map contains `.`, `./composition`, `./gated-mutations`, `./model-facing-tool-errors`, `./contribution-registry`, `./naming`, `./primitives`, and `./text`. All entries are universal ESM; types erase at runtime.

Signatures below describe current source. Two-object APIs use `(required, optional = {})` only where implemented. A single-object API currently has no second parameter; callbacks and methods retain their declared forms. Shared primitive types are owned by `./primitives`; they are not re-exported from the root.

## Root: tokens, bindings, packs, daemon

| Entry | Current signature and return | Consumer dependencies |
|---|---|---|
| `token<T, Id>` | `({ id: Id }, { version?: number } = {}): Token<T, Id>` | None; version defaults to 1 |
| `manyToken<T, Id>` | `({ id: Id }, { version?: number } = {}): ManyToken<T, Id>` | None |
| `bindings` / `new Bindings` | `({}): Bindings<never>` | None |
| `Bindings.bind` | `({ token: Token<T, Id>, impl: T }): Bindings<BoundIds | Id>` | Singleton implementation |
| `Bindings.bindMany` | `({ token: ManyToken<T, Id>, impl: T }): Bindings<BoundIds | Id>` | One contribution per call |
| `Bindings.resolveOne` / `resolveMany` | `({ token }): T` / `T[]` | Public class methods marked internal; prefer scoped `PackContainer` |
| `definePack` | `({ name, deps, services }, optional: PackContributions<Services> = {}): Pack<Deps, Services, Name>` | `services(c: PackContainer): Services` |
| `createDaemon` | `(config: DaemonConfig<Packs, BoundIds> & MissingBindingGate, optional: DaemonOptions = {}): Daemon<Packs>` | Packs and bindings; optional `transports` is accepted but unused |
| `registerPackTools` | `({ registry, packs, daemon }): readonly ToolRegistration[]` | Explicit shared registry and composed services |
| `disposePacks` | `({ packs, daemon }): Promise<readonly PackDisposalFailure[]>` | Pack disposal callbacks |

`Token` has `{ id, version, cardinality: 'one' }`; `ManyToken` has cardinality `'many'`. `AnyToken`, `Pack`, `PackContainer`, `PackContributions`, `Daemon`, `DaemonConfig`, `DaemonOptions`, and `PackDisposalFailure` are exported types. The compile-time missing-binding gate requires an unsatisfiable `__missingBindings` field when declared dependency IDs are absent from the accumulated binding IDs.

`PackContainer.get({ token }): T` and `getMany({ token }): T[]` restrict resolution to declared dependency IDs. Pack contributions are `tools({ services }): readonly ToolRegistration[]`, `http({ app, services }): void`, `cli({ reg, services }): void`, and `dispose({ services }): void | Promise<void>`. The caller mounts transports and invokes registration/disposal helpers.

```ts
import { bindings, token, definePack, createDaemon, disposePacks } from '@jini-ai/core';
const Store = token<{ read(): string }>({ id: 'consumer.store' });
const pack = definePack({ name: 'reader', deps: [Store] as const,
  services: c => ({ read: () => c.get({ token: Store }).read() }) });
const daemon = createDaemon({ packs: [pack] as const,
  bindings: bindings({}).bind({ token: Store, impl: { read: () => 'value' } }) }, {});
daemon.services.reader.read();
await disposePacks({ packs: [pack] as const, daemon });
```

## Root: tools and authentication

| Entry | Current signature and return |
|---|---|
| `createToolRegistry` | `({}): ToolRegistry` |
| `ToolRegistry.register` | `(registration: ToolRegistration): void` |
| `ToolRegistry.has` / `list` | `({ toolId: string }): boolean` / `({}): readonly ToolDescriptor[]` |
| `isReadOnlyTool` | `({ descriptor: ToolDescriptor | undefined }): boolean` |
| `new ToolInputError` | `({ message: string }, optional: ErrorOptions = {})` |
| `redactSecrets` | `({ input: string }, options: SecretRedactionOptions = {}): string` |
| `redactSecretsWithCounts` | `({ input: string }, options: SecretRedactionOptions = {}): { redacted: string; counts: Record<string, number> }` |
| `isTruthyEnvFlag` | `({ value: unknown }): boolean` |
| `isApiAuthDisabled`, `isApiTokenMiddlewareEnabled` | `({ config: ApiTokenAuthEnvConfig, env }): boolean` |
| `apiTokenFromEnv` | `({ config: ApiTokenAuthEnvConfig, env }): string` |

`ToolRegistryToken` is the singleton token `jini.toolRegistry`, version 1. `Principal` is `{ id: string, roles?: readonly string[] }`; `RunRef` is `{ id: string }`. `ToolDescriptor` carries `id`, optional `description`, `inputSchema`, `requiresConfirmation`, `timeoutMs`, `maxOutputBytes`, and `readOnly`. Metadata does not execute or validate anything in this package.

`ToolRegistration` is `{ descriptor, handler, policy }`. `ToolHandler(required: ToolExecutionContext, optional?: ToolExecutionOptions): Promise<unknown>` receives `{ executionId, principal, run, input, signal }` and optional `emitSurface`. `SurfaceEmitter(emission: SurfaceEmission): Promise<void>` accepts `{ channel, payload }`. `ToolPolicy.authorize(ctx: ToolAuthorizationContext): AuthorizationDecision | Promise<AuthorizationDecision>` receives `{ principal, run, tool, input }`; decision is `'allow' | 'deny'`. All named types in this paragraph are exported.

`ApiTokenAuthEnvConfig` supplies `tokenEnvVar` and `disableEnvVar`; `ApiTokenAuthArgs` adds an explicit environment map. These helpers do not authenticate requests or compare credentials.

```ts
import { createToolRegistry, ToolInputError } from '@jini-ai/core';
const registry = createToolRegistry({});
registry.register({ descriptor: { id: 'echo', readOnly: true },
  policy: { authorize: () => 'allow' }, handler: async ({ input }) => {
    if (typeof input !== 'string') throw new ToolInputError({ message: 'Expected text' });
    return input;
  } });
registry.list({});
```

## Root: browser origin helpers

The caller supplies `OriginValidationEnvConfig` (`allowedOriginsEnvVar`, `webPortEnvVar`, `bindHostEnvVar`) and an explicit environment map through `OriginValidationArgs`. Optional `OriginValidationLoggerPort.warn({ message }): void` reports ignored malformed configuration.

| Entry | Current signature and return |
|---|---|
| `configuredAllowedOrigins` | `({ config, env }, { logger? } = {}): string[]` |
| `assertValidAllowedOrigins` | `({ config, env }): void` |
| `configuredAllowedHosts` | `({ origins: string[] }): string[]` |
| `allowedBrowserPorts` | `({ config, env, port: number | string | null | undefined }): number[]` |
| `parseHostHeader` | `({ value: unknown }): ParsedHostHeader | null` |
| `isPrivateIpv4`, `isIpLiteralHostname`, `isLoopbackOrPrivateLanHost` | `({ hostname: unknown }): boolean` |
| `isAllowedBrowserHost` | `({ config, hostHeader, ports: number[], bindHost: string, extraAllowedOrigins: string[] }): boolean` |
| `isAllowedBrowserOrigin` | Same required object plus `origin: unknown`: `boolean` |
| `isLocalSameOrigin` | `({ config, env, req: RequestWithOriginHeaders, port }, { logger? } = {}): boolean` |

`ParsedHostHeader` is `{ hostname, host, port }` with string fields. `RequestWithOriginHeaders.headers` optionally contains `host`, `origin`, and `sec-fetch-site` as unknown values.

## ./composition

`authorizeToolInvocation({ registry, toolId, principal, run, input }, { delegate?: ToolAuthorizationDelegate } = {}): Promise<ToolInvocationAuthorization | undefined>` returns undefined for an unknown tool/foreign registry, `{ descriptor, decision: 'deny' }` on denial, or `{ descriptor, decision: 'allow', handler }` after authorization. `delegate.onAuthorize(ctx)` is an optional veto after the policy allows. This export is intended for execution adapters; it never runs the returned handler.

Type exports: `ToolAuthorizationDelegate`, `ToolInvocationAuthorization`, `AnyPack`, `RequiredTokenIds<Packs>`, and `MissingTokenIds<Packs, BoundIds>`.

```ts
import { authorizeToolInvocation } from '@jini-ai/core/composition';
const authorized = await authorizeToolInvocation({ registry, toolId: 'echo',
  principal: { id: 'caller' }, run: { id: 'run' }, input: 'hello' }, {});
// An execution adapter invokes authorized.handler only when decision is allow.
```

## ./gated-mutations (also root)

`GatewayDeps` requires `generateToken({}): string`, `ttlSeconds`, `clock: Clock`, `idGen: IdGenerator`, `authorize`, and `tokens: TokenStorePort`; optional `authorizeInstance` is needed for instance scope. `AuthorizeFn({ principalId, permission, workspaceId }, { entityType?, entityId? }?): Promise<{ allowed, reason }>` and `InstanceAuthorizeFn({ principalId, permission }): Promise<{ allowed, reason }>` are host policies.

`GatedMutationHooks<TDetails, TResult>` contains `domain`, `readPermission`, `mutatePermission`, `scopeId`, optional `scopeKind: 'workspace' | 'instance'`, `computePlan({}): Promise<{ planHash, details }>`, `executeMutation({ planHash, details }): Promise<TResult>`, and `resolveActorClassIdentity({ principalId, principalKind }): Promise<string | null>`. `PrincipalKind` includes `user`, `agent`, `api_key`, and consumer strings. `Clock` and `IdGenerator` come from `@jini-ai/core/primitives`; `GatewayPlan`, and the hooks/dependencies types are exported here.

| Entry | Current signature and return |
|---|---|
| `authorizeForHooks` | `({ deps, hooks, principalId, permission }): Promise<{ allowed: boolean; reason: string }>` |
| `plan` | `({ deps, principalId, principalKind, hooks }, {} = {}): Promise<GatewayPlan>` |
| `confirm` | Same required identity/dependencies plus `{ planId, planHash }`, second `{}` default: `Promise<ConfirmationTokenRecord>` |
| `execute<TResult>` | Same required identity/dependencies plus `{ confirmationToken }`, second `{}` default: `Promise<TResult>` |
| `mintToken` | `({ planId, planHash, scopeId, confirmerPrincipalId, now, ttlSeconds, generateToken }): ConfirmationTokenRecord` |
| `isRedeemable` | `({ record, now }): boolean` |
| `redeemToken` | `({ store: TokenStorePort, token: string, now: string }): Promise<ConfirmationTokenRecord>` |
| `expireToken` | `({ store, token, now }): Promise<void>`; `now` is unused |
| `new InMemoryTokenStore` | `({})`; implements token port and `count({}): Promise<number>` |
| `appendActorReference` | `({ referencingRowWorkspaceId, actorWorkspaceId, actorId }, { delegatedByWorkspaceId?, delegatedById? } = {}): { actorWorkspaceId, actorId, delegatedByWorkspaceId: string | null, delegatedById: string | null }` |

`ConfirmationTokenRecord` contains `confirmationToken`, `planHash`, `scopeId`, `confirmerPrincipalId`, `createdAt`, `expiresAt`, and `status: 'minted' | 'redeemed' | 'expired'`. `planId` is accepted when minting but not stored. `TokenStorePort` exposes `save({ record }): Promise<void>`, `findByToken({ token }): Promise<Record | null>`, atomic `tryRedeem({ token, now }): Promise<{ redeemed, record: Record | null }>`, and `expire({ token }): Promise<void>`.

```ts
import { plan, confirm, execute } from '@jini-ai/core/gated-mutations';
// deps supplies the authorization, time, generation, and token ports above.
// hooks supplies the consumer's plan computation, identity resolution, and mutation.
const identity = { deps, hooks, principalId: 'operator', principalKind: 'user' };
const proposal = await plan(identity, {});
const approval = await confirm({ ...identity, planId: proposal.planId, planHash: proposal.planHash }, {});
const result = await execute({ ...identity, confirmationToken: approval.confirmationToken }, {});
```

Exported errors: `ForbiddenError`, `PlanStaleError`, `UnauthenticatedError`, `TokenExpiredError`, `TokenAlreadyRedeemedError`, `WorkspaceMismatchError`; constructors and handling are in `errors.spec.md`.

## ./model-facing-tool-errors (also root)

| Entry | Current signature and return |
|---|---|
| `forbiddenRule` | `({ domainPrefix, error }): ModelFacingErrorRule` |
| `reclassifyToolError` | `({ err: unknown, rules: readonly ModelFacingErrorRule[] }): unknown` |
| `withModelFacingErrors` | `({ handlers: Readonly<Record<string, ToolHandler>>, rules }): Record<string, ToolHandler>` |
| `withModelFacingRegistrationErrors` | `({ registrations: readonly ToolRegistration[], rules }): ToolRegistration[]` |
| `callerSafeErrorMessage` | `({ err, rules: readonly CallerSafeErrorRule[], fallback: string }): string` |

`ModelFacingErrorRule` supplies an error constructor, code, optional replacement message and guidance. `CallerSafeErrorRule` supplies an error constructor and optional replacement message. Host-owned allowlists are the only dependencies.

```ts
import { withModelFacingErrors } from '@jini-ai/core/model-facing-tool-errors';
const safe = withModelFacingErrors({ handlers: { echo: async ({ input }) => input }, rules: [] });
```

## ./contribution-registry and ./naming (also root)

`createContributionRegistry<T, K>({ keyOf: ({ contribution: T }) => K }): ContributionRegistry<T>` returns `register({ contribution }): void`, `list({}): readonly T[]`, `clear({}): void`.

`deriveAvailableName(required: NamingPolicy & { base: string }, optional: AvailableNameOptions = {}): Promise<string>` and `deriveDuplicateName(required: NamingPolicy & { sourceName: string }, optional: AvailableNameOptions = {}): Promise<string>` require `isTaken({ candidate }): Promise<boolean>`, `withSuffix({ base, suffix }): string`, and `exhaustionMessage({ base, maxAttempts }): string`. Options are `maxAttempts?: number` and `onExhausted?({ base, maxAttempts }): never`. `MAX_SUFFIX_ATTEMPTS` is 1000.

```ts
import { createContributionRegistry } from '@jini-ai/core/contribution-registry';
import { deriveAvailableName } from '@jini-ai/core/naming';
const contributions = createContributionRegistry({ keyOf: ({ contribution }: { contribution: { id: string } }) => contribution.id });
contributions.register({ contribution: { id: 'reader' } });
const name = await deriveAvailableName({ base: 'Document', isTaken: async () => false,
  withSuffix: ({ base, suffix }) => `${base} ${suffix}`,
  exhaustionMessage: ({ base }) => `No name available for ${base}` }, {});
```

## Evidence and coverage

Source: `src/index.ts`, `src/composition.ts`, their exported modules, and `package.json`. Behavior evidence: `src/__tests__/index.test.ts`, `tool-registry.test.ts`, `pack-lifecycle.test.ts`, gated-mutation tests, `contribution-registry.test.ts`, `naming.test.ts`, and error-policy tests. Tests were read, not executed. All eight exported entry points are documented; no UI entry exists.

## Shared primitives: `./primitives`

```ts
interface Clock { nowMs(): number }
interface IdGenerator { newId(): string }
interface Logger {
  info(required: { message: string }, optional?: { meta?: Record<string, unknown>; error?: unknown }): void;
  warn(required: { message: string }, optional?: { meta?: Record<string, unknown>; error?: unknown }): void;
  error(required: { message: string }, optional?: { meta?: Record<string, unknown>; error?: unknown }): void;
}
type UUID = string;
type ISODateTime = string;
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
createSystemClock(): Clock;
createRandomUuidGenerator(): IdGenerator;
createConsoleLogger({ prefix }: { prefix: string }): Logger;
toIsoDateTime({ epochMs }: { epochMs: number }): ISODateTime;
nowIso({ clock }: { clock: Clock }): ISODateTime;
pathContains({ root, target }: { root: string; target: string }, { caseSensitive = true, separator = '/' }: { caseSensitive?: boolean; separator?: '/' | '\\' } = {}): boolean;
```

Zero-argument getters/factories above are deliberate current signatures. `JsonPrimitive`, recursive `JsonValue`, `JsonObject`, and `JsonArray` describe JSON data, not arbitrary unknown-valued records. No runtime UUID or timestamp validation is added by these aliases.

`HttpClientPort.send({ request: HttpRequest }, { redirect?: RequestRedirect }?): Promise<HttpResponse>` is the canonical egress contract. `HttpRequest` requires method (`GET | HEAD | POST | PUT | PATCH | DELETE`), URL, readonly string headers, and at least one socket budget (`idleTimeoutMs` or legacy `timeoutMs`); optional body, totalDeadlineMs, signal and maxResponseBytes remain request fields. `HttpResponse` requires status, headers and bodyText; optional setCookies, bodyBytes, bodyTruncated, bodyBytesTruncated and finalUrl preserve binary completeness and guarded-hop provenance. `RequestRedirect` is `follow | error | manual`. The kernel defines contracts; it supplies no HTTP transport.

## Shared redaction and text

Root `SecretRedactionOptions` has `policy?: 'conservative' | 'aggressive'`, `exactSecrets?: readonly (string | null | undefined)[]`, and `extraPatterns?: readonly SecretRedactionPattern[]`. Conservative is the default. Root exports `SECRET_SHAPE_PATTERNS`, `SecretShapePattern`, `PEM_PATTERN_NAME`, and lexical `LABELED_SECRET_RE`, `OPAQUE_TOKEN_RE`, `NON_SECRET_TOKEN_RE`. The eleven shape patterns are shared with diagnostics, whose replacement contract is separate.

`./text` exports `stripControlSequences({ text }): string`, `sanitizeUntrustedText({ text }, { maxLength? } = {}): string`, and `SanitizeTextOptions`. Default maximum is 500 characters, including the truncation marker. The sanitizer keeps lowercase `[redacted]` markers and aggressively masks bare opaque runs; root redaction uses category markers.

Root `timingSafeTokenMatch({ presented, expected, timingSafeEqual }, {} = {}): boolean` UTF-8 encodes both strings, refuses unequal byte lengths, then invokes the injected `TimingSafeByteComparison({ left, right })`. No Node comparator is imported by core.

## Root agent-tool catalog and registration kit

`AgentToolSideEffect = 'none' | 'mutates-durable-state' | 'deletes-durable-state' | 'mints-token'`; deletion is independently classified. `AgentToolActorClassRule = 'confirmer-must-equal-own-delegatedBy' | 'user-only' | 'none'`. `AgentToolDefinition` requires name, description, sideEffects and authorization `{ permission; orPermission? }`, with optional actorClassRule/inputSchema.

Root re-exports `src/registration-kit.ts`: `DerivedRiskByToolId`, `AGENT_TOOL_PRINCIPAL_KIND`, `ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT`, `HumanConfirmer`, `HumanConfirmationAnswer`, `humanConfirmedHandler`, `indexCatalogById`, `isRecord`, `requireInputRecord`, `requireString`, `optionalString`, `requireNumber`, `requireObject`, `optionalNumber`, `optionalBoolean`, `requireNoInput`, `fromResult`, `withSchemaOnRejection`, `decorateWithSchema`, `assertToolIsWirable`, `buildDomainRegistrations`, and `mergeDerivedRiskMaps`. Input readers take required `{ input, key }` (`requireInputRecord` takes `{ input }`; `isRecord` takes `{ value }`) and an empty optional object. `decorateWithSchema({ toolId, catalog, message }): Error` has one argument. Wiring takes catalog, handlers and independently derived risk through the exported function declarations; no authorization evaluator or permission policy is supplied implicitly. See `src/registration-kit.ts` for the generic callback types, which remain host supplied.

## Current manifest boundary

The current `package.json` exposes `.`, `./composition`, `./gated-mutations`, `./model-facing-tool-errors`, `./contribution-registry`, `./naming`, `./primitives`, `./text`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.

## Registration-kit parameter declarations

These root declarations preserve the current required/optional split, callback objects and defaults. Result details and generic parameters are defined in [registration-kit.ts](../../src/registration-kit.ts).

| Function and declared parameters |
|---|
| `humanConfirmedHandler(steps: { prepare: (required: { ctx: Parameters<ToolHandler>[0] }, optional?: Record<string, never>) => Promise<TPrepared>; askHuman: (required: { ctx: Parameters<ToolHandler>[0]; prepared: TPrepared }, optional?: Record<string, never>) => Promise<HumanConfirmationAnswer>; run: (required: { ctx: Parameters<ToolHandler>[0]; prepared: TPrepared; confirmer: HumanConfirmer }, optional?: Record<string, never>) => Promise<unknown>; }, _optional: Record<string, never> = {})` |
| `indexCatalogById(required: { catalog: readonly T[] }, _optional: Record<string, never> = {})` |
| `isRecord(required: { value: unknown }, _optional: Record<string, never> = {})` |
| `requireInputRecord(required: { input: unknown }, _optional: Record<string, never> = {})` |
| `requireString(required: { input: Record<string, unknown>; key: string }, _optional: Record<string, never> = {})` |
| `requireNumber(requiredArgs: { input: Record<string, unknown>; key: string }, optionalArgs: Record<string, never> = {})` |
| `requireObject(requiredArgs: { input: Record<string, unknown>; key: string }, optionalArgs: Record<string, never> = {})` |
| `optionalString(required: { input: Record<string, unknown>; key: string }, _optional: Record<string, never> = {})` |
| `optionalNumber(requiredArgs: { input: Record<string, unknown>; key: string }, optionalArgs: Record<string, never> = {})` |
| `optionalBoolean(requiredArgs: { input: Record<string, unknown>; key: string }, optionalArgs: Record<string, never> = {})` |
| `requireNoInput(required: { input: unknown }, _optional: Record<string, never> = {})` |
| `fromResult(requiredArgs: { fn: () => Promise<Result<T>> }, optionalArgs: Record<string, never> = {})` |
| `decorateWithSchema(params: { toolId: string; catalog: ReadonlyMap<string, AgentToolDefinition>; message: string; })` |
| `assertToolIsWirable(params: { toolId: string; catalogEntry: AgentToolDefinition; derivedRisk: DerivedRiskByToolId; }, optional: { handler?: ToolHandler; } = {})` |
| `buildDomainRegistrations(spec: { domain: string; catalogModule: string; catalog: ReadonlyMap<string, AgentToolDefinition>; handlers: Record<string, ToolHandler>; derivedRisk: DerivedRiskByToolId; }, optional: { unwiredToolIds?: ReadonlySet<string> } = {})` |
| `mergeDerivedRiskMaps(requiredArgs: { slices: readonly { domain: string; risk: DerivedRiskByToolId }[] }, optionalArgs: Record<string, never> = {})` |
