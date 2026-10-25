/**
 * @module ai-trace/usage
 * Folds every provider's usage spelling into {@link AiTokenUsage}. Each counter takes the first
 * alias the provider actually reported; a counter no alias matched stays `null` (never `0`).
 */
import type { AiTokenUsage } from './types.js';

type UsageKey = keyof AiTokenUsage;

// Dotted paths reach OpenAI's nested `*_details` objects. Order matters only when a provider
// reports two spellings of the same counter, which none of the normalizers do today.
const USAGE_ALIASES: Readonly<Record<UsageKey, readonly string[]>> = {
  inputTokens: ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokenCount'],
  outputTokens: ['output_tokens', 'outputTokens', 'completion_tokens', 'candidatesTokenCount'],
  cacheReadTokens: ['cache_read_input_tokens', 'cached_read_tokens', 'cachedReadTokens', 'cacheReadTokens', 'prompt_tokens_details.cached_tokens', 'cachedContentTokenCount'],
  cacheWriteTokens: ['cache_creation_input_tokens', 'cached_write_tokens', 'cacheWriteTokens'],
  reasoningTokens: ['thought_tokens', 'thoughtTokens', 'reasoningTokens', 'completion_tokens_details.reasoning_tokens', 'thoughtsTokenCount', 'reasoning_tokens'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) current = isRecord(current) ? current[part] : undefined;
  return current;
}

function firstNumber(source: Record<string, unknown>, aliases: readonly string[]): number | null {
  for (const alias of aliases) {
    const value = readPath(source, alias);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/** Returns `null` when the input is not a usage object or carries no recognised counter. */
export function normalizeAiUsage({ usage }: { usage: unknown }, _options: Record<string, never> = {}): AiTokenUsage | null {
  if (!isRecord(usage)) return null;
  const out = {} as Record<UsageKey, number | null>;
  let found = false;
  for (const key of Object.keys(USAGE_ALIASES) as UsageKey[]) {
    out[key] = firstNumber(usage, USAGE_ALIASES[key]);
    found ||= out[key] !== null;
  }
  return found ? out : null;
}

/** Adds two nullable counters; `null + null` stays `null` so "never reported" survives totals. */
export function addNullable(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}
