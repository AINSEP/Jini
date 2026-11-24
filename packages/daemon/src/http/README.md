# daemon/http

Route registrars for the daemon's HTTP surface. Each `*Routes({ deps, host })` factory returns route specs the
host mounts; it never opens a listener and never imports another package's implementation (owner rule K5 —
see `ADS-memory/reports/jini-port/extraction-plan.md`).

## Wiring

Injected ports (required on the route deps):

| Route factory | Dep | Port type |
|---|---|---|
| `modelProxyRoutes` | `toolTurns` | `ProviderToolTurnPort` (`../ports/provider-http.ts`) — the provider tool-turn runners |
| `researchRoutes` / `createTavilyResearchProvider` | `baseUrlGuard` | `BaseUrlGuardPort` (`../ports/agent-runtime.ts`) — SSRF base-URL check run before every call out |

Provides: the `/model-proxy/*` streaming routes and the research search route; both relay the injected runner's
events/results unchanged.

Host wiring example (the `@jini-ai/server` preset does this in `builtin-features.ts`):

```ts
import { runAnthropicToolTurn, runAzureToolTurn, runGoogleToolTurn, runOllamaToolTurn, runOpenAiToolTurn, validateBaseUrl } from '@jini-ai/agent-runtime';
import { modelProxyRoutes, researchRoutes } from '@jini-ai/daemon/http';

const toolTurns = { anthropic: runAnthropicToolTurn, openai: runOpenAiToolTurn, azure: runAzureToolTurn, google: runGoogleToolTurn, ollama: runOllamaToolTurn };
mountRoutes({ app, routes: modelProxyRoutes({ deps: { toolTurns }, host }) });
mountRoutes({ app, routes: researchRoutes({ deps: { baseUrlGuard: { validate: validateBaseUrl } }, host }) });
```

Must never import: `@jini-ai/agent-runtime` or any other package's implementation from these two routes (types from
`@jini-ai/core` contracts and this package's own `ports/` only). `xai.ts`, `host-tools.ts` and
`attachment-persistence.ts` still import implementations and are tracked as open XC-4 sites.
