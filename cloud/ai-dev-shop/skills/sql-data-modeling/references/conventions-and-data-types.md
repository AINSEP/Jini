# SQL Data Modeling Reference: Conventions and Data Types

## Naming Conventions

| Object | Convention | Example |
|---|---|---|
| Tables | plural snake_case | `users`, `invoice_items` |
| Columns | singular snake_case | `first_name`, `created_at` |
| Primary key | `id` | `id uuid PRIMARY KEY` |
| Foreign key | `<entity>_id` | `user_id`, `organization_id` |
| Boolean columns | `is_` or `has_` prefix | `is_active`, `has_verified_email` |
| Timestamp columns | `_at` suffix | `created_at`, `updated_at`, `deleted_at` |
| Indexes | `idx_<table>_<columns>` | `idx_orders_user_id` |
| Unique constraints | `uq_<table>_<columns>` | `uq_users_email` |
| Check constraints | `chk_<table>_<description>` | `chk_orders_amount_positive` |
| FK constraints | `fk_<table>_<referenced_table>` | `fk_orders_users` |

## Data Type Selection

Choose the most precise domain-correct type.

| Domain | Recommended Type | Notes |
|---|---|---|
| External PKs | `uuid` | Use a default generator |
| Internal PKs | `bigint GENERATED ALWAYS AS IDENTITY` | Compact and sequential |
| Short or long text | `text` | Add CHECK only when length is a business rule |
| Fixed-length codes | `char(n)` | Only for truly fixed-length values |
| Money | `numeric(19, 4)` | Never `float` or `real` |
| Counts | `integer` or `bigint` | Use `bigint` when growth is plausible |
| Decimal ratios | `numeric(p, s)` | Make precision explicit |
| Boolean flags | `boolean` | Avoid `0/1` or `Y/N` encodings |
| Datetimes | `timestamptz` | Prefer timezone-aware storage |
| Dates only | `date` | When time is irrelevant |
| Durations | `interval` | Not ad hoc integer seconds unless justified |
| Enumerations | `text` with CHECK | Easier to evolve than native enum types |
| Semi-structured data | `jsonb` | Prefer over `json` for most app cases |
| IP addresses | `inet` | Validates format and supports subnet queries |

Avoid storing UUIDs or structured domain values as plain text when a native type exists.
