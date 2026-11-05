# SQL Data Modeling Reference: Migrations and Lifecycle

## Migration Planning

Classify the change before writing SQL.

| Class | Examples | Risk |
|---|---|---|
| Additive | add table, add nullable column, add compatible index | low |
| Restrictive | add NOT NULL, add FK to existing data | medium |
| Destructive | drop or rename schema objects | high |
| Data-Transforming | change type, split or merge columns | high |

Prefer additive-first rollout:

1. add new structure
2. deploy compatible application behavior
3. backfill or dual-write if needed
4. remove old structure later

For destructive or transforming changes, define rollback thinking before approval.

## Lock Awareness

On large live tables:

- prefer `CREATE INDEX CONCURRENTLY` where supported
- add nullable columns first
- backfill before enforcing NOT NULL
- validate before tightening constraints

## Soft Delete vs Hard Delete

Soft delete adds lifecycle complexity and storage growth in exchange for recovery and audit value.

```sql
CREATE INDEX idx_orders_user_active ON orders (user_id) WHERE deleted_at IS NULL;
```

Use soft delete when recovery, auditability, or relationship safety matters.

Use hard delete when true erasure or simplicity matters.

## Timestamp Conventions

Common lifecycle columns:

```sql
created_at timestamptz NOT NULL DEFAULT now()
updated_at timestamptz NOT NULL DEFAULT now()
deleted_at timestamptz
```

Use `timestamptz`, not timezone-less timestamps.

If `updated_at` exists, maintain it reliably; append-only tables are exempt from the `updated_at` convention (see `../SKILL.md`, Implementation Defaults):

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```
