# Operational Depth Patterns

Production-level operational patterns that go deeper than the surface coverage in `distributed-systems-patterns.md`. Use this reference when designing systems that must handle real-world failure modes, concurrency, and abuse.

## Hot Keys / Hot Rows

**Problem:** Uneven access patterns concentrate load on a small subset of keys or rows, causing throttling or failure even when aggregate capacity is sufficient.

**Detection signals:**
- Per-partition metrics showing 10x+ skew vs median
- Throttling errors on specific keys while overall throughput is below limits
- Latency spikes correlated with specific tenants or entities

**Mitigation patterns:**
- Key salting / suffix sharding (append random suffix, scatter reads across partitions)
- Write-behind aggregation (buffer hot-key writes, flush periodically)
- Dedicated hot-key cache layer (separate cache for known hot keys)
- Request coalescing (deduplicate concurrent reads for the same key)

**Design strategy:** If you cannot predict which keys will be hot, design for uniform distribution and add a hot-key detector that triggers automatic mitigation. If you can predict (e.g., celebrity accounts, viral content), pre-shard those keys at write time.

**Anti-pattern:** Sharding by a field with extreme cardinality skew (e.g., country code where 80% of traffic is one country).

## Precomputation

**Problem:** Expensive queries or aggregations computed on every request waste resources and add latency.

**When to precompute:**
- Query result is read 10x+ more than it changes
- Computation cost is > 100ms and result is cacheable
- Freshness tolerance is > 1 second

**Patterns:**
- Materialized views (database-level, auto-refreshed)
- Cache warming on write (update precomputed value on every write to source data)
- Scheduled batch precomputation (cron-based refresh for slowly changing data)
- Lambda architecture (real-time layer for recent data, batch layer for historical)

**Tradeoffs:**
- Precomputation adds write amplification
- Stale reads are possible — define freshness SLA explicitly
- Storage cost increases linearly with precomputed views

**Anti-pattern:** Precomputing everything "just in case" without measuring read/write ratio.

## Batching

**Problem:** Per-item processing wastes connection overhead, increases latency for dependent operations, and underutilizes throughput.

**Patterns:**
- Request coalescing (collect up to 50–200 requests over 10–100ms, process as one batch)
- Write batching (buffer writes, flush at size threshold or time interval)
- Micro-batching (small fixed-interval batches for stream processing)
- Batch APIs (expose batch endpoints that accept arrays)

**Tradeoffs:**

| Factor | Small batches | Large batches |
|--------|--------------|---------------|
| Latency | Lower (less waiting) | Higher (more buffering) |
| Throughput | Lower (more overhead) | Higher (amortized cost) |
| Failure blast radius | Smaller | Larger |
| Memory pressure | Lower | Higher |

**Design rules:**
- Define max batch size (prevent unbounded memory growth)
- Define max wait time (prevent unbounded latency)
- Handle partial batch failures (some items succeed, some fail — report per-item status)
- Batch size should be tunable without code changes

## Async Processing (Depth)

**Problem:** "Use a queue" is insufficient guidance. Async systems have ordering, delivery, and backpressure failure modes.

**Ordering guarantees:**
- FIFO per partition/key: use when ordering matters per entity but not globally
- Global FIFO: expensive, rarely necessary — prefer per-key ordering
- No ordering guarantee: cheapest, use when operations are commutative

**Delivery semantics:**
- At-most-once: fire and forget, acceptable data loss
- At-least-once: retry on failure, consumer must be idempotent
- Exactly-once: requires idempotency + deduplication at consumer (not truly "exactly once" — it's "effectively once")

**Backpressure patterns:**
- Bounded queue size (reject or signal upstream when full)
- Rate-limited consumers (pull-based, consumer controls pace)
- Overflow to dead-letter queue (process failures separately)
- Circuit breaker on producer side (stop enqueueing if downstream is unhealthy)

**Dead-letter queues (DLQ):**
- Route messages that fail 3–5 processing attempts to DLQ
- DLQ must have its own monitoring and alerting
- Define max DLQ retention (don't accumulate poison messages forever)
- Require manual review or automated remediation path for DLQ items

**Anti-pattern:** Unbounded retry without DLQ — one poison message blocks the entire queue.

## Idempotency

**Problem:** Network failures, retries, and at-least-once delivery mean operations may execute multiple times. Without idempotency, duplicates corrupt state.

**Idempotency key patterns:**
- Client-generated UUID per request (stored server-side, checked before processing)
- Natural idempotency key (e.g., `payment_id + amount` — same payment can't be charged twice)
- Content hash (hash of request body — identical requests are deduplicated)

**Implementation:**
1. Extract idempotency key from request
2. Check if key exists in idempotency store
3. If exists: return stored response (do not re-process)
4. If not: process, store result keyed by idempotency key, return response
5. Set TTL on idempotency records (don't store forever)

**Replay protection:** Idempotency keys should expire. A key valid for 24h prevents retries within that window but allows legitimate re-submission after expiry.

**Anti-pattern:** Relying on database unique constraints alone — they prevent duplicates but don't return the original response to the retry caller.

## Deduplication

**Problem:** Duplicate messages, events, or records enter the system through retries, replication lag, or client bugs.

**Patterns:**
- Event-ID deduplication (each event has a unique ID; consumer tracks seen IDs)
- Content-hash deduplication (hash the payload; identical payloads are duplicates)
- Time-window deduplication (deduplicate within a sliding window; allow re-submission after window expires)
- Bloom filter pre-check (probabilistic fast-path; confirm with exact store on positive)

**Storage tradeoffs:**

| Approach | Memory | Accuracy | Latency |
|----------|--------|----------|---------|
| Exact set (Redis/DB) | High | Perfect | Low |
| Bloom filter | Low | False positives possible | Very low |
| Time-windowed set | Bounded | Perfect within window | Low |

**Design rules:**
- Define dedup window explicitly (how old is "too old to be a duplicate"?)
- Dedup store must survive restarts (in-memory only = duplicates on restart)
- Log deduplicated items for audit (don't silently drop)

## Transaction Tradeoffs

**Problem:** Distributed operations span multiple services or databases. Traditional ACID transactions don't scale across boundaries.

**Options:**

| Pattern | Consistency | Complexity | When to use |
|---------|-------------|-----------|-------------|
| Distributed transaction (2PC) | Strong | High | Rarely — only when both participants are databases you control |
| Saga (choreography) | Eventual | Medium | When services are independent and can define compensation |
| Saga (orchestration) | Eventual | Medium-high | When a coordinator must enforce ordering |
| Outbox pattern | Eventual | Low-medium | When you need reliable event publishing from a DB write |
| Compensation | Eventual | Medium | When rollback is possible via reverse operations |

**Saga compensation rules:**
- Every forward step must have a defined compensating action
- Compensation must be idempotent (may execute multiple times on retry)
- Compensation may be partial (undo what can be undone, flag what cannot)
- Define timeout: if a step neither succeeds nor fails within 30s–5min (depending on operation cost), trigger compensation

**Outbox pattern:**
- Write event to outbox table in same DB transaction as business data
- Separate process reads outbox, publishes to message broker, marks as published
- Guarantees at-least-once publishing without distributed transaction

**Anti-pattern:** Assuming "eventual consistency" means "no consistency guarantees needed." Define convergence SLA.

## Concurrency Failure Modes

**Problem:** Concurrent access to shared state produces subtle bugs that pass single-threaded tests.

**Failure modes:**

| Mode | Description | Fix |
|------|-------------|-----|
| Lost update | Two writers read, modify, write — last write wins, first is lost | Optimistic locking (version field) or CAS |
| Dirty read | Reading uncommitted data from another transaction | Proper isolation level (READ COMMITTED+) |
| Non-repeatable read | Same query returns different results within one transaction | REPEATABLE READ isolation |
| Phantom read | New rows appear between two range queries in same transaction | SERIALIZABLE isolation or explicit locking |
| Write skew | Two transactions read overlapping data, make disjoint writes that violate a constraint | SERIALIZABLE or application-level check |
| Clock skew | Distributed nodes disagree on time ordering | Logical clocks, vector clocks, or hybrid logical clocks |
| ABA problem | Value changes A→B→A; CAS sees A and assumes no change | Version counter instead of value comparison |

**Design rules:**
- Default to optimistic locking for low-contention writes
- Use pessimistic locking only for high-contention hot paths where retry cost is high
- Never assume database defaults are sufficient — explicitly set isolation level
- Test concurrent access paths with deliberate race conditions, not just sequential happy paths

## Health Checks

**Problem:** Services report "healthy" while unable to serve real traffic, or unhealthy services continue receiving requests.

**Liveness vs Readiness:**

| Check | Purpose | Failure response |
|-------|---------|-----------------|
| Liveness | "Is the process alive and not deadlocked?" | Restart the process |
| Readiness | "Can this instance serve traffic right now?" | Remove from load balancer, stop sending requests |

**Dependency health:**
- Check critical dependencies in readiness probe (DB, cache, required services)
- Do NOT check non-critical dependencies in readiness probe (optional services, analytics)
- Use shallow checks (connection pool has available connections) not deep checks (run a query) for probes
- Set probe timeout shorter than the check interval (prevent probe backlog)

**Cascading failure detection:**
- If > 50% of instances report unhealthy simultaneously, suspect infrastructure (not app) failure
- Circuit-break the health check itself if the dependency is a known-down shared resource
- Distinguish "dependency slow" from "dependency down" — slow dependencies should trigger readiness failure, not liveness failure

**Anti-pattern:** Health check that always returns 200 ("I'm up!") regardless of ability to serve traffic.

## Graceful Degradation

**Problem:** Total failure is obvious; partial failure that silently corrupts results is dangerous.

**Patterns:**
- Circuit breaker (stop calling failing dependency, serve fallback, periodically retry)
- Load shedding (reject lowest-priority requests when at capacity, serve high-priority)
- Feature flags (disable non-critical features under load)
- Fallback responses (cached/default/partial data instead of error)
- Bulkhead isolation (failure in one subsystem doesn't consume resources from others)

**Circuit breaker states:**

```
CLOSED → (failure threshold exceeded) → OPEN → (timeout expires) → HALF-OPEN → (probe succeeds) → CLOSED
                                                                    → (probe fails) → OPEN
```

**Half-open behavior (critical — often omitted):**
- After the OPEN timeout (typically 10-60s), allow exactly 1 real request through as a probe
- If the probe succeeds within the normal latency budget: transition to CLOSED, resume traffic
- If the probe fails or times out: transition back to OPEN, restart the timeout
- Do NOT send a synthetic health check as the probe — real requests reveal real failures
- Do NOT allow multiple probes simultaneously (thundering herd on a recovering service)
- Track consecutive probe failures: after 3+ failed probes, double the OPEN timeout (adaptive backoff)

**Fallback response freshness (critical — often stale):**
- In OPEN state, serve a fallback — but define freshness requirements explicitly:
  - Cache-based fallback: last-known-good response, max staleness 30-300s depending on domain
  - Default fallback: static safe response (empty list, default config, "temporarily unavailable")
  - Partial fallback: serve what's available from healthy dependencies, omit data from broken ones
- Stale fallback older than `max_staleness` must NOT be served as if fresh — mark degraded in response headers or payload
- Refresh the fallback cache only from successful CLOSED-state responses, never from HALF-OPEN probes
- If no fallback exists and the circuit is OPEN: return explicit 503 with Retry-After, not an empty 200

**Load shedding rules:**
- Define priority tiers before you need them (not during an incident)
- Shed reads before writes (reads can retry; lost writes are permanent)
- Return 503 with Retry-After header, not silent timeouts
- Shed at the edge (load balancer/gateway), not deep in the stack

**Anti-pattern:** Retrying aggressively against a degraded service (retry storm amplifies the failure).

## Authentication / Authorization (Depth)

**Problem:** Surface-level "add auth" guidance misses token lifecycle, service identity, and privilege escalation risks.

**Token lifecycle:**
- Access tokens: short-lived (5-60 minutes), used for API authorization
- Refresh tokens: longer-lived (hours-days), used to obtain new access tokens
- Token rotation: issue new refresh token on every use, invalidate the old one
- Token revocation: maintain a revocation list or use short expiry + no revocation

**RBAC vs ABAC:**

| Model | Best for | Limitation |
|-------|----------|-----------|
| RBAC (Role-Based) | Static permission sets, clear role hierarchy | Doesn't handle context-dependent access (time, location, resource owner) |
| ABAC (Attribute-Based) | Dynamic, context-aware policies | More complex to audit and debug |

**Service-to-service auth:**
- mTLS for transport-level identity
- Service tokens (JWT with service identity claims) for application-level
- Short-lived service credentials rotated automatically
- Never hardcode service credentials — inject from secrets manager

**Zero-trust patterns:**
- Verify identity at every hop, not just at the edge
- Encrypt in transit between all services (even internal)
- Least-privilege: services get only the permissions they need
- Assume the network is hostile

## Secrets Management

**Problem:** Secrets (API keys, DB credentials, encryption keys) leak through code, logs, config files, and error messages.

**Rotation:**
- Define rotation frequency per secret type (API keys: 90 days, DB passwords: 30 days, encryption keys: annually)
- Support dual-active during rotation window (old and new both valid temporarily)
- Automate rotation — manual rotation means it won't happen

**Envelope encryption:**
- Encrypt data with a data encryption key (DEK)
- Encrypt the DEK with a key encryption key (KEK) stored in a key management service
- Rotate DEKs frequently (cheap); rotate KEKs rarely (expensive re-encryption)

**Injection patterns:**
- Environment variables (simple, works everywhere, visible in process listing)
- Mounted secrets volume (Kubernetes secrets, Docker secrets)
- Runtime fetch from secrets manager (most secure, adds latency and dependency)
- Never in source code, config files committed to git, or container images

**Audit:**
- Log every secret access (who, when, which secret, from where)
- Alert on unusual access patterns (new service accessing old secrets, access from unexpected IP)
- Never log secret values — log secret identifiers only

## Rate Limiting (Depth)

**Problem:** Naive rate limiting either blocks legitimate users or fails to stop abuse.

**Algorithm comparison:**

| Algorithm | Behavior | Best for |
|-----------|----------|----------|
| Token bucket | Allows bursts up to bucket size, refills at steady rate | APIs with bursty legitimate traffic |
| Sliding window | Counts requests in a rolling time window | Smooth rate enforcement |
| Leaky bucket | Processes at fixed rate, queues excess | Smoothing bursty input to steady output |
| Fixed window | Counts per calendar interval | Simple, but allows 2x burst at window boundary |

**Distributed rate limiting:**
- Centralized counter (Redis): consistent but adds latency and SPOF
- Local counters with periodic sync: faster but allows brief over-limit bursts
- Sliding window with Redis sorted sets: accurate, moderate cost

**Per-tenant limits:**
- Different tiers get different limits (free: 100/min, paid: 10000/min)
- Separate limits per resource type (reads vs writes, API vs webhook)
- Graceful limit response: 429 with `Retry-After` header and remaining quota info
- Burst allowance: allow short bursts above steady-state limit (token bucket)

**Anti-pattern:** Single global rate limit that punishes all users equally when one abuser hits the limit.

## Abuse Detection

**Problem:** Malicious actors exploit systems in ways that pass individual request validation but reveal patterns in aggregate.

**Anomaly signals:**
- Request velocity spikes (per user, per IP, per API key)
- Geographic impossibility (same account from two continents within minutes)
- Enumeration patterns (sequential IDs, dictionary attacks)
- Resource exhaustion attempts (creating max-allowed entities, uploading max-size files repeatedly)
- Credential stuffing patterns (many failed logins across different accounts from same IP range)

**Progressive enforcement:**
- Level 1: CAPTCHA or additional verification
- Level 2: Temporary rate reduction (slow down, don't block)
- Level 3: Temporary block with appeal path
- Level 4: Permanent block (requires human review)

**Reputation systems:**
- Score accounts/IPs based on historical behavior
- New accounts start with lower trust (progressive trust building)
- Good behavior increases limits/trust over time
- Single bad action doesn't immediately ban — pattern of bad actions does

**Design rules:**
- Separate detection from enforcement (detect in one system, enforce in another)
- Log all enforcement actions for audit and appeal
- False positive budget: target < 1% false positive rate for blocking actions, < 5% for soft friction (CAPTCHA/slowdown)
- Never rely solely on IP-based detection (NAT, VPN, shared IPs)

**Anti-pattern:** Binary allow/deny with no middle ground — forces choosing between blocking legitimate users and allowing all abuse.

---

## References

- `distributed-systems-patterns.md` — surface-level storage, cache, queue, scaling, and reliability patterns (this file adds operational depth on top)
- `requirements-and-capacity.md` — requirements framing and capacity estimates that inform when these patterns are needed
- `architecture-spec-template.md` — document structure for capturing these decisions in formal architecture specs
- `harness-engineering/quality/stage-output-schema.md` — schema enforcement for multi-stage handoffs (relevant when designing async processing or saga outputs)
- `skills/observability-implementation/SKILL.md` — instrumentation patterns for health checks, degradation detection, and abuse monitoring
