# Supabase Reference: RLS and Policies

RLS is the primary security boundary in Supabase. The same policy model governs SQL access, PostgREST access, and realtime visibility.

## Enabling RLS

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
```

A table with RLS enabled and no matching policy usually returns zero rows to non-superuser roles.

## Writing Policies

```sql
CREATE POLICY "users_select_own_orders"
ON orders
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "users_insert_own_orders"
ON orders
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_update_own_orders"
ON orders
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_delete_own_orders"
ON orders
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "public_select_published_articles"
ON articles
FOR SELECT
TO anon, authenticated
USING (published_at IS NOT NULL AND published_at <= now());
```

Rules:

- `USING` filters existing rows for `SELECT`, `UPDATE`, and `DELETE`.
- `WITH CHECK` validates new row values for `INSERT` and `UPDATE`.
- For `UPDATE`, you usually need both.
- `auth.uid()` returns `NULL` for `anon`.

## Role-Based Policies

```sql
CREATE TABLE profiles (
    id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer'))
);

CREATE POLICY "admins_select_all_orders"
ON orders
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
    )
);
```

Use profile-table or custom-claim checks when ownership alone is insufficient.

## Multi-Tenant Patterns

When the app has organizations, workspaces, or tenants, make tenant scope explicit in both schema and policy design.

```sql
CREATE TABLE documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title text NOT NULL
);

CREATE POLICY "org_members_select_documents"
ON documents
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM organization_members om
        WHERE om.organization_id = documents.organization_id
          AND om.user_id = auth.uid()
    )
);
```

Rules:

- include the tenant or organization boundary as a real column
- make policy ownership logic explicit through membership or claims
- index the tenant boundary columns used in policies
- avoid hidden tenant filters in application code as the only isolation layer

## Policy Testing

```sql
BEGIN;
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub": "user-b-uuid"}';

SELECT * FROM orders WHERE id = 'order-belonging-to-user-a';

ROLLBACK;
```

Test policies in-role, in-transaction, and against realistic ownership cases.

## Policy Debug Checklist

When access is unexpectedly empty or too broad, check in this order:

1. is RLS enabled and forced on the table
2. does the required role have a `SELECT` policy at all
3. does the policy predicate match the actual row ownership or tenant boundary
4. are required helper tables such as `profiles` or membership tables populated
5. are policy predicate columns indexed well enough to avoid pathological scans on large tables
6. if using custom claims, does the JWT actually contain the expected claim

## Hard Rules

- Do not leave a user-data table with RLS enabled but no intentional `SELECT` policy.
- Do not write policies without clear row ownership or role semantics.
- Do not assume errors will reveal RLS misconfiguration; empty results are the common failure mode.
