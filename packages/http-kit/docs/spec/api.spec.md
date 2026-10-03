Spec ID: SPEC-JINI-HTTP-KIT-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:fea4fb902c78be40bb91e12417b2368d70759c4971046bcee3c895ede4ab579b
spec_mode: reverse_spec


# HTTP-kit consumer API

## Entry points and calling convention

`package.json` exposes `@jini-ai/http-kit`, `/rate-limit`, `/middleware`, `/verified-origin`, `/observability`. All are Node entry points. The root exports generic transport primitives; domain routes are imported from `@jini-ai/daemon/http` and settings from `@jini-ai/cms/http/settings`. Read-only policy belongs to `@jini-ai/daemon/read-only-tools`.

The tables record current source, including unfinished argument conversion. Unless marked **one object** or **positional**, listed operations accept `(required, optional = {})`; omitted optional fields mean an empty second object. A second options parameter is not implemented on the marked operations. Shared primitives come from core/primitives; Result specializes the shared result with protocol ApiError.

## JSON route contract

```ts
type Result<T, E = ApiError> = { ok: true; value: T } | { ok: false; error: E };
type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';
type RouteInputContext = { body: unknown; query: Record<string, unknown>; params: Record<string, string> };
type InputParser<I> = (raw: RouteInputContext) => Result<I>; // Current single raw object.
type Handler<I, O, D> = (
  required: { input: I; deps: D }, optional?: { signal?: AbortSignal },
) => Result<O> | Promise<Result<O>>;
type JsonRouteSpec<I, O, D> = {
  method: HttpMethod; path: string; parse: InputParser<I>; handle: Handler<I, O, D>;
  requireSameOrigin?: boolean; successStatus?: number;
};
```

`ApiError`, run protocol/status values and tool outcomes come from `@jini-ai/protocol`, `@jini-ai/core` and `@jini-ai/daemon`. The consumer supplies a real Express app and any body parser/security middleware. `AdapterContext` requires `resolvedPortRef: {current:number}`; required `env: NodeJS.ProcessEnv`, `allowedOriginsEnvVar`, `webPortEnvVar`, `bindHostEnvVar`, and optional `onInternalError(context)` control origin configuration and private exception reporting.

| Root export | Required object; optional object → result |
|---|---|
| `ok<T,E>` / `err<T,E>` | `{value: T}` / `{error: E}` → `Result<T,E>` |
| `defineJsonRoute<I,O,D>` | `{method, path, parse, handle}`; `{requireSameOrigin?, successStatus?}` → `JsonRouteSpec<I,O,D>` |
| `mountJsonRoute<I,O,D>` | `{app: Express, spec, deps: D, adapter: AdapterContext}` → `void` |
| `ClientFacingError` | `new ClientFacingError({apiError}, {})` → `Error` with `apiError` |
| `createCompatApiError` | `{code, message}`; `Omit<ApiError, 'code' \| 'message'>` → `ApiError` |
| `createCompatApiErrorResponse` | Same input → `{error: ApiError}` |
| `mountPackHttp<Packs>` | `{app: unknown, packs: Packs, daemon: Daemon<Packs>}` → `void`; delegates each pack's HTTP extension against the composed daemon services |

```ts
import express from 'express';
import { defineJsonRoute, mountJsonRoute, ok } from '@jini-ai/http-kit';
const app = express();
app.use(express.json({ limit: '64kb' }));
const adapter = { resolvedPortRef: { current: actualListenPort }, env: hostEnv, allowedOriginsEnvVar: 'APP_ALLOWED_ORIGINS', webPortEnvVar: 'APP_WEB_PORT', bindHostEnvVar: 'APP_BIND_HOST' };
const spec = defineJsonRoute({ method: 'get', path: '/api/example', parse: () => ok({ value: undefined }), handle: () => ok({ value: { available: true } }) });
mountJsonRoute({ app, spec, deps: {}, adapter });
```

## Root origin, authentication and inventory operations

| Export | Current signature/result |
|---|---|
| Core origin re-exports | Same signatures as `@jini-ai/core`: configured origins require `{ config, env }`; browser-host/origin predicates require explicit config. No environment-key defaults are installed by these re-exports. |
| `bearerTokenFromHeader` | `({header: string \| undefined}, {}) => string \| null` |
| `timingSafeTokenMatch` | `({presented: string, expected: string}, {}) => boolean` |
| `registerApiBearerAuthMiddleware` | `({app, tokenConfig, env}, {trustLoopbackPeers?} = {}) => void` |
| `requireStrictBearerToken` | `({tokenEnvVar: string, env}, {exemptPaths?: readonly string[]} = {}) => RequestHandler` |
| `registerApiOriginGuardMiddleware` | `({app, deps: {host, getResolvedPort, extraAllowedOrigins?, env?}}, {}) => void` |
| `normalizeLocalAuthority` | `({value: unknown}, {}) => {hostname, port} \| null` |
| `isLoopbackHostname`, `isLoopbackPeerAddress` | `({hostname: unknown}, {})` / `({address: unknown}, {}) => boolean` |
| `localOriginFromHeader` | `({value: unknown}, {}) => string \| null` |
| `validateLocalDaemonRequest` | `({req: Request}, {}) => {ok: true, origin: string \| null} \| {ok: false, message, details: Record<string,string>}` |
| `requireLocalDaemonRequest` | `({req, res, next}, {}) => void \| Response`; wrap as an Express callback |
| `guardedRouteKey` | `({method: string, path: unknown, guardedRouteKeys: ReadonlySet<string>}, {}) => string \| null` |
| `installRouteRegistrationGuard` | `({app}, {guardedRouteKeys?} = {}) => void` |
| `getRouteRegistrationInventory` | `({app}, {}) => RouteRegistration[]`, `{method, path}` |

Core origin configuration names the host environment keys explicitly. Api bearer middleware requires tokenConfig and env; strict bearer middleware requires tokenEnvVar and env. Origin middleware dependencies extend core OriginValidationEnvConfig.

## Root streaming and workspace operations

| Export | Current signature/result and dependencies |
|---|---|
| `createSseChannel<E extends SseEvent>` | `({res: ServerResponse}, {maxQueuedEvents?, isEndEvent?: ({event}) => boolean, formatEvent?: ({event}) => string, onWriteError?: ({error}) => void} = {}) => SseChannel<E>` |
| `requestedAfterCursor` | **One object:** `(req: {get(name: string): string \| undefined; query: Record<string,unknown>}) => string \| null` |
| `sendRawApiError` | `({res: ServerResponse, status, error: ApiError}, {}) => void` |
| `createSseResponse` | `({req: IncomingMessage, res: ServerResponse}, {keepAliveMs?, onClose?: () => void, maxQueuedMessages?} = {}) => SseConnection` |

`SseEvent = {opaqueCursor: string, kind: string}`. `SseChannel` methods: `enqueue({event}, {})`, `onClose({callback}, {})`, `open()`, `end()`, `abandon()`, all void; `isClosed() => boolean`. `SseConnection.send({data}, {}) => void`, `close() => void`, readonly `closed: boolean`. `DEFAULT_MAX_QUEUED_SSE_EVENTS = 1000` is public at root; the raw-message default is also 1000 but its constant is not root-exported.

## `/rate-limit`

`createMemoryCounterStore({}, {}) => CounterStore`; `createRateLimiter({profile,clock,store}, {}) => RateLimiter`; `resolveClientIp({source,policy}, {}) => string`. `RateLimitProfile = {windowSeconds,max,burst}`; `Clock.nowMs() => number` is the core clock contract.

`CounterStore` async methods: `get({key}) => CounterWindow | undefined`, `set({key,state})`, `delete({key})`, `entries({}) => Iterable<readonly [string,CounterWindow]>`, `size({}) => number`; window `{windowStartMs,count}`. Limiter `check({key}) => Promise<{allowed:true} | {allowed:false,retryAfterSeconds:number}>`, `size({}) => Promise<number>`.

`ClientIpSource = {socket:{remoteAddress?},headers:Record<string,string|string[]|undefined>,ip?}`. `ClientIpPolicy = {unknownAddress,isTrustedProxy({address}):boolean,fallbackAddress({source,socketPeer}):string}`. Proxy trust and framework `ip` configuration are consumer-owned.

```ts
import { createMemoryCounterStore, createRateLimiter } from '@jini-ai/http-kit/rate-limit';
const limiter = createRateLimiter({ profile: { windowSeconds: 60, max: 30, burst: 5 }, clock: { nowIso: () => new Date().toISOString() }, store: createMemoryCounterStore({}) });
const decision = await limiter.check({ key: authenticatedClientId });
```

## `/middleware`

`rejectOversizedJsonBody({maxBytes,errorResponseFactory}, {}) => RequestHandler`. Factory receives `{maxBytes,bodyBytes}` and returns an unknown JSON envelope. `BodySizeLimitRequired`, empty `BodySizeLimitOptional`, `ErrorResponseFactory` are public.

```ts
import { rejectOversizedJsonBody } from '@jini-ai/http-kit/middleware';
app.post('/api/example', rejectOversizedJsonBody({ maxBytes: 4096, errorResponseFactory: () => ({ error: 'body too large' }) }), handler);
```

## `/verified-origin`

These are currently **one-object** APIs and constructors. `VerifiedOrigin = {scheme:'https'|'http',host,port?,basePath?,verifiedAt:string,source:'workspace-setting'|'dev-capability'}`. `createVerifiedOrigin(origin) => VerifiedOrigin`; `hasForbiddenRawUrlCharacter({raw}) => boolean`; `normalizeOriginCandidate({rawUrl}) => {scheme,host,port} | null`; `isSameOrigin({target,canonical}) => boolean`.

`new OriginRegistry({repo:OriginSettingRepoPort})` returns async `canonicalOrigin({workspaceId,siteId?,locale?}) => VerifiedOrigin`, `isAllowedRedirectTarget({context:{workspaceId,siteId?,originKey?},url}) => boolean`, `isAllowedEgressTarget({context:{workspaceId,siteId?},url}) => boolean`. Repo ports: `findByWorkspaceId({workspaceId}) => Promise<VerifiedOrigin|null>`, `findRedirectAllowlist({workspaceId})`, `findEgressAllowlist({workspaceId}) => Promise<string[]>`.

`new InMemoryOriginSettingRepo({seeds: readonly OriginSettingSeed[]})` implements the repo; seed `{workspaceId,origin,redirectAllowlist?,egressAllowlist?}`. `resolveConfiguredOrigin({env,envVarName,clock:{nowIso():string},warn:(message)=>void}) => VerifiedOrigin|undefined`; `planOriginBoot(same plus {allowDevSeed:()=>boolean,missingOriginWarning}) => {kind:'configured',origin}|{kind:'dev-seed'}|{kind:'none'}`. `new InsecureOriginSourceError({message})`, `new OriginNotVerifiedError({message})` extend Error.

```ts
import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from '@jini-ai/http-kit/verified-origin';
const origin = createVerifiedOrigin({ scheme: 'https', host: 'app.example.com', verifiedAt: new Date().toISOString(), source: 'workspace-setting' });
const registry = new OriginRegistry({ repo: new InMemoryOriginSettingRepo({ seeds: [{ workspaceId, origin }] }) });
const allowed = await registry.isAllowedRedirectTarget({ context: { workspaceId }, url: redirectUrl });
```

## `/observability`

**One-object** `createRequestTrackingMiddleware({observability:HttpRequestObservabilityPort}) => RequestHandler`, `applyRequestTracking({app:Express,observability}) => void`. Port `trackRequest({method,path}) => {end({statusCode,routePattern}):void}`. Mount first so refusals/unmatched requests are recorded.

```ts
import { applyRequestTracking } from '@jini-ai/http-kit/observability';
applyRequestTracking({ app, observability: hostRequestMetrics });
```

## Public request/response primitives

Root also exports `rawInput`, parser helpers, `sendJson`, `sendApiError`, `statusForError`, and `guardSameOrigin({ req, origin }, {} = {}): Result<void>` through their source barrels. AdapterContext extends required OriginContext. Root SSE defaults remain 1000 queued events; shared origin, response and error rules operate without domain store or runtime dependencies. See `src/request.ts` and `src/response.ts` for the concrete parser and status exports.

Source: the five package export targets and `src/index.ts`. This is source-level verification; distribution and runtime behavior were not executed.

## Request normalization and core-origin re-exports

`rawInput({req}, {})` returns body/query/params. `validationError({message}, {issues = []} = {})` returns BAD_REQUEST with validation details only when issues are nonempty. `sendJson({res,status,body}, {})`, `sendApiError({res,status,error}, {})` write one JSON response; `statusForError({error}, {})` uses the declared code map or 500. `guardSameOrigin({req,origin}, {})` returns Result<void>. Root re-exports core `normalizedLocalOrigin`, `configuredAllowedOrigins`, `assertValidAllowedOrigins`, `isLocalSameOrigin`, `OriginValidationEnvConfig` and related origin types with the same required config/env contracts.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Function and declared parameters | Declaration |
|---|---|
| `allowedBrowserPorts({ config, port, env }: OriginValidationArgs & { port: number \| string \| null \| undefined },)` | [origin-validation.ts](../../../core/src/origin-validation.ts) |
| `configuredAllowedHosts({ origins }: { origins: string[] })` | [origin-validation.ts](../../../core/src/origin-validation.ts) |
| `isAllowedBrowserHost({ hostHeader, ports, bindHost, extraAllowedOrigins }: { config: OriginValidationEnvConfig; hostHeader: unknown; ports: number[]; bindHost: string; extraAllowedOrigins: string[]; },)` | [origin-validation.ts](../../../core/src/origin-validation.ts) |
| `isAllowedBrowserOrigin({ origin, hostHeader, ports, bindHost, extraAllowedOrigins }: { config: OriginValidationEnvConfig; origin: unknown; hostHeader: unknown; ports: number[]; bindHost: string; extraAllowedOrigins: string[]; },)` | [origin-validation.ts](../../../core/src/origin-validation.ts) |
| `isIpLiteralHostname({ hostname }: { hostname: unknown })` | [origin-validation.ts](../../../core/src/origin-validation.ts) |
| `isLoopbackOrPrivateLanHost({ hostname }: { hostname: unknown })` | [origin-validation.ts](../../../core/src/origin-validation.ts) |
| `isPrivateIpv4({ hostname }: { hostname: unknown })` | [origin-validation.ts](../../../core/src/origin-validation.ts) |
| `parseHostHeader({ value }: { value: unknown })` | [origin-validation.ts](../../../core/src/origin-validation.ts) |

| Additional exported names | Kind and source |
|---|---|
| `ApiBearerAuthMiddlewareDeps`, `ApiOriginGuardMiddlewareDeps`, `StrictBearerTokenDeps` | type; [api-security-middleware.ts](../../src/api-security-middleware.ts) |
| `ConfiguredOriginRequired`, `OriginBootPlan`, `OriginBootRequired` | type; [configured-origin.ts](../../src/verified-origin/configured-origin.ts) |
| `CreateSseChannelOptions` | type; [sse.ts](../../src/sse.ts) |
| `CreateSseResponseOptions` | type; [raw-sse.ts](../../src/raw-sse.ts) |
| `EgressTargetContext`, `OriginRegistryPort`, `RedirectTargetContext`, `VerifiedOriginRequestContext` | type; [ports.ts](../../src/verified-origin/ports.ts) |
| `InstallRouteRegistrationGuardOptions` | type; [route-registration-guard.ts](../../src/route-registration-guard.ts) |
| `NormalizedTarget`, `OriginRegistryDeps` | type; [origin.ts](../../src/verified-origin/origin.ts) |
| `OriginScheme`, `OriginSource` | type; [types.ts](../../src/verified-origin/types.ts) |
| `ParsedHostHeader`, `RequestWithOriginHeaders` | type; [index.ts](../../../core/src/index.ts) |
| `RateLimitResult` | type; [rate-limit.ts](../../src/rate-limit.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./rate-limit`, `./middleware`, `./verified-origin`, `./observability`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
