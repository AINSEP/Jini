# Performance and Operations

Use this reference when diagnosing slow queries, planning for very large tables, or selecting transaction behavior.

## Partitioning

Partitioning divides a large table into smaller physical partitions while keeping a single logical table interface.

```sql
CREATE TABLE events (
    id          uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL,
    event_type  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2026_q1 PARTITION OF events
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');

CREATE TABLE events_2026_q2 PARTITION OF events
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
```

Other partition types:

- `LIST` for discrete categories
- `HASH` for even distribution by key

When to partition:

- tables above roughly 50 to 100 million rows
- queries consistently filter on the partition key
- the partition key aligns with operational lifecycle, such as time-based retention

Do not partition small tables. The operational overhead is real.

Partition pruning only works when the `WHERE` clause filters on the partition key with a constant or parameter.

## EXPLAIN ANALYZE

`EXPLAIN ANALYZE` executes the query and shows the actual execution plan with row counts and timings.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT u.email, COUNT(o.id) AS order_count
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2025-01-01'
GROUP BY u.email
ORDER BY order_count DESC;
```

Key nodes to identify:

| Node | Description | Performance Signal |
|---|---|---|
| `Seq Scan` | Full table scan | Fine on small tables, suspicious on large ones |
| `Index Scan` | Uses an index and fetches heap rows | Good, but high heap fetches may suggest a covering index |
| `Index Only Scan` | All needed columns come from the index | Best for read-heavy queries |
| `Bitmap Heap Scan` | Batch-fetches heap rows from index matches | Efficient for moderate selectivity |
| `Hash Join` | Hashes one side and probes with the other | Good for large unsorted inputs |
| `Nested Loop` | Repeats inner lookup for each outer row | Good when outer is small and inner is indexed |
| `Sort` | In-memory or disk sort | Disk sorts indicate avoidable cost |

Red flags:

- estimated rows far from actual rows
- `Seq Scan` on a large table inside a loop
- `Sort Method: external merge Disk`
- very large `Rows Removed by Filter`

Useful follow-up:

```sql
ANALYZE orders;
SET work_mem = '256MB';
```

## Performance Patterns

- **Connection pooling**: use PgBouncer or the managed-host pooler for high-concurrency apps.
- **Batch inserts**: prefer one multi-row insert over loops.
- **Partial indexes**: use them when queries almost always filter on a stable predicate.
- **COPY**: use it for bulk loads instead of row-by-row inserts.

## Performance Anti-Patterns

- `SELECT *` in production queries
- `OFFSET` pagination on large tables
- `NOT IN` with nullable subqueries
- functions on indexed columns in `WHERE`
- implicit type coercions in joins

Examples:

```sql
SELECT * FROM orders ORDER BY created_at DESC OFFSET 10000 LIMIT 20;

SELECT * FROM orders
WHERE created_at < $last_seen_created_at
   OR (created_at = $last_seen_created_at AND id < $last_seen_id)
ORDER BY created_at DESC, id DESC
LIMIT 20;

SELECT * FROM orders WHERE user_id NOT IN (SELECT id FROM banned_users);

SELECT * FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM banned_users b WHERE b.id = o.user_id);
```

## Transaction Isolation Levels

PostgreSQL defaults to `READ COMMITTED`.

| Level | Dirty Reads | Non-Repeatable Reads | Phantom Reads | Use Case |
|---|---|---|---|---|
| `READ COMMITTED` | No | Possible | Possible | Default OLTP behavior |
| `REPEATABLE READ` | No | No | No in PostgreSQL | Consistent snapshots for calculations or reports |
| `SERIALIZABLE` | No | No | No | Strongest isolation for complex invariants |

PostgreSQL accepts `READ UNCOMMITTED` as a syntax alias for `READ COMMITTED`.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
COMMIT;
```

`SERIALIZABLE` transactions may fail with serialization errors. Applications must be prepared to retry them.

For application-level coordination, prefer advisory locks over table-level locks:

```sql
SELECT pg_advisory_lock(12345);
SELECT pg_advisory_xact_lock(12345);
SELECT pg_try_advisory_lock(12345);
```
