# Supabase Reference: Client Setup and Types

## Installation and Initialization

```bash
npm install @supabase/supabase-js
```

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
```

Browser rules:

- Use the public URL plus anon key.
- Do not expose the service role key.

## Admin Client

```typescript
import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
```

This client is server-only and bypasses RLS.

## Type Generation

```bash
npx supabase gen types typescript --project-id <your-project-ref> > lib/supabase/database.types.ts
npx supabase gen types typescript --local > lib/supabase/database.types.ts
```

Regenerate after schema changes and commit the generated file.

## Typed Query Example

```typescript
const { data: orders, error } = await supabase
  .from('orders')
  .select('id, amount, status, created_at')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .limit(20);

if (error) throw error;
```

## Hard Rules

- Keep browser and admin clients in separate modules.
- Do not import admin clients into shared or client-rendered code.
- Treat type generation as part of schema-change completion, not an optional follow-up.
