<!-- Source: Addy Osmani / agent-skills / observability-and-instrumentation -->

# Observability Principles

## Define Working Before Instrumenting

Before writing any telemetry code, answer these questions:

1. **What does healthy look like?** — Define the observable state of a correctly-running system. What should be true when nothing is wrong?
2. **What will oncall ask at 3am?** — Name the specific questions a responder will need to answer during an incident. Instrument for those questions.
3. **What SLO will page?** — Define the threshold that constitutes a user-visible failure worth waking someone up. Only instrument what feeds into that decision.
4. **What is the boundary of "my service"?** — Define where your service starts and ends so you know which signals you own.

Telemetry added without answering these questions produces noise, not signal. Every metric, log, and trace should be traceable to one of these four answers.

---

## Signal Selection

| Signal | Answers | Cost Profile | Example Use |
|--------|---------|--------------|-------------|
| **Structured log** | Why did this happen? What were the inputs? What was the state? | High storage, queryable, retention-limited | Request failed: user ID, error type, stack trace, correlation ID |
| **Metric** | Is this happening? How often? At what rate? How bad? | Low storage, aggregated, long retention | Request rate, error rate, p95 latency, queue depth |
| **Trace** | Where in the system did this slow down? Which service was the bottleneck? | Medium storage, sampled, cross-service | 400ms request: 10ms in gateway, 350ms in user-service DB query, 40ms serialization |

**Compact mnemonic:** Metrics tell you THAT something is wrong. Traces tell you WHERE in the system. Logs tell you WHY.

---

## RED / USE Frameworks

### RED (for services)

Apply to any service that handles requests:

| Dimension | Metric | Example |
|-----------|--------|---------|
| **Rate** | Requests per second | `http_requests_total` rate over 1m |
| **Errors** | Error rate (4xx/5xx per second, or %) | `http_errors_total / http_requests_total` |
| **Duration** | Latency distribution (p50/p95/p99) | `http_request_duration_seconds` histogram |

Use RED when diagnosing user-facing symptoms. Start here for any "the site is slow" or "users are seeing errors" incident.

### USE (for resources)

Apply to any infrastructure resource (CPU, memory, disk, database connection pool, queue):

| Dimension | Metric | Example |
|-----------|--------|---------|
| **Utilization** | % of resource being used | CPU at 73%, connection pool at 85 of 100 |
| **Saturation** | Queue depth or wait time when resource is full | Queue depth = 2400, p99 wait = 800ms |
| **Errors** | Failed operations on this resource | Disk write errors, connection refused count |

Use USE when diagnosing infrastructure capacity or saturation. Apply after RED points to a specific service bottleneck.

---

## Cardinality

High-cardinality labels destroy metrics backends. A label with N unique values produces N separate time series. At millions of unique values (user IDs, raw URLs, error messages), storage and query cost becomes prohibitive.

| Label Type | OK or NEVER | Reason |
|------------|-------------|--------|
| `method` (GET, POST, DELETE) | OK | ~5 values |
| `status_code` (200, 404, 500) | OK | ~20 values |
| `endpoint` (/users, /orders) | OK with care | Bounded if routes are fixed |
| `user_id` | NEVER | Unbounded — millions of users |
| `raw_url` (/users/12345/orders/67890) | NEVER | Path params make this unbounded |
| `error_message` (full string) | NEVER | Free text = unbounded cardinality |
| `trace_id` | NEVER in metrics | Belongs in traces and logs, not metrics |

**Rule:** If a label value can grow without bound, it belongs in a log or trace, not a metric label.

---

## Averages Never, Percentiles Always

The average of a latency distribution hides the long tail. A p99 of 5 seconds is invisible in an average of 120ms if 99% of requests complete in 100ms.

Use **histograms** and report **p50, p95, p99** (or higher for SLO-critical paths). The p99 is what your worst-served users experience. The p50 is the typical user experience.

```
Good:  "p99 latency is 450ms, p50 is 35ms"
Bad:   "average latency is 38ms"   ← hides 450ms tail
```

Prometheus histograms with `histogram_quantile` give aggregatable percentile estimates from bucket data. Accuracy depends on bucket boundaries — align buckets with your SLO thresholds. Native histograms (Prometheus 2.40+) give better resolution automatically.

---

## Alerting Rules

Every alert must satisfy all four conditions before it is added to the runbook:

1. **Actionable** — There is a specific human action that addresses it. If no one knows what to do when it fires, it is not ready to alert.
2. **Links to a runbook** — The alert notification must contain a direct link to documented investigation steps. A runbook without a link is useless at 3am.
3. **Justified threshold** — The threshold is based on observed baseline data and an agreed SLO, not a round number or gut feel. Document why the threshold is what it is.
4. **Two severities only** — Page (wake someone up, requires immediate action) or Ticket (fix in business hours). A third "warning" tier becomes noise that trains people to ignore alerts.

**A third tier becomes noise.** If you find yourself adding a "warning" severity, ask whether it is genuinely actionable. If it is, make it a ticket. If it is not, delete it.

---

## Verify the Telemetry Itself

Telemetry that has never been tested will fail silently in production. Before shipping any new instrumentation:

1. **Force an error in staging** — deliberately trigger the error condition and confirm the error log entry appears with the correct fields, `requestId`, and error type.
2. **Find it by requestId** — search for the requestId in your log aggregator. If you cannot find it, your correlation ID propagation is broken.
3. **Confirm structured fields** — validate that `timestamp`, `level`, `service`, `trace_id`, `span_id`, `message`, and `context` are all present and correctly typed.
4. **Test-fire each new alert once** — trigger the alert condition in staging, confirm the notification fires, confirm the runbook link works, confirm the severity routes correctly.

---

## OpenTelemetry Auto-Instrumentation Bootstrap (Node.js)

```typescript
// tracing.ts — must be loaded before any other imports
// Node 22+: use --import instead of --require
// Node 18/20: use --require ./tracing.js
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.SERVICE_NAME ?? 'unknown-service',
    [ATTR_SERVICE_VERSION]: process.env.SERVICE_VERSION ?? '0.0.0',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable noisy filesystem instrumentation unless needed
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().then(() => process.exit(0));
});
```

```bash
# CommonJS preload
node --require ./tracing.js dist/server.js

# ESM preload (available in Node 18.18+ and 20+)
node --import ./tracing.js dist/server.js
```

Auto-instrumentation covers: HTTP/HTTPS, Express, Fastify, Prisma, pg, mysql2, Redis, gRPC, and more — without modifying application code.
