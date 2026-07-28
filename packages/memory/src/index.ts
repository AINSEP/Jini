/**
 * @module @injini/memory
 *
 * Generic daemon-side memory/notes capability: a frontmatter-backed note
 * store (`note-store.ts`), a bounded extraction-attempt log
 * (`extraction-log.ts`), a pure self-verify scorecard enforcer
 * (`verify.ts`), a labeled-line rule-body parser (`rule-body.ts`), and a
 * generic multi-vendor "call an LLM HTTP API, get strict JSON back"
 * primitive (`llm-provider.ts`). See `source-map.md` for provenance and the
 * scope decisions (what was generalized vs. explicitly left OD-side).
 */
export type { EntryFrontmatter } from './entry-frontmatter.js';
export { parseEntryFrontmatter, renderEntryFrontmatter } from './entry-frontmatter.js';

export type { ParsedRuleBody } from './rule-body.js';
export { parseRuleBody } from './rule-body.js';

export type {
  NoteChangeEvent,
  NoteChangeKind,
  NoteEntry,
  NoteEntrySummary,
  NoteStore,
  NoteStoreConfig,
  NoteStoreOptions,
  NoteTreeNode,
} from './note-store.js';
export { createNoteStore, NoteStoreConfigError } from './note-store.js';

export type { ExtractionLog, ExtractionPhase, ExtractionProvider, ExtractionRecord } from './extraction-log.js';
export { createExtractionLog } from './extraction-log.js';

export type {
  ActiveRuleForVerify,
  EnforceVerifyInput,
  VerifyLog,
  VerifyRecord,
  VerifyResult,
  VerifyScorecard,
  VerifyScorecardRow,
  VerifyScorecardRowStatus,
  VerifyStatus,
} from './verify.js';
export { createVerifyLog, enforceVerify } from './verify.js';

export type { LlmProviderConfig, LlmProviderId } from './llm-provider.js';
export {
  AZURE_DEFAULT_API_VERSION,
  DEFAULT_TIMEOUT_MS,
  appendVersionedApiPath,
  callLlmProvider,
  callLlmProviderForJson,
  describeFetchError,
  parseStrictJson,
} from './llm-provider.js';

export type {
  ExtractedFact,
  ExtractFactsInput,
  ExtractFactsLogOptions,
  ExtractFactsOptions,
  ExtractFactsPromptConfig,
  ExtractFactsResult,
  NoteDraft,
} from './extract-facts.js';
export { DEFAULT_MAX_FACTS, DEFAULT_SYSTEM_PROMPT, extractFacts, factToNoteDraft } from './extract-facts.js';
