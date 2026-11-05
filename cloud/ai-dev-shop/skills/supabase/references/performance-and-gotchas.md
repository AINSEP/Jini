# Supabase Reference: Performance and Gotchas

## Performance Checklist

- index foreign keys and high-frequency filter columns
- use composite indexes that match real predicate order
- use partial indexes for hot subsets
- use covering indexes when index-only scans are realistic
- prefer keyset pagination over deep `OFFSET`
- index columns used inside policy predicates such as `user_id` and `tenant_id`
- run `EXPLAIN (ANALYZE, BUFFERS)` on critical queries
- use connection poolers appropriately and avoid unnecessary client churn
- use GIN indexes for containment-heavy JSONB workloads

## Common Gotchas

**RLS blocking silently**: Missing or mismatched `SELECT` policies often return empty arrays, not errors.

Quick debug loop:

1. verify the role and JWT claims the request is actually using
2. verify the table has a matching `SELECT` policy
3. test the predicate in-role inside a transaction
4. inspect policy predicate columns for missing indexes on large tables

**Anon vs service role keys**: The anon key respects RLS and is browser-safe. The service role key bypasses RLS and must stay server-only.

**Realtime filtering surprises**: Realtime only emits rows visible through `SELECT` policy. Permission changes can stop future events without an explicit removal event.

**`SECURITY DEFINER` overreach**: Browser `.rpc()` calls to privileged functions can bypass RLS unless the function explicitly enforces authorization.

**`updated_at` does not auto-update**: Add your own trigger pattern where needed.

**Storage policy confusion**: Bucket visibility is not the whole access model. `storage.objects` policies still govern writes and other operations.

**Multi-tenant drift**: If tenant scoping exists only in frontend filters and not in policy predicates, data isolation is broken even if the UI "looks correct".

**Edge function cold starts**: Expect startup latency; prefer SQL/RPC for latency-sensitive database-only paths.

**PostgREST schema cache lag**: New schema objects may not appear immediately in the auto-generated API.
