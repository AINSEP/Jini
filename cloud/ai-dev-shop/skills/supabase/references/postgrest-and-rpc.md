# Supabase Reference: PostgREST and RPC

Supabase exposes tables, views, and SQL functions automatically through PostgREST.

## Table and View Naming

Tables and views appear under `/rest/v1/<name>`.

```sql
CREATE TABLE orders (...);

CREATE VIEW order_summaries AS
SELECT o.id, o.status, u.email AS customer_email
FROM orders o
JOIN users u ON u.id = o.user_id;
```

Views respect the policies of their underlying tables.

## SQL Functions as RPC

```sql
CREATE OR REPLACE FUNCTION get_user_dashboard()
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
    result json;
BEGIN
    SELECT json_build_object(
        'order_count', COUNT(id),
        'total_spent', SUM(amount)
    )
    INTO result
    FROM orders
    WHERE user_id = auth.uid();

    RETURN result;
END;
$$;
```

Rules:

- Prefer `SECURITY INVOKER` for browser-callable functions so RLS still applies.
- Use `SECURITY DEFINER` only when privilege elevation is intentional.
- If using `SECURITY DEFINER`, validate authorization inside the function body.
- Keep function names stable and purpose-specific because they become public API endpoints.
- Prefer idempotent read or narrow workflow functions over giant "do everything" RPC endpoints.
- Return typed, documented shapes instead of ad hoc JSON blobs when the frontend depends on the response contract.

## Filtering and Pagination

```text
GET /rest/v1/orders?status=eq.pending&user_id=eq.<uuid>
GET /rest/v1/orders?select=id,amount,status&order=created_at.desc&limit=20&offset=0
```

Prefer cursor-style pagination using `gt` or `lt` filters on stable columns for large tables.

For public APIs, document:

- allowed filters
- allowed ordering columns
- pagination model
- whether null ordering or case sensitivity matters

## Calling RPC from the Client

```typescript
const { data, error } = await supabase.rpc('get_user_dashboard');

const { data: searchResults, error: searchError } = await supabase.rpc('search_products', {
  search_query: 'headphones',
  category: 'electronics',
  max_price: 500,
});
```

## Hard Rules

- Keep table, view, and function names predictable because they become API surface.
- Document the filters and pagination model the frontend is allowed to use.
- Treat `SECURITY DEFINER` RPC as privileged code, not as a convenience switch.
