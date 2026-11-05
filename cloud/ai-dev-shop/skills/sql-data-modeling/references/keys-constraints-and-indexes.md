# SQL Data Modeling Reference: Keys, Constraints, and Indexes

## Primary and Foreign Keys

Prefer stable surrogate primary keys.

```sql
id uuid PRIMARY KEY DEFAULT gen_random_uuid()

id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
```

Never use mutable natural keys such as email or username as the primary key.

Composite primary keys are valid when the relationship itself is the identity.

Use a composite PK when:

- the row is a pure association table
- no independent lifecycle exists outside the parent pair
- the natural uniqueness is exactly the pair or tuple

Prefer a surrogate PK plus UNIQUE constraint when:

- the row may be referenced independently by other tables
- the association has its own workflow or long-lived identity
- soft delete, audit trails, or external references need a stable single-column key

Define foreign keys explicitly:

```sql
user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT
```

Delete-rule guidance:

| Rule | Use When |
|---|---|
| `ON DELETE CASCADE` | Child cannot exist without parent |
| `ON DELETE RESTRICT` | Parent deletion must be blocked until cleanup is explicit |
| `ON DELETE SET NULL` | Relationship is optional after parent deletion |
| `ON DELETE SET DEFAULT` | Reassignment to a default owner/entity is valid |

FK design rules:

- FK nullability should match the actual domain optionality
- if the relationship is required, use `NOT NULL`
- if child rows are meaningless without the parent, prefer `CASCADE`
- if deletion should be deliberate and reviewed, prefer `RESTRICT`

## Constraints

Push invariants into the schema.

```sql
email text NOT NULL UNIQUE
amount numeric NOT NULL CHECK (amount > 0)
status text NOT NULL CHECK (status IN ('draft', 'published', 'archived'))
UNIQUE (user_id, organization_id)
CHECK (end_date IS NULL OR end_date > start_date)
```

Prefer schema constraints over application-only validation for invariants that must always hold.

## Junction Tables

Many-to-many relationships require a junction table.

```sql
CREATE TABLE organization_members (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX idx_org_members_user ON organization_members (user_id);
```

Name junction tables after the relationship, not as an arbitrary concatenation of table names.

If the junction carries business attributes, treat it as a real domain object even if it still uses a composite PK.

## Index Strategy

Index for actual query patterns.

When to index:

- high-selectivity filters
- join keys
- large-table ordering
- range predicates

When not to index:

- low-cardinality columns by habit
- columns never used for filtering, joining, or ordering
- heavy-write paths where the read benefit is not justified

Index examples:

```sql
CREATE INDEX idx_events_user_created ON events (user_id, created_at DESC);

CREATE INDEX idx_orders_user_created_status
ON orders (user_id, created_at DESC) INCLUDE (status);

CREATE INDEX idx_users_email_active
ON users (email) WHERE deleted_at IS NULL;
```

Remember:

- composite index column order matters
- covering indexes help index-only scans
- partial indexes are often better than full indexes for hot subsets
- engine-specific index types and caveats are not portable; load `references/postgresql-engine.md`, `references/mysql-engine.md`, or `references/mariadb-engine.md` when the target engine is known

Decision examples:

```text
Query pattern: WHERE organization_id = ? AND created_at >= ? ORDER BY created_at DESC
Likely index: (organization_id, created_at DESC)

Query pattern: WHERE deleted_at IS NULL AND email = ?
Likely index: partial index on (email) WHERE deleted_at IS NULL
```
