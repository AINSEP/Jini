/**
 * @module types
 *
 * The central, product-neutral contract for this package: `RuntimeAgentDef`
 * declaratively describes how to detect, authenticate, and spawn a single
 * coding-agent CLI (Claude Code, Codex, Cursor, Aider, AMR, …). Everything
 * else in `@jini-ai/agent-runtime` — the registry, detection, launch, and
 * stream-parsing modules — operates on this type or on `DetectedAgent`, its
 * runtime-probed sibling.
 *
 * Ported from OD's `apps/daemon/src/runtimes/types.ts`. Product-neutral
 * as found — see `archived provenance ledger` for the full provenance table.
 */
import type { DefaultModelResolution, ModelCatalogSnapshot, RuntimeAgentDef, RuntimeModelOption, RuntimeModelSource } from '@jini-ai/core/contracts/agents';
import type { ExecFileOptions } from 'node:child_process';
import type { AgentDiagnostic } from '@jini-ai/protocol';



export type DetectedAgent = Omit<
  RuntimeAgentDef,
  | 'discoverModels'
  | 'resolveDefaultModel'
  | 'buildArgs'
  | 'listModels'
  | 'fetchModels'
  // A closure like `buildArgs`: `JSON.stringify` would drop the function and leave nothing behind,
  // and a registry consumer has no models list of its own to feed it. Its RESULT is what ships, in
  // the `reasoningOptions` field this same type already carries.
  | 'deriveReasoningOptions'
  | 'fallbackModels'
  // Build-time provenance about the fallback list, for the freshness guard. The fallback list
  // itself is stripped one line above, so a registry consumer has nothing to interpret it
  // against.
  | 'fallbackModelsAssertedAt'
  | 'helpArgs'
  | 'capabilityFlags'
  | 'fallbackBins'
  | 'versionProbeTimeoutMs'
  | 'maxPromptArgBytes'
  | 'env'
  // `inactivityTimeoutMs` is a spawn-time-only hint consumed by a chat-run
  // watchdog. It is not part of a public agent-registry API contract, so
  // omitting it here keeps that response aligned with such a shared
  // web/CLI shape — agents pick it up by reading the runtime def directly,
  // the registry payload stays unchanged.
  | 'inactivityTimeoutMs'
  | 'authProbe'
  // All three of the spawn-orchestration fields are stripped for the same
  // reason `inactivityTimeoutMs` is: they instruct whoever *spawns* the CLI
  // and mean nothing to a registry consumer picking an agent from a list.
  // `stdoutPolicy` and `runtimeLock` additionally carry closures, which a
  // JSON response would silently flatten into a misleading half-object
  // (`{"buffering":"until-close"}` with the sanitizer gone, `{}` for the
  // lock) rather than omit — see `detection.ts#stripFns`.
  | 'needsAgentLogFile'
  | 'stdoutPolicy'
  | 'runtimeLock'
> & {
  models: RuntimeModelOption[];
  modelsSource: RuntimeModelSource;
  modelCatalog?: ModelCatalogSnapshot;
  defaultModelResolution?: DefaultModelResolution;
  available: boolean;
  authStatus?: 'ok' | 'missing' | 'unknown';
  authMessage?: string;
  path?: string;
  version?: string | null;
  diagnostics?: AgentDiagnostic[];
};

export type RuntimeExecOptions = ExecFileOptions & {
  env?: NodeJS.ProcessEnv;
};

