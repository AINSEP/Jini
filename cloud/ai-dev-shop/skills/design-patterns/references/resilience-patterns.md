# Resilience Patterns: Circuit Breaker, Bulkhead, Retry, Timeout

Every distributed system fails partially. A service goes slow. A database becomes unavailable. A third-party API starts returning 500s. Resilience patterns prevent these partial failures from cascading into total system failure.

These are not optional patterns for large systems. They are the baseline for any system that makes external calls.

---

## Part 1: Timeout

### What It Is

The simplest and most important resilience pattern: every call to an external system must have an explicit timeout. A call that never returns is worse than a call that fails fast — it holds threads and connections indefinitely, starving the entire system.

```typescript
// Without timeout — thread blocks indefinitely if service hangs
const response = await fetch('https://payment-service/charge')

// With timeout — fails fast, releases resources
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 5000)  // 5s read timeout
try {
  const response = await fetch('https://payment-service/charge', {
    signal: controller.signal,
    // connect timeout handled at the infrastructure/proxy level (1-3s recommended)
  })
} finally {
  clearTimeout(timeoutId)
}
```

### Two Timeout Types

- **Connection timeout**: How long to wait for the TCP connection to be established. Keep this short (1-3 seconds). If you cannot connect in 3 seconds, the server is not coming.
- **Read timeout**: How long to wait for the response after connecting. Set this based on the expected response time of the operation + margin. For a fast read: 2-5 seconds. For a slow write: 10-30 seconds.

### Critical Rule

**Never set an infinite timeout**. The default in most HTTP clients is no timeout. Always override it explicitly. Every call in every service.

---

## Part 2: Retry with Exponential Backoff

### What It Is

Automatically retry a failed operation, with increasing wait time between attempts, to handle transient failures without overwhelming a struggling service.

```
Attempt 1: fails immediately
Wait: 1 second
Attempt 2: fails
Wait: 2 seconds
Attempt 3: fails
Wait: 4 seconds
Attempt 4: succeeds
```

### When to Retry vs. When Not to Retry

**Retry on**: Transient failures — network timeouts, 503 Service Unavailable, 429 Too Many Requests, connection errors. These may succeed on the next attempt.

**Do not retry on**: Permanent failures — 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 422 Unprocessable. Retrying will not help and wastes resources.

### Exponential Backoff with Jitter

Pure exponential backoff (1s, 2s, 4s, 8s...) causes synchronized retries when many clients fail simultaneously — the "thundering herd" problem. Add jitter (random delay) to spread retries:

```typescript
async function retryWithBackoff<T>(
  { fn }: { fn: () => Promise<T> },
  { maxAttempts = 4, baseDelayMs = 1000 }: { maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransientError(err) || attempt === maxAttempts - 1) throw err
      const delay = baseDelayMs * 2 ** attempt
      const jitter = Math.random() * delay * 0.1  // 10% jitter
      await sleep(delay + jitter)
    }
  }
  throw new Error('unreachable')
}
```

### Max Retry Limit

Always define a maximum number of attempts. Unbounded retries are worse than no retries — they turn a brief outage into a sustained traffic spike.

A reasonable default: 3-4 attempts. For critical operations: up to 5. Beyond that, fail and let the caller handle it.

---

## Part 3: Circuit Breaker

### What It Is

A state machine that stops forwarding requests to a failing dependency, allowing it time to recover, rather than hammering it with requests that will fail.

Named after the electrical circuit breaker: when there is a fault, it trips and breaks the circuit to prevent damage.

```
State machine:

  CLOSED ──────► OPEN ──────► HALF-OPEN
  (normal)       (broken)     (testing)
     ▲                           │
     └───────────────────────────┘
        (success in half-open)
```

### Three States

**CLOSED** (normal operation):
- All requests pass through
- Failure count is tracked
- When failure count exceeds threshold within a time window → trip to OPEN

**OPEN** (failure mode):
- All requests fail immediately without calling the dependency (fast fail)
- After a configured reset timeout (e.g., 30 seconds) → transition to HALF-OPEN

**HALF-OPEN** (testing recovery):
- Allow a limited number of test requests through
- If test requests succeed → close the circuit (back to CLOSED)
- If test requests fail → trip back to OPEN

```
Failure threshold: 5 failures in 60 seconds → trip to OPEN
Reset timeout: 30 seconds in OPEN → move to HALF-OPEN
Test requests: 3 requests in HALF-OPEN → if all succeed, move to CLOSED
```

### Fallback Strategies

When the circuit is OPEN, define what the caller gets instead of an error:

- **Cached response**: Return the last known good response (acceptable for read operations)
- **Default value**: Return a sensible default ("inventory: unknown", "recommendations: []")
- **Degraded response**: Return a partial response from a secondary source
- **Queue for later**: Accept the operation and process it when the dependency recovers
- **Explicit failure**: Return a clear error telling the caller the service is unavailable

The right fallback depends on the operation. Payment processing cannot return a cached result. Product recommendations can.

### When to Use Circuit Breaker

Use whenever: a service makes synchronous calls to external dependencies (databases, other services, third-party APIs) where failure should not cascade to the caller.

Do not use for: in-process function calls. Circuit breakers are for network calls.

---

## Part 4: Bulkhead

### What It Is

Isolate different types of requests into separate resource pools, so that one type of slow or failing request cannot consume all available resources and starve other request types.

Named after the watertight compartments in a ship's hull: if one compartment floods, the others remain intact.

```
Without Bulkhead:                   With Bulkhead:

 All requests share                 Fast requests   Slow requests
 one thread pool:                   ┌────────────┐  ┌────────────┐
 ┌─────────────────┐                │  10 threads│  │  5 threads │
 │ 20 threads      │                │  (reports) │  │  (exports) │
 │                 │                └────────────┘  └────────────┘
 │ Fast requests   │
 │ Slow exports    │     → Slow exports fill their pool
 │ (exports slowly │       but cannot starve fast requests
 │  fill all 20    │
 │  threads)       │
 │ Fast requests   │
 │ now starved     │
 └─────────────────┘
```

### Implementation Approaches

**Thread pool isolation**: Each type of call gets its own dedicated thread pool. Exhausting one pool does not affect others.

**Connection pool isolation**: Each downstream dependency gets its own connection pool. A slow database cannot consume connections meant for another database.

**Process/container isolation**: Heavy background jobs run in separate processes or containers from user-facing API servers.

### What to Bulkhead

- Separate user-facing API requests from background job processing
- Separate calls to different external services (database, payment provider, email service) into separate connection pools
- Separate slow operations (CSV exports, report generation, bulk imports) from fast operations (health checks, lightweight reads)
- In microservices: separate critical service calls from non-critical ones

---

## Composing the Patterns

These patterns work together. A robust external call uses all of them:

```
1. Timeout — fail fast if no response
2. Retry with backoff — handle transient failures
3. Circuit Breaker — stop calling when dependency is unhealthy
4. Bulkhead — prevent one dependency's failures from starving others
```

The order matters: apply timeout first (inside each attempt), then retry around the timeout, then circuit breaker around the retry, then bulkhead around the whole thing.

---

## Testing Strategy

- **Timeout tests**: Assert that calls fail within the configured timeout. Use a mock server with configurable delay.
- **Retry tests**: Assert correct number of attempts. Assert exponential delay. Assert no retry on permanent errors.
- **Circuit breaker state tests**: Simulate N failures, assert circuit trips to OPEN. Assert fast fail while OPEN. Assert transition to HALF-OPEN after timeout. Assert recovery to CLOSED on success.
- **Fallback tests**: Assert correct fallback response when circuit is OPEN.
- **Bulkhead tests**: Saturate one pool, assert that requests using a separate pool are unaffected.
- **Chaos testing**: Randomly kill dependencies in a staging environment and assert the system degrades gracefully rather than failing completely.

## Common Failure Modes

**No timeout on any external call**: The single most common resilience failure. Default HTTP clients have no timeout. Check every external call in the codebase.

**Retrying non-idempotent operations**: Retrying a `POST /charge` without idempotency keys results in double charges. Either make the operation idempotent (idempotency key on the server) or do not retry writes.

**Circuit breaker threshold set too low**: Trips on normal traffic variance, causing unnecessary outages. Calibrate thresholds against actual error rate baselines.

**No fallback defined**: Circuit breaker OPEN state returns a raw error. Define explicit fallbacks for every circuit-broken call.

**Bulkhead pools set too small**: Legitimate load hits the pool limit and healthy requests are rejected. Size pools based on measured concurrency requirements.

**Retry storm**: All instances retry simultaneously after a brief outage. Solved by exponential backoff with jitter.

## Pairs Well With

- **Microservices** — resilience patterns are mandatory in any service mesh
- **Event-Driven Architecture** — circuit breakers on message broker connections; retry on consumer failures
- **API Gateway / BFF** — the gateway is a natural place to implement circuit breaking for backend services
- **Outbox Pattern** — the relay process needs retry-with-backoff when the message broker is unavailable
