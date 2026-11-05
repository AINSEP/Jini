# Querying and Data Shapes

Use this reference when the problem is primarily about SQL query structure, hierarchy traversal, or JSON-heavy access patterns.

## Table Design Guardrails

Apply these defaults before advanced query tuning:

- **Primary keys**: prefer `BIGINT GENERATED ALWAYS AS IDENTITY` unless UUID is required for distributed uniqueness or external opacity.
- **Foreign keys**: PostgreSQL does not auto-index FK columns; add explicit indexes for FK access paths.
- **Type defaults**:
  - use `TIMESTAMPTZ` instead of `TIMESTAMP`
  - use `NUMERIC` for money
  - use `TEXT` by default for strings; add explicit length checks when needed
- **Constraints first**: enforce invariants in schema with `NOT NULL`, `CHECK`, and `UNIQUE` before relying on application validation.
- **Unique-null behavior**: when business rules require nulls to collide, use `UNIQUE ... NULLS NOT DISTINCT` in PG15+.
- **Identifier convention**: use unquoted `snake_case` identifiers.

## CTEs

CTEs give complex queries a readable structure. They are defined with `WITH` and referenced like temporary tables within the query.

```sql
WITH active_users AS (
    SELECT id, email, created_at
    FROM users
    WHERE deleted_at IS NULL
),
recent_orders AS (
    SELECT user_id, COUNT(*) AS order_count
    FROM orders
    WHERE created_at > now() - interval '30 days'
    GROUP BY user_id
)
SELECT u.email, COALESCE(o.order_count, 0) AS orders_last_30_days
FROM active_users u
LEFT JOIN recent_orders o ON o.user_id = u.id
ORDER BY orders_last_30_days DESC;
```

In PostgreSQL 12+, CTEs are not materialized by default. Force materialization with `WITH ... AS MATERIALIZED (...)` when you want the CTE to execute exactly once regardless of how many times it is referenced.

## Recursive CTEs

Recursive CTEs traverse hierarchical or graph-shaped data. They consist of a base case and a recursive term connected with `UNION ALL`.

```sql
WITH RECURSIVE org_tree AS (
    SELECT id, name, parent_id, 0 AS depth
    FROM departments
    WHERE id = $1

    UNION ALL

    SELECT d.id, d.name, d.parent_id, t.depth + 1
    FROM departments d
    INNER JOIN org_tree t ON d.parent_id = t.id
)
SELECT id, name, depth
FROM org_tree
ORDER BY depth, name;
```

Guard against infinite loops with a depth limit or cycle detection when the graph may contain cycles.

## Window Functions

Window functions compute a value for each row based on a set of related rows without collapsing rows the way `GROUP BY` does.

```sql
SELECT
    user_id,
    order_id,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
FROM orders;

SELECT
    product_id,
    total_sold,
    RANK()       OVER (ORDER BY total_sold DESC) AS rank_with_gaps,
    DENSE_RANK() OVER (ORDER BY total_sold DESC) AS rank_no_gaps
FROM product_sales;

SELECT
    date,
    revenue,
    LAG(revenue, 1) OVER (ORDER BY date) AS prev_day_revenue,
    revenue - LAG(revenue, 1) OVER (ORDER BY date) AS day_over_day_change
FROM daily_revenue;

SELECT
    date,
    amount,
    SUM(amount) OVER (ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total,
    AVG(amount) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS rolling_7_day_avg
FROM transactions;
```

Useful frame clauses:

- `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` for running totals
- `ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` for fixed rolling windows
- `RANGE BETWEEN INTERVAL '7 days' PRECEDING AND CURRENT ROW` for range-based windows on time columns

## JSONB

`jsonb` stores JSON as a parsed binary structure, enabling fast key access and indexing. Prefer `jsonb` over `json`.

### Operators

```sql
SELECT data -> 'address' -> 'city' FROM users;
SELECT data ->> 'email' FROM users;
SELECT data #> '{address, city}' FROM users;
SELECT data #>> '{address, city}' FROM users;
SELECT * FROM users WHERE data @> '{"role": "admin"}';
SELECT * FROM users WHERE data ? 'phone_number';

UPDATE users
SET data = jsonb_set(data, '{address, city}', '"Portland"')
WHERE id = $1;

UPDATE users SET data = data || '{"last_login": "2026-02-23"}' WHERE id = $1;
UPDATE users SET data = data - 'temp_token' WHERE id = $1;
```

### Indexing JSONB

```sql
CREATE INDEX idx_users_data_gin ON users USING GIN (data);
CREATE INDEX idx_users_data_path ON users USING GIN (data jsonb_path_ops);
CREATE INDEX idx_users_role ON users ((data ->> 'role'));
```

Use a GIN index when queries use `@>` or `?` on arbitrary keys. Use an expression B-tree index when queries always filter on the same known key with equality or range.
