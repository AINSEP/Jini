/** One credential policy for chat text; secure card values must bypass this text-only boundary. */
import { redactSecretShapes, type RedactionRule } from '@jini-ai/diagnostics/redaction/secrets-only';
import type { ChatMessage } from './messages.js';

export interface SecretRedactionSignal {
  readonly secretRedacted: true;
  readonly count: number;
}
export interface UserTextRedaction {
  readonly text: string;
  readonly secretRedacted: boolean;
  readonly count: number;
}
export type RedactUserText = (required: { readonly text: string }, optional?: { readonly secretField?: boolean }) => UserTextRedaction;
export interface UserTextRedactionOptions {
  /** Default on; hosts may supply a stricter credential policy without changing chat storage. */
  readonly redactUserText?: RedactUserText;
  /** Contains no user text or credential fragments. A host can offer its secure credential card. */
  readonly onSecretRedacted?: (signal: SecretRedactionSignal) => void;
}
export const SECRET_REDACTED_NOTICE = 'I removed what looked like a key from your message. If it was real, rotate it. Use the secure form to save it.';
export const CREDENTIAL_CARD_GUIDANCE = 'Use the secure form to save keys, tokens, passwords, and secrets. Chat answers are sent to the assistant.';
const REMOVED = '[token removed]';
const INTERNAL_REMOVED = '[REDACTED:chat_secret]';
const REDACTION_MARKER = /\[REDACTED:[^\]\r\n]+\]/g;
const CHAT_RULES: readonly RedactionRule[] = [
  { kind: 'chat_key', pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}/g, replacement: () => INTERNAL_REMOVED },
  { kind: 'chat_key', pattern: /(?<![A-Za-z0-9_])xox[baprs]-[A-Za-z0-9-]{16,}/g, replacement: () => INTERNAL_REMOVED },
  // Explicit authorization syntax catches even short values. Exempt scheme descriptions in prose.
  { kind: 'chat_bearer', pattern: /\bBearer[ \t]+(?!\[REDACTED)(?!(?:token|tokens|authentication|authorization|auth|scheme|credentials?)\b)[A-Za-z0-9._~+\/=-]+/gi, replacement: () => 'Bearer ' + INTERNAL_REMOVED },
];

function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const probability = count / text.length;
    bits -= probability * Math.log2(probability);
  }
  return bits;
}

/** Stricter than error redaction: also detects unlabelled long tokens, while retaining ordinary URLs,
 * hexadecimal hashes, identifiers and prose. Strong credential syntax inside a URL is still caught. */
export function redactUserText({ text }: { readonly text: string }, { secretField = false }: { readonly secretField?: boolean } = {}): UserTextRedaction {
  // Existing removal markers must survive a second pass through assignment rules (api_key=…).
  const literalMarkers = new Map<string, string>();
  let literalPrefix = 'chat_literal_';
  while (text.includes(literalPrefix)) literalPrefix += '_';
  const protectedText = text.replace(REDACTION_MARKER, marker => {
    const key = '[REDACTED:' + literalPrefix + literalMarkers.size + ']';
    literalMarkers.set(key, marker);
    return key;
  }).replaceAll(REMOVED, INTERNAL_REMOVED);
  const base = redactSecretShapes({ text: protectedText, policy: { additionalRules: CHAT_RULES } });
  let count = base.redactions;
  const urls = [...base.text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi)]
    .map(match => ({ start: match.index!, end: match.index! + match[0].length }));
  let cleaned = base.text.replace(/(?<![A-Za-z0-9_+\/=-])[A-Za-z0-9_+\/=-]{40,}(?![A-Za-z0-9_+\/=-])/g, (candidate: string, offset: number) => {
    if (urls.some(url => offset >= url.start && offset < url.end)) return candidate;
    if (/^[a-f0-9]+$/i.test(candidate) || !/[A-Za-z]/.test(candidate)) return candidate;
    const bits = entropy(candidate);
    const mixedAlphabet = /[A-Z]/.test(candidate) && /[a-z]/.test(candidate);
    if (bits < 4 || (!/[0-9]/.test(candidate) && (!mixedAlphabet || bits < 4.5))) return candidate;
    count += 1;
    return INTERNAL_REMOVED;
  });
  // A labelled credential answer can be a short password with no recognisable shape at all.
  if (secretField && cleaned.trim() !== '' && cleaned !== INTERNAL_REMOVED) {
    cleaned = INTERNAL_REMOVED;
    count = Math.max(1, count);
  }
  return { text: cleaned.replace(REDACTION_MARKER, marker => literalMarkers.get(marker) ?? REMOVED), secretRedacted: count > 0, count };
}

/** Prepare before storage OR model dispatch. Return only sanitized content and non-secret metadata. */
export function redactUserMessage<T extends { readonly role: string; readonly content: string }>(
  { message }: { readonly message: T }, options: UserTextRedactionOptions = {},
): { readonly message: T; readonly secretRedacted: boolean; readonly count: number } {
  if (message.role !== 'user') return { message, secretRedacted: false, count: 0 };
  const result = (options.redactUserText ?? redactUserText)({ text: message.content });
  const signal = result.secretRedacted ? { secretRedacted: true as const, count: result.count } : undefined;
  if (signal) options.onSecretRedacted?.(signal);
  return {
    message: { ...message, content: result.text, ...(signal ? { secretRedaction: signal } : {}) },
    secretRedacted: result.secretRedacted, count: result.count,
  };
}

/** Also protects replay of historical text accepted before the guard was installed. */
export function redactUserHistory({ history }: { readonly history: readonly ChatMessage[] }, options: UserTextRedactionOptions = {}): ChatMessage[] {
  return history.map(message => redactUserMessage({ message }, options).message);
}

/** Redact model input and append the host's non-secret card guidance once, using the redaction
 * signal rather than display text. `secretRedacted` carries an earlier ingress/composer signal;
 * persistence must continue to use redactUserText/redactUserMessage without the model note. */
export function guardUserText(
  { text }: { readonly text: string },
  options: { readonly modelNote?: string; readonly secretRedacted?: boolean; readonly redactUserText?: RedactUserText } = {},
): string {
  const safe = (options.redactUserText ?? redactUserText)({ text }, {});
  if (!safe.secretRedacted && options.secretRedacted !== true) return safe.text;
  if (!options.modelNote || safe.text.includes(options.modelNote)) return safe.text;
  return `${safe.text}\n\n${options.modelNote}`;
}
