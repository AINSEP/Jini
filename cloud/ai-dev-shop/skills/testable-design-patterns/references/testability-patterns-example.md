# Testability Patterns (Functions and Boundaries)

This reference is a general guide for writing code that is easy to test across application layers.

## 1) Pure Logic Function Pattern

```typescript
export interface SelectModelInput {
  availableModels: string[];
  preferredModel: string | null;
}

export interface SelectModelResult {
  selectedModel: string;
  fallbackUsed: boolean;
}

/**
 * Selects a model deterministically from available options.
 * @param input Model-selection inputs.
 * @returns Selected model and whether fallback logic was used.
 */
export const selectModel = (
  { availableModels, preferredModel }: SelectModelInput,
  {}: {} = {},
): SelectModelResult => {
  if (preferredModel && availableModels.includes(preferredModel)) {
    return { selectedModel: preferredModel, fallbackUsed: false };
  }
  return {
    selectedModel: availableModels[0] ?? 'default-model',
    fallbackUsed: true,
  };
};
```

Why this is testable:
- explicit typed input/output
- deterministic return value
- no hidden dependencies

## 2) API Function Pattern (Injectable Boundary)

```typescript
export interface HttpClient {
  post: (
    { url, body }: { url: string; body: unknown },
    optional?: { signal?: AbortSignal },
  ) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
}

export interface SendMessageInput {
  message: string;
  model: string;
}

export interface SendMessageOutput {
  reply: string;
}

/**
 * Sends a message request through an injected HTTP client.
 * @param http Injected HTTP boundary.
 * @param input Request payload.
 * @returns Parsed reply payload.
 */
export const sendMessage = async (
  { http, input }: { http: HttpClient; input: SendMessageInput },
  { signal }: { signal?: AbortSignal } = {},
): Promise<SendMessageOutput> => {
  const response = await http.post({ url: '/api/chat', body: input }, { signal });
  if (!response.ok) throw new Error('CHAT_REQUEST_FAILED');
  const body = (await response.json()) as { reply: string };
  return { reply: body.reply };
};
```

Why this is testable:
- transport boundary injected
- behavior asserted via output/throw paths
- no framework coupling

## 3) Practical Test Mapping

- `logic/*.ts` -> unit tests in `__tests__/unit/*.unit.test.ts`
- `api/*.ts` boundary behavior -> integration tests in `__tests__/integration/*.integration.test.ts`

## 4) Design Smells (Refactor Immediately)

- Function has hidden globals/time/random/network calls.
- Tests require mocking too many unrelated dependencies.
- You can only verify behavior by checking internals instead of outputs.
