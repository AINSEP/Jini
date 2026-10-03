/**
 * @module providers/token-params
 *
 * OpenAI chat-completions token-limit parameter selection. The
 * `max_tokens` field was renamed `max_completion_tokens` for the
 * GPT-5/o-series reasoning-model families, which reject the legacy field;
 * every other OpenAI-wire-compatible model (and every OpenAI-compatible
 * gateway) still expects `max_tokens`. Product-neutral as found in the
 * origin — ported verbatim.
 */

/** True when `model` belongs to a family that rejects the legacy `max_tokens` field. */
export function usesMaxCompletionTokens({ model }: { model: string }): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    /^gpt-5(?:[.-]|$)/.test(normalized) ||
    /^o1(?:[.-]|$)/.test(normalized) ||
    /^o3(?:[.-]|$)/.test(normalized) ||
    /^o4(?:[.-]|$)/.test(normalized)
  );
}

/** Selects `max_tokens` or `max_completion_tokens` per {@link usesMaxCompletionTokens}. */
export function buildOpenAIChatTokenParam({ model, maxTokens }: { model: string; maxTokens: number }
): { max_tokens: number } | { max_completion_tokens: number } {
  if (usesMaxCompletionTokens({ model: model })) {
    return { max_completion_tokens: maxTokens };
  }
  return { max_tokens: maxTokens };
}

/** Always the legacy `max_tokens` shape — for callers that already know the model family. */
export function buildLegacyMaxTokensParam({ maxTokens }: { maxTokens: number }): { max_tokens: number } {
  return { max_tokens: maxTokens };
}

/** Always the newer `max_completion_tokens` shape — for callers that already know the model family. */
export function buildMaxCompletionTokensParam({ maxTokens }: { maxTokens: number }): { max_completion_tokens: number } {
  return { max_completion_tokens: maxTokens };
}

/** Detects the provider error text a gateway returns when `max_tokens` was rejected in favor of `max_completion_tokens`. */
export function isUnsupportedMaxTokensError({ detail }: { detail: string }): boolean {
  const normalized = detail.toLowerCase();
  return (
    normalized.includes('unsupported parameter') &&
    normalized.includes('max_tokens') &&
    normalized.includes('max_completion_tokens')
  );
}
