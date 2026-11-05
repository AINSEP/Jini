# SQL Data Modeling Reference: PostgreSQL Engine

- Last reviewed: 2026-05-15
- Scope: Design-time PostgreSQL schema and index planning.
- Verify target PostgreSQL version, extension availability, managed-host restrictions, and actual query plans before implementation.

Use this reference when the target engine is PostgreSQL or a PostgreSQL-compatible host and the modeling decision depends on PostgreSQL-specific capabilities.

## Design Defaults

- Default scalar index: B-tree.
- Prefer `jsonb` over `json` for queryable JSON data.
- Prefer generated or expression indexes for stable scalar values extracted from `jsonb`.
- Use GIN for containment, membership, arrays, full-text, and trigram-style search patterns when the operator class supports the query.
- Use GiST or SP-GiST for range, geometry, spatial, nearest-neighbor, and exclusion-constraint use cases when the operator class supports the query.
- Use BRIN for very large tables whose indexed values correlate strongly with physical row order.
- Every index must map to a real query pattern and justify read benefit against write cost.

## PostgreSQL Index Selection Matrix

| Index Type | Best For | Time Model | Space Model | Write Cost | Caveats |
|---|---|---|---|---|---|
| B-tree | Equality, range predicates, ordering, uniqueness on sortable scalar values | Equality `O(log n)`; range `O(log n + k)` | `O(n)` | Moderate | Default choice. Supports equality and ordered comparisons; often preferable to hash even for equality because it also supports range/order. |
| Hash | Equality-only predicates on a single value | Average equality model `O(1)` | `O(n)` | Moderate | Narrower than B-tree. Does not support range/order. WAL-logged and crash-safe from PostgreSQL 10 onward. Use only when equality-only behavior is proven valuable for the target workload. |
| Composite B-tree | Multi-column filters and sort orders | Same as B-tree when predicates match useful leading columns | `O(n)` with wider keys | Moderate to high | Column order matters. Put equality predicates before range/sort columns unless a different order matches the dominant query. |
| Partial | Hot subsets with stable predicates, such as active rows or non-deleted rows | Same access method as underlying index, over fewer entries | Smaller than full index when predicate is selective | Lower than full index for excluded rows | Query predicate must imply the partial-index predicate. Avoid volatile or rarely reused predicates. |
| Covering / `INCLUDE` | Read-heavy queries where index-only scans are realistic | Same lookup as key index; may avoid heap fetches | Larger than key-only index | Higher than key-only index | Included columns do not help filtering or ordering. Useful only when visibility map and query shape make index-only scans likely. |
| Expression | Computed search keys such as `lower(email)` or extracted JSON scalar values | Same as underlying access method when query expression matches | `O(n)` for one computed entry per row | Higher when expression changes | Query must use the same expression shape. Keep expressions deterministic and simple. |
| GIN | `jsonb` containment/existence, arrays, full-text search, trigrams | Depends on matched keys, posting-list size, selectivity, pending-list state, and rechecks | Often high | High, especially on write-heavy tables | Excellent for multi-valued data. Avoid fake `O(...)` precision; operator class determines supported queries. |
| GiST | Ranges, geometric/spatial values, nearest-neighbor search, exclusion constraints | Tree traversal plus possible rechecks; data distribution and opclass matter | Opclass-dependent, usually meaningful `O(n)` storage | Moderate to high | Generalized index framework. Can be lossy and require rechecks. Use when B-tree/GIN do not match the operator family. |
| SP-GiST | Partitionable data distributions such as tries, quadtrees, some geometry/text patterns | Distribution and opclass dependent | Opclass-dependent | Moderate | Best for data that partitions well. Verify the specific operator class and workload. |
| BRIN | Huge naturally ordered tables, especially append-only time-series or monotonically increasing keys | Proportional to surviving block ranges after pruning | Very small; roughly proportional to block ranges | Low | Effective only when column values correlate with physical storage order. Poor correlation can devolve into broad heap scans. |
| PostGIS spatial | Spatial relationship and nearest-neighbor queries | Usually GiST/SP-GiST behavior plus spatial rechecks | Geometry/opclass-dependent | Moderate to high | Verify PostGIS extension support and geometry type. Index choice depends on operator, dimensionality, and data distribution. |
| `pg_trgm` | Fuzzy text search, similarity, `LIKE`/`ILIKE` patterns | GIN or GiST behavior depending opclass and query | Often high for GIN | High for GIN | Requires `pg_trgm`. GIN is common for lookup speed; GiST can support distance-style ranking tradeoffs. |
| pgvector HNSW | Approximate nearest-neighbor vector search with high recall priority | Algorithm/tuning dependent; not a simple table-index Big O | High | High build/update cost | Requires `pgvector`. Tune for recall, latency, memory, and build cost. |
| pgvector IVFFlat | Approximate nearest-neighbor vector search where build speed and smaller index matter | Algorithm/tuning dependent; probe count drives recall/latency | Moderate to high | Moderate | Requires training/build considerations. Tune lists/probes and validate recall against the application target. |

`k` means the number of matched rows returned from a range or ordered scan.

## JSONB Indexing

Use `jsonb` for queryable JSON. Choose indexes by query shape:

```sql
CREATE INDEX idx_profiles_attrs_gin ON profiles USING GIN (attrs);
CREATE INDEX idx_profiles_attrs_path ON profiles USING GIN (attrs jsonb_path_ops);
CREATE INDEX idx_profiles_role ON profiles ((attrs ->> 'role'));
```

- Use default GIN when queries need containment and key-existence operators across varied keys.
- Use `jsonb_path_ops` when containment (`@>`) dominates and the smaller/faster containment-focused index is worth losing broader key-existence support.
- Use expression or generated-column B-tree indexes when queries repeatedly filter or sort on a known scalar path.
- Keep core relational entities in tables. Use `jsonb` for optional or variable attributes.

## Query-Pattern Examples

```text
Query: WHERE organization_id = ? AND created_at >= ? ORDER BY created_at DESC
Likely index: B-tree on (organization_id, created_at DESC)

Query: WHERE deleted_at IS NULL AND email = ?
Likely index: partial B-tree on (email) WHERE deleted_at IS NULL

Query: WHERE attrs @> '{"tier":"pro"}'
Likely index: GIN on attrs, or attrs jsonb_path_ops for containment-heavy workloads

Query: WHERE lower(email) = lower(?)
Likely index: expression B-tree on lower(email)

Query: WHERE created_at >= now() - interval '30 days' on a huge append-only events table
Likely index: BRIN on created_at if physical ordering is strongly correlated
```

## Operational Handoff Notes

Design-time index selection is not proof. Before shipping performance-sensitive queries:

- run `EXPLAIN (ANALYZE, BUFFERS)` against representative data
- check actual versus estimated rows
- verify that the expected index is used
- check whether heap fetches, rechecks, or sorts dominate
- revisit indexes after real data distribution is known

## Official Docs Checked

- PostgreSQL current docs: index types, multicolumn, expression, partial, covering, and operator-class behavior
- PostgreSQL current docs: GIN, GiST, text-search index types, and BRIN behavior
