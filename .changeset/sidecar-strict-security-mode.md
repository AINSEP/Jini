---
"@jini-ai/http-kit": minor
"@jini-ai/server": minor
"@jini-ai/daemon": minor
"@jini-ai/mcp": minor
---

Add a `sidecar-strict` security mode and per-run MCP credential propagation.

For a daemon whose threat model is **another process running as the same OS user** rather than a
remote attacker, the existing `jini-local` mode is a no-op: `registerApiBearerAuthMiddleware`
short-circuits for any loopback peer before it reads the `Authorization` header, and a `127.0.0.1`
bind keeps remote hosts out while doing nothing about a co-resident process. A consumer that spawns a
Jini daemon holding real authority — starting agent runs, executing tools against a real database —
previously had to write its own middleware.

- `@jini-ai/http-kit` gains `requireStrictBearerToken`: fail-closed 503 when the named token env var
  is unset, 401 on mismatch, **no loopback exemption and no disable flag**. Its `tokenEnvVar` is
  required with no default, so this package never names a host's secret.
- `composeJiniKernel` gains `security: { mode: 'sidecar-strict', host, tokenEnvVar, exemptPaths? }`.
  Purely additive — `host` and `jini-local` are unchanged by construction, since the modes are arms of
  a discriminated union. The strict gate mounts ahead of the JSON body parser, so a caller it rejects
  never has its body parsed.
- `@jini-ai/daemon`'s `McpJsonInjectionOptions` gains `credential?: (runId) => string | Promise<string>`
  — a **resolver, not a string**, because injection options are built once before any run exists and a
  boot-wide shared secret would defeat the point of scoping a credential to a run. It is delivered to
  the child as `JINI_DAEMON_TOKEN`.
- `@jini-ai/mcp`'s `jini-mcp` reads that variable and attaches `Authorization` to every daemon call.
  Optional throughout: with no credential, request headers and `.mcp.json` output are byte-identical
  to before.

Also generalized: both existing bearer gates now compare tokens in constant time (`timingSafeEqual`)
and share one header-parsing helper, closing a timing side channel and removing a duplicated regex.
