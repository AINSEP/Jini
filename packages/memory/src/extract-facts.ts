/**
 * @module extract-facts
 *
 * A generic, product-neutral extraction pipeline built on top of
 * `llm-provider.ts`'s "call an LLM HTTP API, get strict JSON back"
 * primitive: given a piece of content (a note, a document, a conversation
 * excerpt) and an LLM provider config, call the model with an
 * extraction-shaped prompt and return structured facts.
 *
 * This is the "actual generic extraction pipeline" `llm-provider.ts`'s own
 * module doc flagged as the real future work once the LLM-call primitive
 * existed (`archived provenance ledger`'s 2026-07-21 `llm-provider.ts` addition: "a real
 * future extraction candidate, noted here for whoever picks this up next").
 * It deliberately does NOT carry over any of the pieces the earlier passes
 * left un-ported for being OD-product-specific, not mechanism — see
 * `archived provenance ledger`'s classification table for the reasoning this follows:
 *
 * - **No fixed type/category taxonomy.** OD's `MEMORY_TYPES` enum
 *   (`profile`/`user`/`feedback`/`project`/`reference`/`rule`) is exactly
 *   the kind of "OD's own fixed bucket set" `note-store.ts` already
 *   generalized into a host-supplied `validTypes`/`defaultType` — this
 *   module goes further and has no category enum at all.
 *   {@link ExtractedFact.category} is a free-form string the model chooses
 *   (optionally steered by {@link ExtractFactsPromptConfig.suggestedCategories},
 *   a hint, never an enforced/rejecting filter).
 * - **No OD-branded system prompt.** The origin's `SYSTEM_PROMPT`/
 *   `ANNOTATION_SYSTEM_PROMPT` ("You are a memory extractor for a personal
 *   AI design assistant") are product copy; {@link DEFAULT_SYSTEM_PROMPT}
 *   here says nothing about what kind of assistant/product is asking, and a
 *   caller can override it outright via
 *   {@link ExtractFactsPromptConfig.systemPrompt}.
 * - **No design-topic regex filtering or connector-mining vocabulary** —
 *   the `memory-connectors.ts` content this package never ported (a
 *   ~30-pattern design-vocabulary filter deciding what counts as
 *   "design-relevant"). This module has no topic opinion; every piece of
 *   `content` a caller hands it is extracted from as given.
 * - **No coding-agent-CLI transport.** `llm-provider.ts` already excluded
 *   `memory-llm.ts`'s local `claude`/`codex`/`opencode` subprocess
 *   execution; this module only ever calls `callLlmProvider`/
 *   `parseStrictJson`, the HTTP-only primitives.
 * - **No storage/persistence.** Writing an extracted fact into a note store
 *   (`note-store.ts`) is a caller decision, including which `type` to store
 *   it under (this package's `validTypes` are host-defined, not derived
 *   from anything in this module) — see {@link factToNoteDraft} for an
 *   optional, deliberately thin bridge a caller may use, not a requirement.
 */
import type { LlmProviderConfig, LlmProviderOptions } from './llm-provider.js';
import { callLlmProvider, parseStrictJson } from './llm-provider.js';
import type { ExtractionLog } from './extraction-log.js';

/** One atomic fact/claim extracted from a piece of content. */
export interface ExtractedFact {
  /** The extracted statement itself — a single, self-contained claim understandable on its own. */
  statement: string;
  /** Optional caller-defined category label (e.g. "preference", "decision", "risk"). Free-form — no fixed taxonomy is enforced by this module. */
  category?: string;
  /** Named entities (people, projects, tools, ...) this fact is about or mentions. */
  entities?: string[];
  /** The model's own confidence in this extraction, clamped to `[0, 1]`. Models are not calibrated — treat as a rough signal, not a probability. */
  confidence?: number;
  /** A short verbatim-or-near-verbatim quote from the source content supporting this fact, for auditability. */
  sourceQuote?: string;
}

/** Input content to extract facts from. */
export interface ExtractFactsInput {
  /** The content to extract facts from — a note body, a document, a conversation excerpt, etc. */
  content: string;
}

/** Optional metadata for the content. */
interface ExtractFactsMetadata {
  /** Optional human-readable label for what `content` is (e.g. "chat message from 2026-07-21", "uploaded PDF: contract.pdf"), folded into the prompt for context. Never a taxonomy value — purely descriptive text. */
  sourceLabel?: string;
}

/** Prompt-shaping options for {@link extractFacts}. Every field is optional; omitting all of them uses {@link DEFAULT_SYSTEM_PROMPT} and {@link DEFAULT_MAX_FACTS}. */
export interface ExtractFactsPromptConfig {
  /** Overrides the default system prompt entirely. Supply this to add domain framing, a category taxonomy, tone, or any product-specific instruction — this module has none of its own beyond the generic default. */
  systemPrompt?: string;
  /** Category labels to suggest to the model as a hint folded into the user prompt. Never enforced — `extractFacts` does not filter/reject a returned `category` outside this list. */
  suggestedCategories?: readonly string[];
  /** Upper bound on how many facts one call returns. Defaults to {@link DEFAULT_MAX_FACTS} when omitted or not a positive number. */
  maxFacts?: number;
}

/** Optional extraction-attempt log integration for {@link extractFacts}. */
export interface ExtractFactsLogOptions {
  /** When supplied, `extractFacts` records the attempt's lifecycle (start → provider → proposed count → success/failure) via this log, matching the daemon-side UX pattern `extraction-log.ts` exists for. */
  log: ExtractionLog;
  /**
   * The free-form `kind` label recorded on the attempt (see
   * `ExtractionRecord.kind`) — a host-chosen label like `'note-extraction'`
   * or `'chat-turn-extraction'`, not a fixed enum.
   */
  kind: string;
}

export interface ExtractFactsOptions extends ExtractFactsMetadata {
  llm?: LlmProviderOptions;
  prompt?: ExtractFactsPromptConfig;
  logging?: ExtractFactsLogOptions;
}

/** Result of a successful {@link extractFacts} call. */
export interface ExtractFactsResult {
  /** The sanitized, validated fact list — never more than the effective `maxFacts`. */
  facts: ExtractedFact[];
  /** The model's raw text output, kept for logging/debugging. Callers should use `facts`, not re-parse this themselves. */
  raw: string;
}

/** Fallback cap on returned facts when {@link ExtractFactsPromptConfig.maxFacts} is omitted or invalid. */
export const DEFAULT_MAX_FACTS = 20;

/**
 * Generic default extraction system prompt. Says nothing about what kind of
 * product/assistant is asking, and has no fixed category taxonomy — a
 * caller with product-specific framing supplies its own via
 * {@link ExtractFactsPromptConfig.systemPrompt}.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a fact-extraction assistant. Given a piece of content, extract discrete, atomic, self-contained facts stated or clearly implied by it.

Respond with strict JSON only, no markdown fences, in exactly this shape:
{"facts": [{"statement": "...", "category": "...", "entities": ["..."], "confidence": 0.0, "sourceQuote": "..."}]}

Rules:
- Every field except "statement" is optional; omit a field rather than guessing a value for it.
- Each "statement" must stand alone (understandable without the rest of the content).
- Only extract facts actually present in the content — never invent, infer beyond what's stated, or pad the list to reach a target count.
- "confidence", if included, is a number from 0 to 1.
- "sourceQuote", if included, should be a short, verbatim-or-near-verbatim excerpt supporting the statement.
- If the content contains no extractable facts, respond with {"facts": []}.`;

function buildUserPrompt(input: ExtractFactsInput & ExtractFactsMetadata, prompt: ExtractFactsPromptConfig | undefined, maxFacts: number): string {
  const lines: string[] = [];
  if (input.sourceLabel) lines.push(`Source: ${input.sourceLabel}`);
  if (prompt?.suggestedCategories && prompt.suggestedCategories.length > 0) {
    lines.push(`Suggested categories (optional hints, not a fixed list): ${prompt.suggestedCategories.join(', ')}`);
  }
  lines.push(`Extract at most ${maxFacts} facts.`);
  lines.push('');
  lines.push('Content:');
  lines.push(input.content);
  return lines.join('\n');
}

interface RawExtractionResponse {
  facts?: unknown;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** @internal Validate and normalize one raw candidate from the model's `facts` array; `null` for anything without a usable `statement`. */
function sanitizeFact(candidate: unknown): ExtractedFact | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const record = candidate as Record<string, unknown>;
  const statement = nonEmptyString(record.statement);
  if (!statement) return null;

  const fact: ExtractedFact = { statement };
  const category = nonEmptyString(record.category);
  if (category) fact.category = category;

  if (Array.isArray(record.entities)) {
    const entities = record.entities.map(nonEmptyString).filter((e): e is string => e !== undefined);
    if (entities.length > 0) fact.entities = entities;
  }

  if (isFiniteNumber(record.confidence)) {
    fact.confidence = Math.min(1, Math.max(0, record.confidence));
  }

  const sourceQuote = nonEmptyString(record.sourceQuote);
  if (sourceQuote) fact.sourceQuote = sourceQuote;

  return fact;
}

function resolveMaxFacts(prompt: ExtractFactsPromptConfig | undefined): number {
  const raw = prompt?.maxFacts;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_FACTS;
}

/**
 * Extracts structured facts from a piece of content by calling an LLM with
 * an extraction-shaped prompt and parsing/validating its strict-JSON
 * response.
 *
 * Empty/whitespace-only `input.content` short-circuits to `{ facts: [], raw: '' }`
 * without making a network call — there is nothing to extract from.
 *
 * @param required - Vendor configuration and content to extract.
 * @param options - Source label, prompt settings, transport ports and logging.
 * @returns The sanitized fact list (capped at the effective `maxFacts`) plus the model's raw text output.
 * @throws Whatever `callLlmProvider`/`parseStrictJson` throw (network/HTTP/non-JSON-response errors), or an Error for a JSON null response. Response failures are logged before rethrowing.
 */
export async function extractFacts(
  { llmConfig, content: inputContent }: { llmConfig: LlmProviderConfig; content: string },
  options: ExtractFactsOptions = {},
): Promise<ExtractFactsResult> {
  const content = inputContent.trim();
  if (!content) {
    return { facts: [], raw: '' };
  }

  const maxFacts = resolveMaxFacts(options.prompt);
  const systemPrompt = options.prompt?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const userPrompt = buildUserPrompt(
    { content, ...(options.sourceLabel !== undefined ? { sourceLabel: options.sourceLabel } : {}) },
    options.prompt,
    maxFacts,
  );

  const logging = options.logging;
  const attemptId = logging?.log.startExtraction({ userMessage: content, kind: logging.kind });
  if (attemptId !== undefined) {
    logging!.log.markProvider({ id: attemptId, provider: { kind: llmConfig.provider, model: llmConfig.model } });
  }

  let raw: string;
  try {
    raw = await callLlmProvider({ config: llmConfig, systemPrompt, userPrompt }, options.llm);
  } catch (err) {
    if (attemptId !== undefined) logging!.log.markFailed({ id: attemptId, error: err });
    throw err;
  }

  let parsed: RawExtractionResponse;
  try {
    const response = parseStrictJson<RawExtractionResponse | null>({ rawText: raw });
    // JSON null is valid syntax, but has no facts field; reject it inside the failure-log boundary.
    if (response === null) throw new Error('extract-facts: response must not be null');
    parsed = response;
  } catch (err) {
    if (attemptId !== undefined) logging!.log.markFailed({ id: attemptId, error: err });
    throw err;
  }

  const candidates = Array.isArray(parsed.facts) ? parsed.facts : [];
  const facts = candidates
    .map(sanitizeFact)
    .filter((fact): fact is ExtractedFact => fact !== null)
    .slice(0, maxFacts);

  if (attemptId !== undefined) {
    logging!.log.markProposed({ id: attemptId, proposedCount: facts.length });
    // "success" here means the extraction call itself succeeded and
    // produced this many candidate facts — NOT that anything was persisted
    // (this module never writes to a store; see the module doc). A caller
    // that goes on to actually write some of these facts into a note store
    // may call `log.markSuccess({ id: attemptId, outcome: { writtenCount, writtenIds } })`
    // again afterward with the real outcome — `ExtractionLog`'s records are
    // mutable/overwritable by id, so a second call updates the same record
    // rather than creating a duplicate.
    logging!.log.markSuccess({ id: attemptId, outcome: { writtenCount: facts.length, writtenIds: [] } });
  }

  return { facts, raw };
}

/** Optional caller-supplied shape for {@link factToNoteDraft}'s derived `name` field. Defaults to a truncated `statement`. */
const NOTE_DRAFT_NAME_MAX_LENGTH = 80;

/** A `NoteStore.upsertEntry`-compatible draft, deliberately the exact narrow subset that function accepts (`name`/`description`/`type`). */
export interface NoteDraft {
  name: string;
  description: string;
  type: string;
}

/**
 * Optional, deliberately thin bridge from one {@link ExtractedFact} to a
 * `NoteStore.upsertEntry`-shaped draft (`note-store.ts`) — NOT a requirement
 * for using {@link extractFacts}. This module has no opinion on note-store
 * types beyond what the caller passes in `type`: `note-store.ts`'s
 * `validTypes`/`defaultType` are host-defined, never derived from
 * {@link ExtractedFact.category} automatically, so a caller that wants
 * `category` to drive `type` maps it itself before calling this.
 *
 * @param fact - The extracted fact to convert.
 * @param type - The note-store type to file this draft under (must be one of the target store's own `validTypes`; this function does not validate that).
 * @returns `{ name, description, type }` — `name` is `fact.statement`
 *   truncated to {@link NOTE_DRAFT_NAME_MAX_LENGTH} chars (note-store names
 *   are short labels, not full bodies); `description` is the full
 *   `statement` plus, when present, a `sourceQuote` line.
 */
export function factToNoteDraft({ fact, type }: { fact: ExtractedFact; type: string }): NoteDraft {
  const name =
    fact.statement.length > NOTE_DRAFT_NAME_MAX_LENGTH ? `${fact.statement.slice(0, NOTE_DRAFT_NAME_MAX_LENGTH - 1).trim()}…` : fact.statement;
  const description = fact.sourceQuote ? `${fact.statement}\n\nSource: "${fact.sourceQuote}"` : fact.statement;
  return { name, description, type };
}
