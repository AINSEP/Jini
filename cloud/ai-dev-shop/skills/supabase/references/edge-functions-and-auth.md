# Supabase Reference: Edge Functions and Auth

## When to Use Edge Functions

Use edge functions for:

- external API calls
- third-party webhooks
- server-side logic that needs secrets
- custom auth flows

Prefer SQL functions for database-only logic and RPC-style data composition.

## Basic Edge Function Structure

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const body = await req.json();

    return new Response(JSON.stringify({ success: true, body }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

Secrets live in Supabase function secrets, not in source control:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
```

### Caller Context vs Service Context

Use the caller JWT when the function should preserve the requesting user's access rules.

Use a service-role client only in narrow, server-only paths where privilege elevation is intentional and audited.

```typescript
const callerSupabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
  { global: { headers: { Authorization: authHeader } } },
);

const serviceSupabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
```

Hard rule: never mix these two contexts casually. Decide which permission model the function is supposed to run under before writing the handler.

## Auth Integration

Do not write directly to `auth.users`. Store app-specific user data in a profile table.

```sql
CREATE TABLE profiles (
    id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username   text UNIQUE NOT NULL,
    full_name  text,
    avatar_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
```

User-owned tables should usually include:

```sql
user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
```

### Custom Claims Hook

```sql
CREATE OR REPLACE FUNCTION custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    claims jsonb;
    user_role text;
BEGIN
    SELECT role INTO user_role FROM profiles WHERE id = (event->>'user_id')::uuid;

    claims := event->'claims';
    claims := jsonb_set(claims, '{user_role}', to_jsonb(COALESCE(user_role, 'member')));

    RETURN jsonb_set(event, '{claims}', claims);
END;
$$;
```

After enabling the hook, `auth.jwt()` can expose custom claims for policy logic.

### Auth Modeling Defaults

- keep app profile data in `public.profiles`, not `auth.users`
- make ownership columns point to `auth.users(id)` explicitly
- document which policies depend on custom claims or profile roles
- if a signup trigger creates profile rows, treat that trigger as part of the auth contract and test it

## Hard Rules

- Do not use edge functions when SQL functions are sufficient.
- Do not hardcode secrets.
- Do not model user ownership without a clear `auth.users` linkage.
- Do not use custom claims without documenting which policies depend on them.
