/**
 * Write-only means no read-back: loadExecutionConfig's byok.apiKey is always "" — the server
 * never returns key material. Stored-credential metadata is read separately, never merged into
 * ExecutionConfig. The generic debounced ledger save cannot persist a key; only an explicit
 * credential-save action can write it.
 *
 * The key must survive a RELOAD, not just avoid being sent by one. A refresh replaces the whole
 * in-memory value with the loaded config, whose apiKey is "". reconcileExecutionConfigRefresh
 * preserves the current typed key while every non-secret field takes the reloaded value.
 */
import type { ByokConfig, ExecutionConfig } from "@jini-ai/core/contracts/execution";
import type { SettingScope } from "@jini-ai/core/settings";

/** SPEC-007 namespace holding every NON-SECRET execution-mode key. No
 *  `byok.apiKey` here — see this file's header, item 2. */
export const EXECUTION_NAMESPACE = "core.execution";

/** One ledger key per field rather than a single blob: the ledger's whole
 *  point is per-key layering and per-key revisions, and a JSON blob would
 *  collapse that back into one opaque value. */
const KEYS = {
  mode: "mode",
  protocol: "byok.protocol",
  providerId: "byok.providerId",
  baseUrl: "byok.baseUrl",
  model: "byok.model",
  maxTokens: "byok.maxTokens",
  localCliAgentId: "localCli.agentId",
  localCliModel: "localCli.model",
  localCliReasoning: "localCli.reasoning",
} as const;

/** Mirrors `assistant/execution-mode-settings.ts`'s identical sentinel —
 *  the ledger's `byok.maxTokens` definition cannot default to `null`
 *  (ADR-028 totality rejects a null default for every non-secret
 *  definition), so `0` round-trips as "unset" in both directions. `0` can
 *  never collide with a real cap: `@jini-ai/ui`'s `parseMaxTokens` already
 *  treats 0 as meaningless. */
const MAX_TOKENS_UNSET_SENTINEL = 0;

/** Scope for the ledger values. Workspace-scoped so one operator's endpoint
 *  choice doesn't silently become every workspace's. */
const SCOPE: SettingScope = "workspace";

/** Composer selections belong to the person; the workspace value remains their inherited default. */
function executionSettingScope({ key }: { key: string }, _optional: Record<string, never> = {}): SettingScope {
  return key.startsWith("localCli.") ? "user" : SCOPE;
}

/** A key exists — either just typed in this form, or already stored on the server. Both make the
 *  BYOK runtime picker and the probe controls meaningful, which is the only thing they need to
 *  decide. Mirrors `features/ai-assistant/rules.ts`'s identical `hasUsableKey`, generalized over
 *  just the one field every caller here actually has (`isSet`) since `AdminExecutionCredential`
 *  and `SiteAssistantCredential` are otherwise differently shaped.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function hasUsableAdminKey({ apiKey, stored }: { apiKey: string; stored: { isSet: boolean } | null }, _optional: Record<string, never> = {}): boolean {
  return Boolean(apiKey.trim()) || stored?.isSet === true;
}

/**
 * Whether there is a key to WRITE right now — a deliberately narrower question than
 * {@link hasUsableAdminKey}, and the two must not be collapsed.
 *
 * `hasUsableAdminKey` answers "can this admin run against a key at all", where an already-stored key
 * counts: `AssistantDock`'s `apiModeAvailable` is right to say yes on the strength of a stored
 * credential the browser cannot read back. This one answers "does pressing Save key have anything to
 * send", and there a stored key is irrelevant — the only thing that can be written is what is in the
 * field.
 *
 * The distinction is what fixes the reported bug. Someone starts typing a key, changes their mind
 * and clears the field: with a key already stored, `hasUsableAdminKey`'s stored arm kept Save key
 * enabled over an empty field, offering to write nothing. Derived synchronously from the trimmed
 * value on every render — never debounced, so it can never lag a keystroke and re-open that window.
 *
 * @param input.apiKey - The raw field value; trimmed here, so whitespace-only reads as blank.
 * @returns `true` only when the field holds a non-whitespace value.
 * @complexity O(n) in the field length, for the trim.
 */
export function hasTypedAdminKey({ apiKey }: { apiKey: string }, _optional: Record<string, never> = {}): boolean {
  return Boolean(apiKey.trim());
}

function asString({ value, fallback }: { value: unknown; fallback: string }, _optional: Record<string, never> = {}): string {
  return typeof value === "string" ? value : fallback;
}

/** Ledger `mode` value -> `ExecutionConfig["mode"]`, falling back to `fallback` for anything else
 *  (unset, or a value this admin build no longer recognizes). Pulled out of `loadExecutionConfig`
 *  (2026-08-06, complexity pass) as its own named step — see {@link buildByokConfigFromLedger}'s doc
 *  for why the whole function was split this way. */
export function readExecutionMode({ raw, fallback }: { raw: unknown; fallback: ExecutionConfig["mode"] }, _optional: Record<string, never> = {}): ExecutionConfig["mode"] {
  return raw === "local-cli" || raw === "byok" ? raw : fallback;
}

const BYOK_PROTOCOLS: readonly ByokConfig["protocol"][] = ["anthropic", "openai", "azure", "google"];

/** Ledger `byok.protocol` value -> `ByokConfig["protocol"]`, same fallback contract as
 *  {@link readExecutionMode}. */
export function readByokProtocol({ raw, fallback }: { raw: unknown; fallback: ByokConfig["protocol"] }, _optional: Record<string, never> = {}): ByokConfig["protocol"] {
  return BYOK_PROTOCOLS.includes(raw as ByokConfig["protocol"]) ? (raw as ByokConfig["protocol"]) : fallback;
}

/** `null` is a real, distinct value here (it selects the custom endpoint), so only `undefined`
 *  (unset) falls back to `fallback` — a plain `??` would treat both the same. */
export function readByokProviderId({ raw, fallback }: { raw: unknown; fallback: string | null }, _optional: Record<string, never> = {}): string | null {
  if (raw === null) return null;
  return typeof raw === "string" ? raw : fallback;
}

/**
 * Builds the `byok` half of `loadExecutionConfig`'s result from the ledger rows.
 *
 * Pulled out of `loadExecutionConfig` (2026-08-06, complexity pass) along with
 * {@link buildLocalCliConfigFromLedger} and the `read*` helpers above: the function was one object
 * literal with six inline fallback ternaries stacked inside it, which is exactly what pushed its
 * cyclomatic/cognitive score over this pass's ceiling. Naming each fallback decision does not change
 * what gets computed, only makes each one independently readable (and, for the `read*` functions,
 * independently testable) instead of one undifferentiated expression.
 */
export function buildByokConfigFromLedger({ byKey, defaults }: { byKey: Map<string, unknown>; defaults: ExecutionConfig }, _optional: Record<string, never> = {}): ByokConfig {
  const rawMaxTokens = byKey.get(KEYS.maxTokens);
  return {
    protocol: readByokProtocol({ raw: byKey.get(KEYS.protocol), fallback: defaults.byok.protocol }),
    providerId: readByokProviderId({ raw: byKey.get(KEYS.providerId), fallback: defaults.byok.providerId }),
    // Write-only — see this file's own doc. Never anything but "", regardless of whether a
    // credential is stored server-side.
    apiKey: "",
    baseUrl: asString({ value: byKey.get(KEYS.baseUrl), fallback: defaults.byok.baseUrl }),
    model: asString({ value: byKey.get(KEYS.model), fallback: defaults.byok.model }),
    ...(typeof rawMaxTokens === "number" && rawMaxTokens !== MAX_TOKENS_UNSET_SENTINEL
      ? { maxTokens: rawMaxTokens }
      : {}),
    // `savedByProviderId` (other providers' drafts) is scoped out of v1 — see this file's
    // header. Never populated; a host storing it would need its own per-provider server rows.
  };
}

/** Builds the `localCli` half of `loadExecutionConfig`'s result from the ledger rows — see
 *  {@link buildByokConfigFromLedger}'s doc for why this is split out the same way. */
export function buildLocalCliConfigFromLedger({ byKey }: { byKey: Map<string, unknown> }, _optional: Record<string, never> = {}): ExecutionConfig["localCli"] {
  const agentId = asString({ value: byKey.get(KEYS.localCliAgentId), fallback: "" }).trim();
  const model = asString({ value: byKey.get(KEYS.localCliModel), fallback: "" }).trim();
  const reasoning = asString({ value: byKey.get(KEYS.localCliReasoning), fallback: "" }).trim();
  return {
    // `""` is the ledger's "nothing picked yet" (a non-null default is
    // required — see `execution-mode-settings.ts`), which `@jini-ai/ui`
    // spells as `null`.
    agentId: agentId ? agentId : null,
    // Only the SELECTED agent's model round-trips through the ledger; see
    // the `localCli.model` definition for why the per-agent map does not.
    ...(agentId && model ? { modelByAgentId: { [agentId]: model } } : {}),
    // The reasoning-effort pick mirrors the model pick exactly — same
    // one-scalar-for-the-selected-agent shape, same per-agent map on the
    // `@jini-ai/ui` side, and the same consequence spelled out in the
    // `localCli.model` definition (a reload restores the selected agent's
    // effort, not every agent's). Both are gated on `agentId` for the same
    // reason: a value with no agent to key it under would otherwise attach
    // to whichever agent is picked next.
    ...(agentId && reasoning ? { reasoningByAgentId: { [agentId]: reasoning } } : {}),
  };
}

/** The model of whichever agent is currently selected — the one value the
 *  ledger persists out of `LocalCliConfig.modelByAgentId`. Returns `""` when
 *  no agent is picked or that agent has no explicit model, which is exactly
 *  the registered default.
 *
 *  Exported (2026-08-05) so `AssistantDock.tsx`'s `useLocalCliSelection` can
 *  derive the SAME value when hydrating the picker's initial selection from
 *  this ledger — re-deriving the per-agent lookup a second time in the
 *  component would be a second copy of `LocalCliConfig.modelByAgentId`'s
 *  "keyed by the selected agent" contract to keep in sync with this one. */
export function selectedLocalCliModel({ config }: { config: ExecutionConfig }, _optional: Record<string, never> = {}): string {
  const agentId = config.localCli.agentId;
  if (!agentId) return "";
  return config.localCli.modelByAgentId?.[agentId] ?? "";
}

/** The reasoning effort of whichever agent is currently selected — the mirror of
 *  {@link selectedLocalCliModel}, and the one value the ledger persists out of
 *  `LocalCliConfig.reasoningByAgentId`. Returns `""` when no agent is picked or that agent has no
 *  explicit effort, which is exactly the registered default.
 *
 *  Only meaningful for a runtime whose CLI takes effort as its OWN flag (`claude --effort`,
 *  codex's `-c model_reasoning_effort=`). A runtime that encodes effort inside the model id
 *  (`reasoningInModelId`; antigravity) never writes here at all — its effort is already part of
 *  `localCli.model`, and storing it twice would create two places to disagree. */
export function selectedLocalCliReasoning({ config }: { config: ExecutionConfig }, _optional: Record<string, never> = {}): string {
  const agentId = config.localCli.agentId;
  if (!agentId) return "";
  return config.localCli.reasoningByAgentId?.[agentId] ?? "";
}

/** Field-level diff so a keystroke in one input writes one revision, not six
 *  — and so the API key never appears in this list at all (see this file's
 *  header, item 2). */
function changedLedgerEntries(
  next: ExecutionConfig,
  previous: ExecutionConfig,
): Array<{ key: string; valueJson: unknown }> {
  const pairs: Array<{ key: string; valueJson: unknown; changed: boolean }> = [
    { key: KEYS.mode, valueJson: next.mode, changed: next.mode !== previous.mode },
    { key: KEYS.protocol, valueJson: next.byok.protocol, changed: next.byok.protocol !== previous.byok.protocol },
    {
      key: KEYS.providerId,
      valueJson: next.byok.providerId,
      changed: next.byok.providerId !== previous.byok.providerId,
    },
    { key: KEYS.baseUrl, valueJson: next.byok.baseUrl, changed: next.byok.baseUrl !== previous.byok.baseUrl },
    { key: KEYS.model, valueJson: next.byok.model, changed: next.byok.model !== previous.byok.model },
    {
      key: KEYS.maxTokens,
      valueJson: next.byok.maxTokens ?? MAX_TOKENS_UNSET_SENTINEL,
      changed: (next.byok.maxTokens ?? MAX_TOKENS_UNSET_SENTINEL) !== (previous.byok.maxTokens ?? MAX_TOKENS_UNSET_SENTINEL),
    },
    {
      key: KEYS.localCliAgentId,
      valueJson: next.localCli.agentId ?? "",
      changed: (next.localCli.agentId ?? "") !== (previous.localCli.agentId ?? ""),
    },
    {
      key: KEYS.localCliModel,
      valueJson: selectedLocalCliModel({ config: next }, {}),
      changed: selectedLocalCliModel({ config: next }, {}) !== selectedLocalCliModel({ config: previous }, {}),
    },
    {
      key: KEYS.localCliReasoning,
      valueJson: selectedLocalCliReasoning({ config: next }, {}),
      changed: selectedLocalCliReasoning({ config: next }, {}) !== selectedLocalCliReasoning({ config: previous }, {}),
    },
  ];
  return pairs.filter((pair) => pair.changed).map(({ key, valueJson }) => ({ key, valueJson }));
}

/**
 * `useSettingsSlice`'s `reconcileRefresh` option for the Execution slice — preserves the operator's
 * in-memory, typed-but-not-yet-explicitly-saved `byok.apiKey` across a `refresh()`-triggered reload.
 *
 * `loadExecutionConfig` always returns `byok.apiKey: ""` (this file's header, item 2 — the server
 * never returns key material), and `refresh()` fires on ANY out-of-band notification — including a
 * same-tab echo of THIS SLICE'S OWN debounced write arriving back over the settings-changed SSE feed
 * (`settings-events.ts`; the host's `server/inbound/admin-http/routes/settings/events.ts` broadcasts to every open
 * connection for the workspace on a ~1s poll, the writer's own tab included, with no self-exclusion).
 *
 * The failure this prevents: an operator types a key, then edits a ledger field (baseUrl, model,
 * ...) in the same 600ms window. The settled debounce calls {@link saveExecutionConfig}, which
 * persists the ledger field and correctly ignores `apiKey`. `refresh()`'s own guards
 * (`use-settings-slice.hooks.ts`) see no pending timer and no unsaved edit once that save resolves —
 * by design, since the edit WAS saved, just not the key half of it — so when the SSE echo of that
 * same write arrives moments later, `refresh()` proceeds and would otherwise overwrite `value` with
 * the reload's `apiKey: ""`, silently discarding the typed key before the operator can reach the
 * explicit "Save key" control. Measured as: type a key, wait ~600ms, and the field goes empty and
 * "Save key" disables itself with no operator action in between.
 *
 * Preserving the in-memory key across every reload is correct precisely because
 * {@link saveExecutionConfig} never persists it in the first place (this file's header, item 2) — a
 * reload can never be "more current" about a field it never wrote or read, so `loaded`'s empty value
 * carries no information worth keeping. Every OTHER `byok`/`localCli`/`mode` field still takes the
 * reload's value unconditionally, same as a slice with no reconciler at all.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function reconcileExecutionConfigRefresh({ current, loaded }: { current: ExecutionConfig; loaded: ExecutionConfig }, _optional: Record<string, never> = {}): ExecutionConfig {
  return { ...loaded, byok: { ...loaded.byok, apiKey: current.byok.apiKey } };
}

/**
 * Reads the non-secret ledger namespace and returns it as an `ExecutionConfig`. Unknown/missing
 * ledger keys fall back to `DEFAULT_EXECUTION_CONFIG` field by field, so a partially written
 * namespace still yields a usable config instead of throwing.
 *
 * `byok.apiKey` is ALWAYS `""` — the key is write-only server-side (this file's header, item 2),
 * so there is nothing to hydrate it with. A caller that needs to know whether a credential is
 * already stored must call {@link loadAdminExecutionCredential} separately and read its `isSet`.
 */
async function loadExecutionConfig(
  { port, defaults, isUnregisteredNamespace }: Pick<Parameters<typeof createExecutionSettingsLedger>[0], "port" | "defaults" | "isUnregisteredNamespace">,
  _optional: Record<string, never> = {},
): Promise<ExecutionConfig> {
  let rows: { key: string; value: unknown }[];
  try {
    rows = await port.getSettingsEffective({ namespace: EXECUTION_NAMESPACE }, {});
  } catch (error) {
    // A namespace with no registered definitions is the expected cold-start
    // state, not an error worth surfacing — fall back to defaults.
    if (isUnregisteredNamespace({ error }, {})) return defaults;
    throw error;
  }

  const byKey = new Map<string, unknown>(rows.map((row) => [row.key, row.value]));
  return {
    mode: readExecutionMode({ raw: byKey.get(KEYS.mode), fallback: defaults.mode }),
    byok: buildByokConfigFromLedger({ byKey, defaults }),
    localCli: buildLocalCliConfigFromLedger({ byKey }),
  };
}

/**
 * Writes only the non-secret ledger fields that actually changed. Returns the ledger keys written,
 * for "saved" UI feedback.
 *
 * Deliberately does NOT touch `next.byok.apiKey` at all, in either direction — no read, no write,
 * no comparison against `previous`. This is the function `useSettingsSlice`'s 600ms debounce calls
 * on every settled edit (`use-settings-slice.hooks.ts`), including a keystroke in the API-key
 * field that changed nothing else — see this file's header, item 2, for why the key must never be
 * reachable from that path. The practical effect: typing into the key field alone produces an
 * empty `changed` list here and writes nothing, which is the SAFE no-op this function's silence on
 * `apiKey` is meant to guarantee, not an oversight. Persisting the key is
 * {@link saveAdminExecutionCredential}'s job, called only from an explicit "Save key" action.
 *
 * All-or-nothing on failure. Each key is its own ledger row and there is no multi-key write, so a
 * rejection part-way through would otherwise leave the rows it already wrote in place — a Local CLI
 * switch writes `localCli.agentId` then `localCli.model`, and a failure between them persists the
 * new agent with the old agent's model. On a rejection this writes each already-written key back to
 * its `previous` value (newest first), then rethrows the ORIGINAL error. The rollback is best-effort:
 * a rollback write that also fails is not reported over the error that caused it.
 *
 * @throws Whatever `api.setSetting` rejected with first.
 * @complexity O(k) sequential writes for k changed keys, plus at most k-1 rollback writes.
 */
async function saveExecutionConfig(
  { next, previous, port, reportRestoreFailure }: { next: ExecutionConfig; previous: ExecutionConfig } & Pick<Parameters<typeof createExecutionSettingsLedger>[0], "port" | "reportRestoreFailure">,
  _optional: Record<string, never> = {},
): Promise<readonly string[]> {
  const changed = changedLedgerEntries(next, previous);
  const written: string[] = [];
  try {
    for (const { key, valueJson } of changed) {
      await port.setSetting({ namespace: EXECUTION_NAMESPACE, key, scope: executionSettingScope({ key }), valueJson }, {});
      written.push(key);
    }
  } catch (error) {
    // Diffed the other way round: the entries `previous` holds for the keys this write changed.
    const restoreTarget = previous;
    const failedWrite = next;
    const previousValues = new Map(changedLedgerEntries(restoreTarget, failedWrite).map((entry) => [entry.key, entry.valueJson]));
    await restoreLedgerKeys({ keys: written, previousValues, port, reportRestoreFailure }, {});
    throw error;
  }
  return changed.map((entry) => entry.key);
}

/** {@link saveExecutionConfig}'s rollback: rewrites `keys`, newest first, with their values in
 *  `previousValues` (built from the reverse diff, which has the same key set as the forward one).
 *  Never rejects. */
async function restoreLedgerKeys(
  { keys, previousValues, port, reportRestoreFailure }: { keys: readonly string[]; previousValues: ReadonlyMap<string, unknown> } & Pick<Parameters<typeof createExecutionSettingsLedger>[0], "port" | "reportRestoreFailure">,
  _optional: Record<string, never> = {},
): Promise<void> {
  for (const key of [...keys].reverse()) {
    if (!previousValues.has(key)) continue;
    await port
      .setSetting({ namespace: EXECUTION_NAMESPACE, key, scope: executionSettingScope({ key }), valueJson: previousValues.get(key) }, {})
      .catch((error: unknown) => reportRestoreFailure({ error }, {}));
  }
}


export function createExecutionSettingsLedger(
  { port, defaults, isUnregisteredNamespace, reportRestoreFailure }: {
    port: {
      getSettingsEffective(required: { namespace: string }, optional?: Record<string, never>): Promise<{ key: string; value: unknown }[]>;
      setSetting(required: { namespace: string; key: string; scope: SettingScope; valueJson: unknown }, optional?: Record<string, never>): Promise<unknown>;
    };
    defaults: ExecutionConfig;
    isUnregisteredNamespace: (required: { error: unknown }, optional?: Record<string, never>) => boolean;
    reportRestoreFailure: (required: { error: unknown }, optional?: Record<string, never>) => void;
  },
  _optional: Record<string, never> = {},
) {
  return {
    loadExecutionConfig: (_required: Record<string, never>, optional: Record<string, never> = {}) => loadExecutionConfig({ port, defaults, isUnregisteredNamespace }, optional),
    saveExecutionConfig: ({ next, previous }: { next: ExecutionConfig; previous: ExecutionConfig }, optional: Record<string, never> = {}) => saveExecutionConfig({ next, previous, port, reportRestoreFailure }, optional),
  };
}
