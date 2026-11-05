# Complexity Comments

Use a local complexity note only when the cost or scaling tradeoff is not obvious from the code itself.

## Add A Comment When

- the path processes caller-controlled or unbounded collections
- the code nests iteration or composes multiple loops
- the algorithm is custom or non-obvious
- the implementation intentionally trades readability for performance
- query shape or network fan-out matters more than textbook Big O

## Skip The Comment When

- the code is trivially linear or constant-time
- the operation is a single obvious standard-library call
- the collection is fixed-size and tiny by construction
- the comment would repeat what the code already makes obvious

## Comment Shape

Keep it short and concrete:

```ts
// Complexity: O(n log n) by invoices.length; acceptable because export batches are capped at 500.
// Query shape: 1 batched read, no per-item DB calls.
```

```ts
// Complexity: O(n + m) where n = users and m = existing memberships.
// Uses a Set to avoid O(n·m) repeated lookups.
```

```ts
// Complexity: O(n^2) by rule count; accepted here because rules are validated to <= 20 by spec.
```

## Query-Shape Notes

For data-heavy code, query shape often matters more than raw algorithm labels.

Good notes:

- `Query shape: 2 fixed queries, then in-memory join`
- `Query shape: 1 bulk upsert; no per-record writes`
- `Query shape: 1 read per tenant is intentional; tenant list is capped at 10`

Bad notes:

- `O(n)` with no explanation
- `Fast enough`
- `Optimized`

## Failure Mode To Avoid

Do not turn this into rote annotation. The comment is for future reasoning, not for academic decoration.
