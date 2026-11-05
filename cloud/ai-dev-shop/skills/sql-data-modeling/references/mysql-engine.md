# SQL Data Modeling Reference: MySQL Engine

- Last reviewed: 2026-05-15
- Scope: Design-time MySQL schema and index planning.
- Verify target MySQL version, storage engine, managed-host restrictions, and actual query plans before implementation.

Use this reference when the target engine is MySQL and the modeling decision depends on MySQL-specific capabilities.

## Design Defaults

- Assume InnoDB unless the project states another storage engine.
- Default primary and secondary indexes are B-tree-style indexes for ordinary InnoDB tables.
- Use composite indexes according to the leftmost-prefix rule.
- Use generated columns or functional indexes for repeatable computed predicates and JSON path extraction.
- Use FULLTEXT for full-text search on supported text columns and storage engines.
- Use SPATIAL indexes for geometry workloads when the target engine/version supports the required spatial operations.
- MySQL does not provide PostgreSQL-style GIN indexes for arbitrary JSON containment.

## MySQL Index Planning Matrix

| Index Type | Best For | Time Model | Space Model | Write Cost | Caveats |
|---|---|---|---|---|---|
| B-tree / ordinary InnoDB index | Equality, range predicates, joins, and ordering on scalar values | Equality/range tree access; range behaves like seek plus matched rows | `O(n)` | Moderate | Default practical choice. Query must match usable leading columns and sort direction constraints. |
| Composite B-tree | Multi-column filters and sort orders | Same as B-tree when leftmost-prefix rules match | `O(n)` with wider keys | Moderate to high | Column order matters. `(a, b)` can help `a` and `a,b`; it does not generally help a predicate on `b` alone. |
| Covering index | Read-heavy queries where selected columns are all in the index | Same lookup as key index; avoids table lookups | Larger than key-only index | Higher than key-only index | MySQL does not use PostgreSQL `INCLUDE` syntax; covering behavior comes from putting needed columns in the index. |
| Prefix index | Long `CHAR`, `VARCHAR`, `TEXT`, or `BLOB` columns where only a leading prefix is useful | Same as B-tree over the stored prefix | Smaller than full-width key | Moderate | Can reduce selectivity and cannot distinguish values that share the indexed prefix. Required for some large text/blob indexing cases. |
| Functional index | Predicates on deterministic expressions | Same as underlying B-tree when expression matches | `O(n)` | Higher when expression changes | Available by version. Verify expression support and restrictions. Useful for normalized search keys. |
| Generated-column index | JSON path extraction or computed values that need stable indexing | Same as indexed column | Stored generated columns take table space; virtual generated columns still add index space | Moderate to high | Good JSON workaround. Keep expressions deterministic and version-compatible. |
| FULLTEXT | Natural-language text search on supported text columns | Engine-specific full-text model | Additional inverted/full-text structure | Higher than ordinary B-tree | Not a substitute for arbitrary substring search semantics. Tokenization, stopwords, minimum token length, and language needs matter. |
| SPATIAL | Geometry predicates and spatial search | Spatial index model, commonly R-tree for spatial indexes | Geometry-dependent | Moderate to high | Verify storage engine, SRID, geometry type, and exact spatial predicates. |
| HASH | MEMORY/NDB or storage-engine-specific equality use cases | Average equality model `O(1)` in hash-backed engines | `O(n)` | Moderate | Not a general InnoDB design default. Does not support range/order and storage-engine behavior differs. |

## JSON Indexing

MySQL supports JSON columns, but model JSON indexing differently than PostgreSQL:

- Use generated columns or functional indexes for stable JSON paths that appear in predicates or sort keys.
- Use multi-valued indexes only when the target MySQL version and query shape support them.
- Avoid storing core relational relationships inside JSON if they need joins, constraints, or frequent filtering.

Example:

```sql
ALTER TABLE products
  ADD COLUMN color varchar(32)
  GENERATED ALWAYS AS (json_unquote(json_extract(attributes, '$.color'))) STORED,
  ADD INDEX idx_products_color (color);
```

## Common MySQL Index Traps

- Assuming PostgreSQL GIN/JSONB behavior exists in MySQL.
- Ignoring the leftmost-prefix rule for composite indexes.
- Indexing low-cardinality columns without selectivity or sort/order justification.
- Expecting a leading-wildcard `LIKE '%term%'` predicate to use an ordinary B-tree index effectively.
- Forgetting collation and case-sensitivity behavior when designing text uniqueness or search.
- Treating FULLTEXT behavior as portable across engines or equivalent to application search.
- Adding too many indexes on write-heavy tables.

## Official Docs Checked

- MySQL 8.4 Reference Manual: `CREATE INDEX`, optimization and indexes, B-tree/hash comparison, generated-column indexes, JSON, FULLTEXT, and SPATIAL indexes
