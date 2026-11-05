# Function Signature Patterns (Required + Optional Objects)

## Core Pattern

```typescript
export const doWork = (
  { requiredA, requiredB }: { requiredA: string; requiredB: number },
  { optionalFlag = false, signal }: { optionalFlag?: boolean; signal?: AbortSignal } = {},
): Result => {
  // ...
};
```

Why:
- Scales without argument-order breakage
- Keeps call sites self-documenting
- Supports additive optional parameters safely

## Pure Logic Example

```typescript
interface NormalizeEmailInput {
  rawEmail: string;
}

interface NormalizeEmailOptions {
  lowercase?: boolean;
}

export const normalizeEmail = (
  { rawEmail }: NormalizeEmailInput,
  { lowercase = true }: NormalizeEmailOptions = {},
): string => {
  const trimmed = rawEmail.trim();
  return lowercase ? trimmed.toLowerCase() : trimmed;
};
```

## Adapter Example

```typescript
interface HttpClient {
  get: (
    { url }: { url: string },
    optional?: { signal?: AbortSignal },
  ) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
}

export const fetchProfile = async (
  { http, userId }: { http: HttpClient; userId: string },
  { signal }: { signal?: AbortSignal } = {},
): Promise<{ id: string; name: string }> => {
  const response = await http.get({ url: `/api/users/${userId}` }, { signal });
  if (!response.ok) throw new Error('PROFILE_FETCH_FAILED');
  return (await response.json()) as { id: string; name: string };
};
```
