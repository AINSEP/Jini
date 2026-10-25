/**
 * @module ai-trace/capture
 * Applies the capture mode and redaction before any text reaches a sink. Redaction reuses the
 * engine's lexical scrubber (`@jini-ai/core` `redactSecretsWithCounts`): credential shapes,
 * emails, phones, Luhn-valid cards. It does NOT detect names, addresses or business secrets —
 * that is why `metadata` (char counts only) exists and is the recommended default for prompts
 * that may hold customer data.
 */
import { redactSecretsWithCounts } from '@jini-ai/core';
import type { AiCapturedText, AiContentCapture } from './types.js';

export const DEFAULT_MAX_CAPTURED_CHARS = 16_000;

export interface CaptureTextOptions {
  readonly mode?: AiContentCapture | undefined;
  readonly maxChars?: number | undefined;
  /** Host-known secrets (API keys in env, tokens) masked exactly before the lexical rules run. */
  readonly exactSecrets?: ReadonlyArray<string | undefined | null> | undefined;
}

/** `off` → `null`; `metadata` → `{ chars }`; `full` → redacted (then truncated) text plus counts. */
export function captureText({ text }: { text: string | null | undefined }, { mode = 'metadata', maxChars = DEFAULT_MAX_CAPTURED_CHARS, exactSecrets = [] }: CaptureTextOptions = {}): AiCapturedText | null {
  if (mode === 'off' || text === null || text === undefined) return null;
  if (mode === 'metadata') return { chars: text.length };
  return captureFullText({ text, maxChars, exactSecrets });
}

// Redact before truncating: a cut through a secret would leave a prefix no rule matches.
function captureFullText({ text, maxChars, exactSecrets }: { text: string; maxChars: number; exactSecrets: ReadonlyArray<string | undefined | null> }): AiCapturedText {
  const { redacted, counts } = redactSecretsWithCounts({ input: text }, { exactSecrets });
  const truncated = redacted.length > maxChars;
  return {
    chars: text.length,
    text: truncated ? redacted.slice(0, maxChars) : redacted,
    ...(truncated ? { truncated } : {}),
    ...(Object.keys(counts).length ? { redactions: counts } : {}),
  };
}

/** Tool inputs arrive as objects; stringify once so capture/redaction sees the same text a backend would. */
export function stringifyForCapture({ value }: { value: unknown }): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
