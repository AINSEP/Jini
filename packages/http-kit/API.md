# HTTP kit API after integration

Every public callable takes a required argument object, followed by an optional
argument object when options exist. Payload objects can themselves be the required
object. Express callbacks and native interfaces retain the
signature declared by their owner. Removed and relocated exports are listed in CHANGELOG.md.

| Entry | APIs and injected ports |
| --- | --- |
| `.` | `ok({ value })`, `err({ error })`, `defineJsonRoute(requiredSpec, options?)`, `mountJsonRoute({ app, spec, deps, adapter })`; handlers use `({ input, deps }, { signal? })`; registrars generally use `({ app, deps, adapter })`. |
| `./rate-limit` | `createRateLimiter({ profile, clock, store })`, `createMemoryCounterStore({})`, `resolveClientIp({ source, policy })`; await `check({ key })` and `size({})`; the clock implements core `nowMs()`. |
| `./middleware` | `rejectOversizedJsonBody({ maxBytes, errorResponseFactory })`, mounted after the host's bounded JSON parser. |
| `./verified-origin` | `new OriginRegistry({ repo })`, `new InMemoryOriginSettingRepo({ seeds })`, `normalizeOriginCandidate({ rawUrl })`, `createVerifiedOrigin(evidence)`, `VerifiedOriginRequestContext`, explicit configured-origin/boot policy; errors take `{ message }`. |
| `./observability` | `applyRequestTracking({ app, observability })`, `createRequestTrackingMiddleware({ observability })`. Hook ports are structurally compatible with diagnostics/observability. |

All entries have Node runtime metadata. Settings routes belong to `@jini-ai/cms/http/settings`; HTTP kit has no CMS
dependency. Neither adapter depends on a concrete storage, identity, logging or tracing provider.
Daemon route packs and read-only policy moved to the daemon HTTP and policy entries.

```ts
import express from 'express';
import { defineJsonRoute, mountJsonRoute, ok } from '@jini-ai/http-kit';

const app = express();
app.use(express.json());
const adapter = { resolvedPortRef: { current: 4000 }, env: {},
  allowedOriginsEnvVar: 'APP_ALLOWED_ORIGINS', webPortEnvVar: 'APP_WEB_PORT',
  bindHostEnvVar: 'APP_BIND_HOST' };

const echo = defineJsonRoute<{ msg: string }, { echoed: string }, void>({
  method: 'post', path: '/echo',
  parse: raw => ok({ value: { msg: String((raw.body as { msg?: unknown })?.msg ?? '') } }),
  handle: ({ input }) => ok({ value: { echoed: input.msg } }),
});
mountJsonRoute({ app, spec: echo, deps: undefined, adapter });
```

No listener, application path layout, environment variable name, principal header,
site identifier or observability provider is selected by the new adapters.

Origin validation functions come directly from `@jini-ai/core`. Configured parsing
and boot assertions take `{ config, env }`; malformed entries are dropped per
request and rejected at boot. Origin contexts require explicit `env` and all three
variable names (`allowedOriginsEnvVar`, `webPortEnvVar`, `bindHostEnvVar`).
`registerApiBearerAuthMiddleware({ app, tokenConfig, env }, { trustLoopbackPeers? })`
and `requireStrictBearerToken({ tokenEnvVar, env }, { exemptPaths? })` use explicit
environments. `registerApiOriginGuardMiddleware({ app, deps })` requires those
origin variable names and environment within `deps`.

`sendApiError({ res, status, error })` is the sole error writer. The compat error
constructors remain, but the second writer and `sendCompatApiError` export are removed.
`timingSafeTokenMatch({ presented, expected })` supplies core's comparison port
using Node's timing-safe equality.
