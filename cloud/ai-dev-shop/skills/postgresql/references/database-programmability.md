# Database Programmability

Use this reference when the database is more than storage: triggers, PL/pgSQL functions, extensions, or built-in search features.

## Triggers and Trigger Functions

Triggers execute a function before or after a row-level or statement-level event such as `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE`.

```sql
CREATE OR REPLACE FUNCTION notify_order_created()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('order_created', row_to_json(NEW)::text);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_created
AFTER INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION notify_order_created();
```

- Use `BEFORE` to modify `NEW` before the row is written.
- Use `AFTER` for side effects that depend on the committed row state.
- `FOR EACH ROW` fires once per affected row.
- `FOR EACH STATEMENT` fires once per SQL statement.

Common trigger use cases:

- auto-set `updated_at`
- maintain denormalized counters
- write audit logs
- emit `pg_notify` events
- enforce cross-table rules that `CHECK` constraints cannot express

## Stored Functions and Procedures

PL/pgSQL is the standard PostgreSQL procedural language.

```sql
CREATE OR REPLACE FUNCTION get_user_order_total(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_total numeric;
BEGIN
    SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM orders
    WHERE user_id = p_user_id
      AND status = 'completed';

    RETURN v_total;
END;
$$;

CREATE OR REPLACE PROCEDURE archive_old_orders(p_cutoff_date date)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO orders_archive SELECT * FROM orders WHERE created_at < p_cutoff_date;
    DELETE FROM orders WHERE created_at < p_cutoff_date;
    COMMIT;
END;
$$;
```

Volatility categories:

- `VOLATILE`: default, result can change between calls
- `STABLE`: result is constant within a transaction for the same inputs
- `IMMUTABLE`: result is constant for the same inputs across all transactions

Security context:

- `SECURITY INVOKER`: runs with caller permissions
- `SECURITY DEFINER`: runs with function-owner permissions

## Extensions

Enable extensions with `CREATE EXTENSION IF NOT EXISTS <name>`.

| Extension | Purpose | Key Functions/Types |
|---|---|---|
| `uuid-ossp` | UUID generation | `uuid_generate_v4()` |
| `pgcrypto` | Cryptographic functions | `gen_random_uuid()`, `crypt()`, `digest()` |
| `pg_trgm` | Trigram fuzzy matching | `similarity()`, `%` operator |
| `unaccent` | Accent-insensitive search | `unaccent()` |
| `postgis` | Geographic and geometric data | `geometry`, `geography` |
| `hstore` | Key-value pairs in a column | Prefer `jsonb` for new work |
| `pg_stat_statements` | Query execution stats | `pg_stat_statements` view |
| `btree_gin` | GIN indexes for B-tree types | Multi-column GIN support |
| `pg_partman` | Automated partition management | Time/range partition automation |

Supabase enables `uuid-ossp`, `pgcrypto`, `pg_trgm`, and `unaccent` by default. Others must be enabled explicitly if the host supports them.

## Full-Text Search

PostgreSQL full-text search uses `tsvector` for processed documents and `tsquery` for search queries.

```sql
ALTER TABLE articles ADD COLUMN search_vector tsvector;

UPDATE articles
SET search_vector =
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(body, '')), 'B');

CREATE INDEX idx_articles_search ON articles USING GIN (search_vector);

CREATE OR REPLACE FUNCTION update_article_search_vector()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.body, '')), 'B');
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_article_search_vector
BEFORE INSERT OR UPDATE ON articles
FOR EACH ROW EXECUTE FUNCTION update_article_search_vector();

SELECT title, ts_rank(search_vector, query) AS rank
FROM articles, to_tsquery('english', 'database & performance') query
WHERE search_vector @@ query
ORDER BY rank DESC;
```

Use weight classes `A` through `D` to boost more important fields.

When users may misspell search terms, combine or replace full-text search with `pg_trgm`:

```sql
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);

SELECT name, similarity(name, 'headphons') AS sim
FROM products
WHERE name % 'headphons'
ORDER BY sim DESC;
```
