# errors

The one incident path for a host. A boundary hands a caught value to the reporter: a refusal (an
error the scope's catalog bindings name) becomes its code and words with no incident; anything else
is an incident with one error ID, one host record and one tracker report. `runOperation`,
`startOperation`, `endOnce` and `NOOP_OPERATION_TRACKER` wrap a unit of work in one operation span.

## Wiring

Per ADR-071, this section says what a host must pass and who owns what.

### Required reporter ports

`createErrorReporter(ports, { redaction })` takes every port; none has a default, so an incident
cannot be dropped for lack of wiring.

| port | what it does |
|---|---|
| `ids` | mints `ERR-XXXX-XXXX-XXXX-XXXX`. If it throws, `UNAVAILABLE_ERROR_ID` stands in. |
| `clock` | the incident time. If it throws, the time is left out. |
| `logger` (`warn`, `error`) | receives the operator host record. |
| `observability.reportError` | receives the exported tracker record. |
| `catalog` | the refusal bindings and the describer vocabulary. |
| `versions` (`app`, `jini`) | stamped on every record and on the Copy-details block. |

Build one reporter per process composition and share it across HTTP routes, tools and IPC. Its
per-reporter dedupe mark (a `WeakMap` keyed by error object) only works when every boundary uses
the same reporter: a failure that crosses two boundaries then keeps its first ID and gets no second
record. Thrown primitives (a string, a number) are never deduped.

### HTTP

A route host goes into reporter mode by passing `RouteErrorPorts`:

```ts
type RouteErrorPorts = { reporter: ErrorReporter; observability: Pick<ObservabilityPort, 'trackOperation'> };
```

Each request is one `http.route` operation. The lifecycle helpers are pure functions imported from
`@jini-ai/core/errors/reporter`. They are not ports, so a host never implements or swaps them.

### Who owns the incident

The boundary that catches a failure owns its incident, and it reports it once.

- **HTTP**: the route boundary. A handler that has already reported a failure and returns the
  reporter-backed `INTERNAL_ERROR` owns that report itself, and the route only classifies it as
  `failed`.
- **Tool calls**: the tool executor. If the same error object later reaches a route through the
  same reporter, the route reuses the tool's ID.
- **IPC**: the IPC handler, through `record` (nobody is shown words) or `describe` (a caller gets an
  answer).
- **Cancellation** (a client that went away) is not an incident. `runOperation`'s `settle` claims
  it, and the result is `{ ok: false, cancelled: true }` with no record and no report.

### Host binding example

```ts
import { createErrorReporter, runOperation } from '@jini-ai/core/errors/reporter';

const reporter = createErrorReporter(
  { ids, clock, logger, observability, catalog, versions: { app: APP_VERSION, jini: JINI_VERSION } },
  { redaction: { exactSecrets: [deployToken] } },
);
const errors = { reporter, observability }; // RouteErrorPorts for the route host

const run = await runOperation({
  deps: { reporter, observability },
  operation: 'site.export', scope: 'sites', step: 'Export site',
  fallback: { message: 'The site export could not be completed.', action: 'Try the export again.' },
  attributes: { 'site.id': siteId },
  work: () => exportSite(siteId),
}, { audience: 'signed-in' });
```

### Operator host record vs exported tracker record

- The **host record** goes to `logger`. It stays with the operator: a redacted diagnostic text
  (message, stack, causes), the step, labels, versions, time and the admitted `attributes`.
- The **tracker record** goes to `observability.reportError` and may leave the process. It carries
  the original error object, the fixed operation name, the incident ID, the label, trace IDs, the
  admitted `attributes` and the private `exactSecrets`. The adapter must blank those secrets from
  the error before export and must never serialize, log or forward the array itself. Redaction is
  the adapter's job.
- `attributes` are admitted where they are created. Only short fixed-shape labels pass
  (`^[\w.:/-]{1,128}$`, finite numbers, at most 16 keys). A value that holds a known exact secret,
  or that the redactor recognises as a token, is dropped.
