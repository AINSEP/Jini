# SRE Golden Signals

Use this when the service is production-facing and needs telemetry that supports operational response, not just local debugging.

## The Four Signals

- Latency: track successful and failed requests separately
- Traffic: request rate, job rate, or message throughput
- Errors: failure rate by class, not only a raw total
- Saturation: queue depth, pool exhaustion, CPU, memory, disk, concurrency limits

## Minimum Mapping

For each user-facing endpoint or worker:
- one latency metric
- one traffic metric
- one error metric
- one saturation metric tied to the bottleneck

## Alerting Rule

Symptoms page people. Causes help diagnosis.

Prefer alerting on:
- error-rate spikes
- budget burn
- latency SLO misses

Use infrastructure metrics as supporting evidence, not the only page trigger.
