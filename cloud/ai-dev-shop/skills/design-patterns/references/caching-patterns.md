# Caching Patterns

## What It Is

Caching patterns define where and how data is stored temporarily to reduce latency, database load, or expensive computation. The choice of pattern determines consistency guarantees, failure behavior, and write complexity.

The key decision: caching is a consistency tradeoff. Every cache introduces the possibility of stale reads. The right pattern depends on how stale is acceptable, who owns the cache population, and what happens on a cache miss.

## When to Use

- Read-heavy workloads where the same data is fetched repeatedly (user profiles, product catalogs, configuration)
- Expensive operations that produce stable results (complex queries, external API responses, computed aggregates)
- Reducing database connection pressure under high concurrency
- Edge/CDN caching for static or semi-static content served globally

## When NOT to Use

- Data that changes faster than it can be cached — cache hit rate will be near zero; you add latency without benefit
- Strong consistency required on every read — financial balances, inventory counts where showing stale data causes real problems; skip the cache or use very short TTLs with explicit invalidation
- Early-stage product where "database is too slow" hasn't been measured yet — profile first; premature caching adds complexity without confirmed benefit
- Distributed cache before you've hit the scale that justifies it — a local in-process cache or read replica often solves the problem with far less complexity

## Decision Signals

| Pattern | Consistency | Write Complexity | Cache Population | Use When |
|---------|-------------|------------------|-----------------|----------|
| Cache-Aside | Eventual (TTL) | Low | Application on miss | General-purpose read caching |
| Write-Through | Strong on write | Medium | Application on write | Write-heavy with cache-warm requirement |
| Write-Behind | Eventual | Medium (async) | Application on write | High write throughput, some loss OK |
| Read-Through | Eventual (TTL) | Low | Cache on miss | Transparent caching, same as aside but cache-managed |

## TypeScript Implementation

```typescript
// ── Cache-Aside (Lazy Loading) ────────────────────────────────────────────────
// Most common pattern. Application checks cache first; on miss, loads from DB,
// populates cache, returns result. Cache only contains data that was actually read.
//
//   READ:  cache hit  → return cached value
//          cache miss → load from DB → write to cache → return value
//   WRITE: write to DB → invalidate cache entry (not update — avoids race conditions)

export class UserService {
  constructor(
    private readonly db: UserRepository,
    private readonly cache: CacheClient
  ) {}

  async getUser(userId: string): Promise<User | null> {
    const cacheKey = `user:${userId}`

    // 1. Check cache
    const cached = await this.cache.get<User>(cacheKey)
    if (cached) return cached

    // 2. Cache miss — load from DB
    const user = await this.db.findById(userId)
    if (!user) return null

    // 3. Populate cache with TTL
    await this.cache.set(cacheKey, user, { ttlSeconds: 300 })
    return user
  }

  async updateUser(userId: string, updates: Partial<User>): Promise<void> {
    // Write to DB first — source of truth
    await this.db.update(userId, updates)

    // Invalidate cache — don't update, invalidate. Avoids stale write races.
    // Next read will repopulate from DB.
    await this.cache.delete(`user:${userId}`)
  }
}

// ── Write-Through ─────────────────────────────────────────────────────────────
// Write to DB and cache atomically (or as close as possible). Cache is always warm
// after a write. Reads never miss on recently-written data.
//
//   WRITE: write to DB → write to cache → return
//   READ:  cache hit  → return (always fresh after write)
//          cache miss → load from DB → write to cache → return

async function writeThrough(
  userId: string,
  user: User,
  db: UserRepository,
  cache: CacheClient
): Promise<void> {
  // Write to DB — if this fails, we stop (don't want cache ahead of DB)
  await db.save(user)

  // Write to cache — if this fails, cache is stale until TTL expires
  // Accept this: DB is source of truth; cache failure is non-fatal
  await cache.set(`user:${userId}`, user, { ttlSeconds: 300 }).catch(err => {
    logger.warn('Cache write failed after DB write', { userId, err })
  })
}

// ── Cache Invalidation Strategies ────────────────────────────────────────────

// Strategy 1: TTL-based — simplest, accepts eventual consistency window
const TTL_SECONDS = 300  // stale for up to 5 minutes after a write

// Strategy 2: Event-based invalidation — invalidate on domain events
// More precise than TTL; requires event pipeline
async function onUserUpdatedEvent(event: UserUpdated, cache: CacheClient): Promise<void> {
  await cache.delete(`user:${event.userId}`)
  // Also invalidate any derived cache keys
  await cache.delete(`user-profile:${event.userId}`)
}

// Strategy 3: Versioned cache keys — new key on each write; old key expires via TTL
// Avoids invalidation races at the cost of serving stale until TTL expires
function getUserCacheKey(userId: string, version: number): string {
  return `user:${userId}:v${version}`
}

// ── Preventing Common Cache Bugs ──────────────────────────────────────────────

// Thundering herd: many concurrent misses all hit the DB simultaneously
// Fix: acquire a short lock before DB fetch; others wait or use stale value
async function getUserWithSingleFlight(userId: string): Promise<User | null> {
  const cacheKey = `user:${userId}`
  const lockKey = `user:${userId}:loading`

  const cached = await cache.get<User>(cacheKey)
  if (cached) return cached

  // Try to acquire a 2-second lock
  const acquired = await cache.setNX(lockKey, '1', { ttlSeconds: 2 })
  if (!acquired) {
    // Another request is loading — wait briefly and retry from cache
    await sleep(50)
    return cache.get<User>(cacheKey)
  }

  try {
    const user = await db.findById(userId)
    if (user) await cache.set(cacheKey, user, { ttlSeconds: 300 })
    return user
  } finally {
    await cache.delete(lockKey)
  }
}
```

## Testing Strategy

- **Unit tests with mock cache**: inject a mock `CacheClient`; test that cache-aside hits return cached value, misses load from DB and populate cache, writes invalidate the cache key
- **Integration tests with real cache (Redis/Memcached)**: test TTL expiry behavior, concurrent access, connection failure fallback
- **Cache stampede tests**: simulate many concurrent cache misses; verify DB is called once, not N times
- **Stale data tests**: write a value, update DB directly, read from service; assert cached (stale) value is returned until TTL expires or invalidation fires

## Common Failure Modes

**Cache stampede (thundering herd)**: Cache for a popular key expires. 500 concurrent requests all miss, all hit the DB simultaneously, all try to repopulate the cache. DB falls over. Fix: lock-based single-flight (one request loads, others wait), probabilistic early expiry (refresh cache before TTL expires), or short jitter on TTL values.

**Stale cache after failed invalidation**: DB write succeeds, cache invalidation fails silently. Cache serves stale data until TTL. Fix: treat cache invalidation failures as warnings, not errors — log them and rely on TTL as the backstop. Don't fail the write because the cache delete failed.

**Cache poisoning on write failure**: Write-through writes to cache first, then DB fails. Cache now has data the DB doesn't. Fix: always write DB first. Cache is populated after DB write succeeds. Cache failure after a successful DB write is acceptable (non-fatal).

**Caching mutable aggregates by reference**: Cache stores a reference to the same object the application continues mutating. Later callers get a mutated object from cache. Fix: serialize to JSON before caching (`JSON.stringify`/`JSON.parse` or explicit clone). Never cache mutable objects by reference.

**Missing cache key namespace collision**: Two services cache `user:123` with different schemas. One overwrites the other. Fix: namespace all cache keys by service and version (`payments:user:123:v1`, `auth:user:123:v1`).

## Pairs Well With

- **Repository Pattern** — wrap the repository with a caching decorator; the cache layer is transparent to callers
- **CQRS** — cache the read model projections; invalidate or rebuild on write-side events
- **Event-Driven Architecture** — use domain events to trigger precise cache invalidation instead of relying on TTL alone
- **Hexagonal Architecture** — `CacheClient` is a port; Redis and in-memory implementations are adapters; swap for tests
