# SQL Data Modeling Reference: MariaDB Engine

- Last reviewed: 2026-05-15
- Scope: Design-time MariaDB schema and index planning.
- Verify target MariaDB version, storage engine, managed-host restrictions, and actual query plans before implementation.

Use this reference when the target engine is MariaDB and the modeling decision depends on MariaDB-specific capabilities. Do not assume MariaDB behaves exactly like MySQL.

## Design Defaults

- Confirm storage engine before relying on index behavior. InnoDB is common, but MariaDB deployments may use other engines.
- Use ordinary B-tree-style indexes for most scalar equality, range, join, and ordering patterns.
- Use composite indexes according to leftmost-prefix behavior.
- Use generated columns for repeatable computed values and JSON-path-like access patterns when version/storage-engine support allows indexing them.
- Use FULLTEXT for text search only when storage engine, table shape, and language/tokenization behavior fit.
- Use SPATIAL indexes for geometry workloads when the target storage engine supports the needed spatial index behavior.
- Treat MariaDB JSON behavior as distinct from both PostgreSQL `jsonb` and MySQL binary JSON.

## MariaDB Index Planning Matrix

| Index Type | Best For | Time Model | Space Model | Write Cost | Caveats |
|---|---|---|---|---|---|
| B-tree / ordinary index | Equality, range predicates, joins, and ordering on scalar values | Equality/range tree access; range behaves like seek plus matched rows | `O(n)` | Moderate | Default practical choice for most OLTP modeling. |
| Composite B-tree | Multi-column predicates and sort orders | Same as B-tree when leftmost-prefix behavior matches | `O(n)` with wider keys | Moderate to high | Column order matters. Do not expect suffix-only predicates to use the composite index effectively. |
| Covering index | Read-heavy queries where all needed columns are available from the index | Same lookup as key index; may avoid table reads | Larger than key-only index | Higher than key-only index | Achieved by adding selected columns into the index key. Balance against key width. |
| Prefix index | Long text/blob-like columns where leading characters are selective enough | Same as B-tree over prefix | Smaller than full-width key | Moderate | Prefix length affects selectivity and uniqueness semantics. |
| Generated-column index | Stable computed values, JSON extraction, normalized text keys | Same as indexed column | Generated/index storage varies by virtual vs persistent choice | Moderate to high | Version, storage-engine, and determinism rules matter. MariaDB generated-column behavior differs from MySQL. |
| FULLTEXT | Full-text search over supported text columns | Engine-specific full-text model | Additional full-text structure | Higher than ordinary B-tree | Verify storage engine and limitations. Partitioning and tokenization details can matter. |
| SPATIAL | Geometry predicates and spatial search | R-tree behavior for spatial indexes where supported | Geometry-dependent | Moderate to high | MariaDB docs describe `SPATIAL INDEX` as R-tree for MyISAM, Aria, and InnoDB. Spatial columns must satisfy engine-specific constraints. |
| HASH | Storage-engine-specific equality use cases | Average equality model `O(1)` in hash-backed engines | `O(n)` | Moderate | Hash indexes do not support leftmost-prefix behavior, range scans, or ordering. Verify storage engine support. |

## JSON And Generated Columns

MariaDB JSON support is not PostgreSQL `jsonb` and should not be modeled as if GIN-style JSON containment indexes are available.

- Verify whether the target MariaDB version stores JSON as an alias/text representation or supports the specific JSON functions needed.
- For frequently queried JSON paths, prefer generated columns plus indexes when version and storage-engine rules support it.
- Confirm deterministic expression rules before indexing generated columns.
- Keep high-value relationships and constraints in relational columns, not JSON.

Example:

```sql
ALTER TABLE products
  ADD COLUMN color varchar(32)
    GENERATED ALWAYS AS (json_unquote(json_extract(attributes, '$.color'))) PERSISTENT,
  ADD INDEX idx_products_color (color);
```

## Common MariaDB Index Traps

- Assuming MySQL 8 behavior applies without checking MariaDB version.
- Assuming PostgreSQL GIN/JSONB behavior exists.
- Ignoring storage-engine differences.
- Using ordinary B-tree indexes for leading-wildcard search instead of FULLTEXT or another search strategy.
- Over-indexing write-heavy tables.
- Depending on generated-column optimizer behavior without checking the target version.

## Official Docs Checked

- MariaDB Server docs: indexes guide, storage-engine index types, generated columns, JSON data type, FULLTEXT indexes, and SPATIAL indexes
