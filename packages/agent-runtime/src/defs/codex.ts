/**
 * Ported from OD's `apps/daemon/src/runtimes/defs/codex.ts` with one
 * de-branding change: the two operator-override env vars (originally
 * product-prefixed) are renamed to `CODEX_SANDBOX_MODE` /
 * `CODEX_DISABLE_PLUGINS` — these are already codex-adapter-scoped
 * operator knobs, so no product namespacing is needed. See
 * `source-map.md` for the exact original names.
 */
import { DEFAULT_MODEL_OPTION, clampCodexReasoning } from './shared.js';
import type { RuntimeModelOption, RuntimeReasoningOption } from '../types.js';
import type { RuntimeAgentDef } from '../types.js';

/**
 * The `visibility` values that mean "reachable by id, but do not render in a picker".
 *
 * A SET rather than one literal, because the vendor has demonstrably used more than one spelling of
 * this single state: the shipped Codex catalog says `hide` (verified live against
 * `codex debug models` 0.153.4 — `gpt-reserve` and `codex-auto-review` both carry it), while this
 * adapter was originally written against `hidden`. Matching only one of them let every `hide` entry
 * render in the Local-CLI model picker. Being permissive on input costs nothing here — no real
 * catalog value is a cased or padded variant of a DIFFERENT visibility state — and it means a third
 * spelling does not silently reopen the same hole.
 */
const HIDDEN_MODEL_VISIBILITIES: ReadonlySet<string> = new Set(['hide', 'hidden']);

function isHiddenVisibility(visibility: unknown): boolean {
  return typeof visibility === 'string' && HIDDEN_MODEL_VISIBILITIES.has(visibility.trim().toLowerCase());
}

type CodexCatalogEntry = {
  slug?: unknown;
  id?: unknown;
  display_name?: unknown;
  name?: unknown;
  visibility?: unknown;
  supported_reasoning_levels?: unknown;
};

/**
 * Display labels for the effort levels, keyed by the catalog's own `effort` token.
 *
 * Spelled out rather than derived by capitalizing, because `xhigh` renders as `XHigh` — the exact
 * casing the static `reasoningOptions` list below already used, so a live-derived list and a
 * fallback list read identically in the picker. Unknown tokens (a level the vendor adds tomorrow)
 * fall through to a capitalize, which is right often enough and is never worse than dropping the
 * level entirely.
 */
const CODEX_EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium',
  high: 'High', xhigh: 'XHigh', max: 'Max', ultra: 'Ultra',
};

function codexEffortLabel(effort: string): string {
  return CODEX_EFFORT_LABELS[effort] ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

/** Accepts both catalog spellings of a level: the `{ effort, description }` object the live 0.153.x
 *  catalog emits, and a bare string (the shape an older/simpler catalog could use). */
function codexEffortToken(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object') {
    const effort = (raw as { effort?: unknown }).effort;
    if (typeof effort === 'string') return effort.trim();
  }
  return '';
}

/**
 * Reads one catalog entry's `supported_reasoning_levels` into picker options.
 *
 * @returns The levels in catalog order, de-duplicated; `undefined` when the entry declares none, so
 * the model row simply omits the field rather than claiming "supports no effort levels".
 * @complexity O(n) in the entry's declared level count.
 */
function parseCodexEntryReasoning(raw: unknown): RuntimeReasoningOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: RuntimeReasoningOption[] = [];
  for (const level of raw) {
    const effort = codexEffortToken(level);
    if (!effort || seen.has(effort)) continue;
    seen.add(effort);
    out.push({ id: effort, label: codexEffortLabel(effort) });
  }
  return out.length > 0 ? out : undefined;
}

function codexEntryId(entry: CodexCatalogEntry): string {
  if (typeof entry.slug === 'string') return entry.slug.trim();
  if (typeof entry.id === 'string') return entry.id.trim();
  return '';
}

function codexEntryLabel(entry: CodexCatalogEntry, id: string): string {
  if (typeof entry.display_name === 'string' && entry.display_name.trim()) return entry.display_name.trim();
  if (typeof entry.name === 'string' && entry.name.trim()) return entry.name.trim();
  return id;
}

/** JSON-decodes `codex debug models` stdout down to its `models` array, or `null` for any shape
 *  that isn't one. Split out of `parseCodexDebugModels` so that function stays a single readable
 *  loop over already-validated input. */
function readCodexCatalogEntries(stdout: string): unknown[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(stdout || ''));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const models = (parsed as { models?: unknown }).models;
  return Array.isArray(models) ? models : null;
}

/**
 * Parses `codex debug models` stdout into the Local-CLI picker's model rows.
 *
 * Each row carries the model's OWN supported effort levels when the catalog reports them — see
 * `RuntimeModelOption.reasoning`. Hidden entries are dropped (see `isHiddenVisibility`).
 *
 * @returns The rows, `default` sentinel first; `null` when the output is unparseable or yielded no
 * model at all, which is `detection.ts#fetchModels`'s signal to keep the static fallback list.
 * @complexity O(n·m) — one pass over n catalog entries, each with m declared effort levels.
 */
/** One catalog entry as a picker row, or `null` when it is malformed, hidden, id-less, or a repeat
 *  of an id already taken. Split from the loop below purely to keep both units small. */
function codexCatalogRow(raw: unknown, takenIds: ReadonlySet<string>): RuntimeModelOption | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as CodexCatalogEntry;
  if (isHiddenVisibility(entry.visibility)) return null;
  const id = codexEntryId(entry);
  if (!id || takenIds.has(id)) return null;
  const reasoning = parseCodexEntryReasoning(entry.supported_reasoning_levels);
  return { id, label: codexEntryLabel(entry, id), ...(reasoning ? { reasoning } : {}) };
}

export function parseCodexDebugModels(stdout: string): RuntimeModelOption[] | null {
  const models = readCodexCatalogEntries(stdout);
  if (!models) return null;

  const out = [DEFAULT_MODEL_OPTION];
  const seen = new Set<string>([DEFAULT_MODEL_OPTION.id]);
  for (const raw of models) {
    const row = codexCatalogRow(raw, seen);
    if (!row) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out.length > 1 ? out : null;
}

/**
 * Collapses the per-model effort levels on a fetched model list into the single agent-level list a
 * picker renders, in first-seen catalog order, behind the `default` sentinel.
 *
 * A UNION rather than an intersection: the alternative would offer only the levels EVERY model
 * supports, which on the live 0.153.4 catalog is `low..xhigh` — precisely the truncated list this
 * exists to replace, since `gpt-5.5` would veto `max`/`ultra` for `gpt-6-astra`. Over-offering is
 * the same failure mode the previous hardcoded list already had (it listed `none`/`minimal`, which
 * no catalog model supports), so this is strictly better; narrowing the offer per SELECTED model is
 * a picker-side concern, and the data for it rides along on each row's `reasoning` field.
 *
 * @param models - A fetched model list; rows without `reasoning` contribute nothing.
 * @returns The union, or `null` when no row carried levels — the caller's signal to keep its own
 * static list rather than replace it with an empty one.
 * @complexity O(n·m) over n models and their m levels.
 */
export function unionModelReasoningOptions(
  models: readonly RuntimeModelOption[],
): RuntimeReasoningOption[] | null {
  const seen = new Set<string>();
  const out: RuntimeReasoningOption[] = [];
  for (const model of models) {
    for (const level of model.reasoning ?? []) {
      if (seen.has(level.id)) continue;
      seen.add(level.id);
      out.push(level);
    }
  }
  return out.length > 0 ? [{ id: 'default', label: 'Default' }, ...out] : null;
}

export function codexNeedsDangerFullAccessSandbox(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Operator override for deployments where Codex cannot create its
  // workspace-write sandbox, for example unprivileged Linux containers.
  // Only danger-full-access is accepted; unknown values keep the default path.
  if (env.CODEX_SANDBOX_MODE?.trim() === 'danger-full-access') return true;
  if (platform === 'win32') return true;
  // WSL reports `linux` but Codex still hits the Windows read-only
  // workspace-write sandbox path when launched from there.
  return Boolean(env.WSL_DISTRO_NAME?.trim());
}

export const codexAgentDef = {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    versionArgs: ['--version'],
    // Codex exposes its installed model catalog through `debug models` on
    // recent CLIs. Older builds fall back to these static hints.
    listModels: {
      args: ['debug', 'models'],
      parse: parseCodexDebugModels,
      timeoutMs: 5000,
    },
    authProbe: {
      args: ['login', 'status'],
      timeoutMs: 5000,
    },
    // The OLD-CLI path: a Codex build new enough to answer `debug models` never renders this list.
    // Kept current anyway — a stale fallback is invisible until the day the catalog probe fails, and
    // that is the worst moment to discover it. Current entries first, superseded ones kept below
    // rather than dropped.
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'gpt-6-astra', label: 'gpt-6-astra' },
      { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol' },
      { id: 'gpt-5.6-terra', label: 'gpt-5.6-terra' },
      { id: 'gpt-5.6-luna', label: 'gpt-5.6-luna' },
      { id: 'gpt-5.5', label: 'gpt-5.5' },
      { id: 'gpt-5.4', label: 'gpt-5.4' },
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
      { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
      // Found by the freshness guard (R13/MF3) against an older Codex install's BUNDLED catalog:
      // codex-cli 0.140.0 lists gpt-5.2 as visible when it cannot reach the backend, which is
      // exactly the population this fallback list serves.
      { id: 'gpt-5.2', label: 'gpt-5.2' },
      { id: 'gpt-5.1', label: 'gpt-5.1' },
      { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
      { id: 'gpt-5-codex', label: 'gpt-5-codex' },
      { id: 'gpt-5', label: 'gpt-5' },
      { id: 'o3', label: 'o3' },
      { id: 'o4-mini', label: 'o4-mini' },
    ],
    // Asserted against a live `codex debug models` run (codex-cli 0.153.4). See
    // `RuntimeAgentDef.fallbackModelsAssertedAt` and `scripts/check-model-fallback-freshness.ts`.
    fallbackModelsAssertedAt: '2026-09-05',
    // The OLD-CLI path only. A Codex build new enough to answer `debug models` gets its effort list
    // derived from that catalog instead (see `deriveReasoningOptions` below), which is what makes
    // `max` and `ultra` reachable. This list is deliberately NOT widened to match: it is what a build
    // too old to have a catalog gets, and `none`/`minimal` — which no model in the current catalog
    // supports — are exactly the levels such a build did accept. `clampCodexReasoning` still maps
    // `minimal` to `low` for the late GPT-5 families.
    reasoningOptions: [
      { id: 'default', label: 'Default' },
      { id: 'none', label: 'None' },
      { id: 'minimal', label: 'Minimal' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'XHigh' },
    ],
    // Replaces the list above whenever the live catalog actually reported per-model levels. See
    // `RuntimeAgentDef.deriveReasoningOptions` for the contract and `unionModelReasoningOptions` for
    // why a union and not an intersection.
    deriveReasoningOptions: unionModelReasoningOptions,
    // Prompt is delivered via stdin pipe (gated by `promptViaStdin: true`
    // below) to avoid Windows `spawn ENAMETOOLONG` while keeping Codex on
    // its structured JSON stream. Recent Codex CLI versions reject a bare
    // `-` argv sentinel — passing both the pipe and `-` produces
    // `error: unexpected argument '-' found` and the agent exits with
    // code 2 before any prompt is read. The pipe alone is sufficient for
    // stdin delivery.
    buildArgs: (
      _prompt,
      imagePaths,
      extraAllowedDirs = [],
      options = {},
      runtimeContext = {},
    ) => {
      // Codex CLI's `workspace-write` sandbox blocks shell invocations on
      // Windows ("powershell.exe ... rejected: blocked by policy"),
      // because Codex has no working OS-level sandbox on Windows and falls
      // back to a coarse policy that rejects any shell. macOS (Seatbelt)
      // and Linux (Landlock+seccomp) keep workspace-write because their
      // sandbox enforcement permits shell while restricting writes.
      const needsDangerFullAccess = codexNeedsDangerFullAccessSandbox();
      // Capture-style resume: when the caller has a stored Codex thread id
      // for this conversation it asks the CLI to continue that session
      // with `exec resume <thread_id>` instead of `exec` (a fresh
      // session). Codex mints its own id, so the caller does not specify
      // one — it captures the id from the create turn's
      // `thread.started.thread_id` event (see the json-event-stream
      // `codex` parser) and replays it here on resume.
      const resumeSessionId =
        typeof runtimeContext.resumeSessionId === 'string' &&
        runtimeContext.resumeSessionId.length > 0
          ? runtimeContext.resumeSessionId
          : null;
      // `codex exec resume` rejects `--sandbox` (only valid on a fresh
      // `exec`); the sandbox mode must be passed as a `-c sandbox_mode=...`
      // config override. We mirror the exact same effective sandbox policy as
      // the create turn so Codex's per-turn `turn_context` block byte-matches
      // across turns and does not break the upstream prefix cache the resume
      // is meant to reuse.
      const sandboxArgs = needsDangerFullAccess
        ? resumeSessionId
          ? ['-c', 'sandbox_mode="danger-full-access"']
          : ['--sandbox', 'danger-full-access']
        : resumeSessionId
          ? [
              '-c',
              'sandbox_mode="workspace-write"',
              '-c',
              'sandbox_workspace_write.network_access=true',
            ]
          : [
              '--sandbox',
              'workspace-write',
              '-c',
              'sandbox_workspace_write.network_access=true',
            ];
      const args = resumeSessionId
        ? ['exec', 'resume', '--json', '--skip-git-repo-check', ...sandboxArgs]
        : ['exec', '--json', '--skip-git-repo-check', ...sandboxArgs];
      if (process.env.CODEX_DISABLE_PLUGINS === '1') {
        args.push('--disable', 'plugins');
      }
      // `-C <cwd>` and `--add-dir <dir>` are CREATE-only flags: `codex exec
      // resume` rejects both (`error: unexpected argument '-C' found`), so
      // appending them on a resume turn would make the follow-up turn die
      // before the first event. The caller already spawns the child with
      // `cwd: effectiveCwd`, and resuming by explicit SESSION_ID does not
      // use codex's cwd-based session filtering, so the resumed turn still
      // runs in the right workspace without `-C`. The extra writable dirs
      // were granted when the session was created and are carried by the
      // resumed session.
      if (!resumeSessionId) {
        if (runtimeContext.cwd) {
          args.push('-C', runtimeContext.cwd);
        }
        const dirs = (extraAllowedDirs || []).filter(
          (d) => typeof d === 'string' && d.length > 0,
        );
        for (const d of dirs) {
          args.push('--add-dir', d);
        }
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      if (options.reasoning && options.reasoning !== 'default') {
        const effort = clampCodexReasoning(options.model, options.reasoning);
        // Codex accepts `-c key=value` config overrides; reasoning effort
        // is exposed as `model_reasoning_effort`.
        args.push('-c', `model_reasoning_effort="${effort}"`);
      }
      // Own dedicated `-i/--image <FILE>` argv flag — confirmed against a
      // real installed Codex CLI (0.151.0) on BOTH `codex exec --help` and
      // `codex exec resume --help`, so unlike `-C`/`--add-dir` above this is
      // not create-only and needs no `resumeSessionId` guard. Pushed for
      // every claimed attachment path the caller hands in here, not only
      // ones actually of kind "image": the caller
      // (`agent-daemon-server.ts#resolveAttachmentRunFields`, in the consuming product) already
      // stopped filtering by kind for the same reason `qoderAgentDef`'s
      // `--attachment` above does not filter either — a same-shaped
      // repeated-flag mechanism, see `imageDelivery`'s doc below.
      const attachments = (imagePaths || []).filter(
        (p) => typeof p === 'string' && p.length > 0,
      );
      for (const p of attachments) {
        args.push('-i', p);
      }
      // The resume thread id is the positional SESSION_ID argument of
      // `codex exec resume`; it must come after the flags. The prompt is
      // delivered via stdin (promptViaStdin), so the thread id is the final
      // argv entry.
      if (resumeSessionId) {
        args.push(resumeSessionId);
      }
      return args;
    },
    promptViaStdin: true,
    // Codex's CLI carries its own session across spawns: on a follow-up turn
    // the caller resumes the captured thread id instead of re-sending the
    // flattened transcript, so the first upstream call reuses the warm prefix
    // cache. Capture-style: the resume handle is the `thread.started.thread_id`
    // captured from the stream, not a caller-minted id.
    resumesSessionViaCli: true,
    capturesSessionIdFromStream: true,
    streamFormat: 'json-event-stream',
    eventParser: 'codex',
    // Own dedicated `-i/--image <FILE>` argv flag, built above — a real
    // native CLI mechanism, not a workaround. See
    // `types.ts#RuntimeAgentDef.imageDelivery`'s doc. Before this, no
    // `imageDelivery` was declared at all, which per that field's own
    // `undefined` doc means "images are silently dropped exactly as they
    // were previously" — confirmed live: `buildArgs` never read the paths,
    // and no other def-specific mechanism named them to the model either.
    imageDelivery: 'native',
    // `'codex-toml'`: Codex CLI's native MCP config is a `[mcp_servers.<name>]` TOML table under
    // `CODEX_HOME` (`~/.codex/config.toml` by default) — TOML, not the JSON any of the other four
    // wired strategies produce, and `codex mcp add`/`-c mcp_servers.<name>...=` both write to (or
    // resolve against) the OPERATOR'S REAL global config, which this driver must never touch on a
    // routine agent spawn.
    //
    // Confirmed against a real installed Codex CLI (0.151.0), not assumed from docs:
    //   - `codex mcp add`/`codex mcp list` against a scratch `CODEX_HOME` round-tripped the exact
    //     `[mcp_servers.<name>]` / `command` / `args` / `[mcp_servers.<name>.env]` TOML shape
    //     `@jini-ai/daemon`'s `buildCodexMcpServerToml` now serializes.
    //   - Relocating `CODEX_HOME` (env var) to a fresh scratch directory containing a copied
    //     `auth.json` plus a `config.toml` carrying `[mcp_servers.jini]` produced a normal, fast
    //     `codex exec --json` turn — no interactive trust prompt, no hang. `-C` pointing at an
    //     unrelated, untrusted project directory under `--skip-git-repo-check` behaved identically:
    //     headless `codex exec` never blocks on the "trust this project" prompt that gates
    //     *auto-discovered* project `.codex/config.toml` (the exact hazard that ruled out
    //     `claude-mcp-json`'s auto-discovery-based approach for Claude) — it silently records the
    //     directory as trusted and proceeds.
    //   - A scratch `CODEX_HOME` with **no** `auth.json` at all does not hang either: the spawned
    //     CLI fails fast with a structured `turn.failed` stream event carrying a real `401
    //     Unauthorized`, after a bounded handful of reconnect attempts (~20s) — never an interactive
    //     login prompt. This is why `prepareCodexHomeForRun`'s `auth.json` copy is allowed to be
    //     best-effort: a missing/unreadable source credential degrades to an observable run failure,
    //     never a stuck run.
    //   - Using the REAL `CODEX_HOME` at all — even read-only via `-c` override flags, never writing
    //     through `codex mcp add` — was rejected after live testing showed every `codex exec`
    //     invocation appends a `[projects."<cwd>"]` trust-tracking entry to the real
    //     `~/.codex/config.toml` as an undocumented side effect of being run at all, regardless of
    //     `-c` flags. A relocated, run-scoped `CODEX_HOME` (this strategy) is the only mechanism
    //     that keeps the operator's real config untouched by routine daemon spawns.
    //
    // See `@jini-ai/daemon`'s `agent-executor.ts` (`prepareCodexHomeForRun`, `buildCodexHomeConfigToml`)
    // for the staging/cleanup implementation and `source-map.md` for the full verification transcript.
    externalMcpInjection: 'codex-toml',
} satisfies RuntimeAgentDef;
