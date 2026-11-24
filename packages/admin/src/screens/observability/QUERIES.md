# Queries tab (0.1.14)

The admin composition reports its selected fetch-query adapter. Observability offers Queries
only for TanStack and a confirmed owner (`*` from `/auth/me`, matching identity's owner rule).
The existing SettingsDialogShell mounts only the selected panel. React.lazy then loads
`ReactQueryDevtoolsPanel` from the installed 5.104.1 package's `/production` export, which reads
the nearest live QueryClient. The package's default entry renders nothing in production.
No floating tools or environment flag remain. The devtools dependency is needed at build time;
its existing devDependency placement is sufficient for the shipped static admin assets.

Production defaults to an owner-only live overview with native `inert`: it disables all pointer,
keyboard, filtering and detail-selection controls, while subscriptions keep the overview live.
Development allows interaction, still for owners only. No cache redaction is implemented.
This is a UI affordance on data already fetched by the signed-in browser, not an API authority.

## Needs owner

Confirm production availability and this restricted read-only overview. The installed panel
has no read-only option; accessible, selectable details with mutations disabled, or redaction,
would require a separately approved adapter. Native inert also removes the panel from the
accessibility tree. A visual check remains with the coordinator; no server was started here.

## Build manifest verification (coordinator)

After the shared batch is ready, run `npx vite build --manifest` in the host admin app.
Read `dist/.vite/manifest.json`, starting at the `index.html` entry. Follow only `imports`
recursively: no react-query-devtools/query-devtools chunk should be reachable there.
The tool chunk is reachable through `dynamicImports`, from the Queries panel's lazy boundary.
Inspect the chunk's module membership with the queued bundle test; file names alone do not
prove vendor isolation. In the browser Network tab, opening Overview/other admin pages must
download no tool chunk; opening Queries as an owner loads it once. Built-in hosts never offer it.

Reuse: Jini fetch-query owns cache/auth-read lifecycles; SettingsDialogShell owns tab mounting;
the installed TanStack panel owns cache rendering; native inert supplies interaction blocking.
Adapter capability extraction is recorded in the host-to-Jini extraction survey, pending coordinated build.
