# SQL Data Modeling Reference: Modeling and Normalization

## ERD Design Principles

An ERD describes what the data is before you decide how it is stored.

- Entities become tables.
- Attributes become columns.
- Relationships become foreign keys or junction tables.
- Cardinality must be explicit: optional vs required is a schema decision, not a vague note.

Relationship patterns:

| Type | Description | Implementation |
|---|---|---|
| One-to-One | Each row in A relates to at most one row in B | FK on either side with UNIQUE constraint |
| One-to-Many | One row in A relates to many rows in B | FK on the many side |
| Many-to-Many | Many rows in A relate to many rows in B | Junction table with two FKs |

## Normalization

Normalize by default because redundancy creates write anomalies and weakens integrity.

### First Normal Form

- each column holds atomic values
- each row is uniquely identifiable
- repeating groups belong in child tables

Example:

```text
Bad:
orders(id, customer_name, item_1_sku, item_1_qty, item_2_sku, item_2_qty)

Better:
orders(id, customer_id, ...)
order_items(order_id, line_number, sku, quantity)
```

### Second Normal Form

- every non-key column depends on the full key
- especially relevant for composite primary keys

Example:

```text
Bad junction:
course_enrollments(student_id, course_id, student_email, enrolled_at)

If the PK is (student_id, course_id), `student_email` depends only on `student_id`.
Move student attributes back to `students`.
```

### Third Normal Form

- non-key columns should not depend on other non-key columns
- avoid transitive dependencies unless redundancy is accepted intentionally

Example:

```text
Bad:
orders(id, customer_id, customer_tier, customer_discount_rate)

If `customer_discount_rate` is derived from `customer_tier`, it should usually live with the customer model
or in a controlled projection, not redundantly on every order row.
```

## When to Denormalize

Accept denormalization only when:

- measured join cost is significant
- a derived value is expensive to recompute
- reporting or projection tables are maintained by a controlled process
- the source of truth remains explicit

Document:

- what was denormalized
- why it was necessary
- how it stays in sync
- what breaks if it drifts

Example:

```text
Acceptable:
invoice_totals.cached_balance_cents maintained by a trigger or rebuild job

Not acceptable:
copying customer_email onto every order row "for convenience" with no update path
```
