/**
 * R13 — model-fallback freshness.
 *
 * Some runtime defs ship a hand-written `fallbackModels` array that IS the list a picker renders
 * whenever nothing live answers. `claude` is the clearest case: the CLI has no list-models
 * subcommand, so on an ordinary install (no `~/.config/mms/model-routes.json`, no
 * `ANTHROPIC_API_KEY`) the array in `defs/claude.ts` is the entire model picker.
 *
 * A hand-written list of vendor model ids is stale the day a model ships, and — before this check —
 * *nothing failed when it went stale*. That is the whole bug class: the list drifted from reality
 * for months, no test went red, no gate complained, and it took a human noticing "it doesn't say
 * Fable" to find it. Refreshing the array fixes today's data; this check is what makes the next
 * drift an event instead of a silent decay.
 *
 * ## The three rules
 *
 * **MF1 — a guarded def must declare when its list was last checked against reality.**
 * `RuntimeAgentDef.fallbackModelsAssertedAt` (`YYYY-MM-DD`). A guarded def missing the field, or
 * carrying an unparseable or future date, is a violation. This is what makes deleting the marker
 * fail rather than quietly disable the check.
 *
 * **MF2 — that assertion must not be older than {@link DEFAULT_MAX_AGE_DAYS}.**
 * Needs no credential and no network. It is the backstop that guarantees MF3 actually gets run
 * periodically, because MF3 can only speak when a live source happens to be reachable.
 *
 * **MF3 — when a live source IS reachable, the fallback must not be missing anything it reports.**
 * The direction matters: extra entries in the fallback are fine and deliberate (a superseded model
 * an operator may still be pinned to), a MISSING entry is the defect. This only holds for a def
 * whose fallback list claims to BE the complete rendered picker when nothing live answers:
 *
 *   - `codex` — `codex debug models`, the same probe the def itself uses, parsed by the def's own
 *     `parseCodexDebugModels` so the guard and the runtime can never disagree about what "visible"
 *     means.
 *   - `claude` — `~/.claude.json`'s `additionalModelOptionsCache`, the server-fetched list Claude
 *     Code's own `/model` picker renders. This is the source that already knew about Fable while
 *     the def did not, so it is precisely the signal that was missing.
 *
 * `pi`, `aider`, and `opencode` are guarded for MF1/MF2 only (`liveSource: 'none'`) — their
 * `fallbackModels` are explicitly a small curated safety net ("the most commonly used providers/
 * models", per each def's own comment), not a claim of completeness, so MF3's one-directional rule
 * does not apply. This is not a hypothetical: wiring `opencode-cli models` into MF3 during this
 * guard's own extension immediately produced 306 "missing" entries — that CLI enumerates this
 * installation's entire routed catalog across every configured gateway (cloudflare-ai-gateway,
 * nvidia, opencode-go, …), which is a per-installation routing table, not a vendor-published model
 * list, and will never fit inside a short curated default list. Comparing the two would make the
 * guard permanently and meaninglessly red — exactly the "recurring chore people learn to silence"
 * failure mode {@link DEFAULT_MAX_AGE_DAYS}'s doc warns against. `aider` has no enumerable catalog
 * at all (it proxies to whatever LiteLLM-routed model the user configures). `pi`'s CLI is
 * structurally the same shape (provider/model-routed) as `opencode`'s, so it gets the same
 * treatment rather than waiting to hit the identical false-positive live.
 *
 * ## What it does with no credential, and what it does in CI
 *
 * Nothing here needs an API key. MF3's two sources need a locally installed CLI, not a credential.
 * When a source is unavailable — no `codex` on PATH, no `~/.claude.json`, an unreadable or empty
 * cache — MF3 **skips that def and says so on stdout, naming the def and the reason**. It never
 * passes silently, and it never fails for the absence of a tool. `pi`/`aider`/`opencode` always
 * report an MF3 skip (by design, not by environment) for the reason above. A machine with neither
 * CLI runs MF1 and MF2 only for every guarded def, which is the correct amount of signal for a
 * machine that cannot observe reality.
 *
 * The one way this check goes red without anybody changing code is MF2, on a calendar. That is
 * deliberate and it is the only credential-free way to detect "nobody has compared this list to
 * reality in four months". The remedy is one command and one line: re-run `pnpm guard` on a machine
 * with the CLIs installed, then bump `fallbackModelsAssertedAt`.
 *
 * ## Why it imports the real def instead of scanning its text
 *
 * The array that renders is the thing that must be checked, not a regex's guess at it. The def is
 * loaded at runtime through tsx's loader with a specifier built at runtime, so `tsc` never follows
 * it into `scripts/tsconfig.json`. A shape that no longer matches is reported as a violation rather
 * than silently yielding an empty list — the failure mode a text scan would have had.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type { Violation } from './check-engine-boundaries.js';
import { REPO_ROOT } from './lib/walk-imports.js';

const execFileAsync = promisify(execFile);

const RULE = 'R13-model-fallback-freshness';

/**
 * How long a "checked against reality" assertion is trusted.
 *
 * Generous on purpose. A short threshold turns this into a recurring chore that people learn to
 * silence, which is strictly worse than no gate; a threshold measured in months only fires when the
 * list genuinely has not been looked at across several model launches.
 */
export const DEFAULT_MAX_AGE_DAYS = 120;

const MS_PER_DAY = 86_400_000;

/** A def whose `fallbackModels` array is the rendered list when nothing live answers. */
interface GuardedDef {
  /** `RuntimeAgentDef.id`, for messages. */
  readonly agentId: string;
  /** Repo-relative source file, for the violation's `file`. */
  readonly file: string;
  /** Absolute path the def is loaded from at runtime. */
  readonly modulePath: string;
  /** Exported name of the def literal in that module. */
  readonly exportName: string;
  /** Which live source MF3 should consult for this def. `'none'` means MF3 does not apply — either
   *  no credential-free enumerable catalog exists, or (see module doc) the fallback list is a
   *  curated safety net rather than a claim of completeness — and only MF1/MF2 apply. */
  readonly liveSource: 'codex-catalog' | 'claude-code-picker-cache' | 'none';
}

const GUARDED_DEFS: readonly GuardedDef[] = [
  {
    agentId: 'claude',
    file: 'packages/agent-runtime/src/defs/claude.ts',
    modulePath: join(REPO_ROOT, 'packages/agent-runtime/src/defs/claude.ts'),
    exportName: 'claudeAgentDef',
    liveSource: 'claude-code-picker-cache',
  },
  {
    agentId: 'codex',
    file: 'packages/agent-runtime/src/defs/codex.ts',
    modulePath: join(REPO_ROOT, 'packages/agent-runtime/src/defs/codex.ts'),
    exportName: 'codexAgentDef',
    liveSource: 'codex-catalog',
  },
  {
    agentId: 'pi',
    file: 'packages/agent-runtime/src/defs/pi.ts',
    modulePath: join(REPO_ROOT, 'packages/agent-runtime/src/defs/pi.ts'),
    exportName: 'piAgentDef',
    liveSource: 'none',
  },
  {
    agentId: 'aider',
    file: 'packages/agent-runtime/src/defs/aider.ts',
    modulePath: join(REPO_ROOT, 'packages/agent-runtime/src/defs/aider.ts'),
    exportName: 'aiderAgentDef',
    liveSource: 'none',
  },
  {
    agentId: 'opencode',
    file: 'packages/agent-runtime/src/defs/opencode.ts',
    modulePath: join(REPO_ROOT, 'packages/agent-runtime/src/defs/opencode.ts'),
    exportName: 'opencodeAgentDef',
    liveSource: 'none',
  },
];

/** What a live source had to say. `skipped` is a first-class outcome, never folded into "no ids". */
export type LiveProbe =
  | { readonly kind: 'ids'; readonly ids: readonly string[] }
  | { readonly kind: 'skipped'; readonly reason: string };

export interface FallbackFreshnessOptions {
  /** Override the guarded set — the self-test injects fixtures here. */
  readonly guarded?: readonly GuardedDef[];
  /** Injectable clock so MF2 is testable without waiting four months. */
  readonly now?: Date;
  readonly maxAgeDays?: number;
  /** Injectable live-source probe, so the self-test can drive MF3 without a CLI. */
  readonly probeLive?: (target: GuardedDef) => Promise<LiveProbe>;
  /** Where the skip/consulted lines go. Silenced by the self-test. */
  readonly report?: (line: string) => void;
}

/** The two fields this check reads off a loaded def, validated at runtime. */
interface LoadedDef {
  readonly fallbackIds: readonly string[];
  readonly assertedAt: string | undefined;
}

function violation(target: GuardedDef, reason: string): Violation {
  return { rule: RULE, file: target.file, reason };
}

/**
 * Loads a def's guarded fields out of its real source module.
 *
 * @returns The fields, or a `Violation` describing exactly which expectation the module failed —
 * never a silent empty list, which would make every downstream rule vacuously pass.
 */
async function loadDef(target: GuardedDef): Promise<LoadedDef | Violation> {
  let mod: Record<string, unknown>;
  try {
    // Runtime-built specifier: tsx resolves it, and `tsc` cannot follow a non-literal import, so
    // this package's source never enters scripts/tsconfig.json's program.
    mod = (await import(pathToFileURL(target.modulePath).href)) as Record<string, unknown>;
  } catch (err) {
    return violation(target, `could not load the def module (${(err as Error).message})`);
  }
  const def = mod[target.exportName] as { fallbackModels?: unknown; fallbackModelsAssertedAt?: unknown } | undefined;
  if (!def || typeof def !== 'object') {
    return violation(target, `module does not export \`${target.exportName}\` — this check can no longer see the list it guards`);
  }
  if (!Array.isArray(def.fallbackModels)) {
    return violation(target, '`fallbackModels` is not an array — this check can no longer see the list it guards');
  }
  const fallbackIds = def.fallbackModels
    .map((model) => (model && typeof model === 'object' ? (model as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string');
  const assertedAt = typeof def.fallbackModelsAssertedAt === 'string' ? def.fallbackModelsAssertedAt : undefined;
  return { fallbackIds, assertedAt };
}

/**
 * MF1 + MF2 over one def's staleness marker.
 *
 * @returns The parsed assertion date, or the violations that stopped it being usable.
 */
function checkAssertion(
  target: GuardedDef,
  assertedAt: string | undefined,
  now: Date,
  maxAgeDays: number,
): { date: Date } | { violations: Violation[] } {
  if (!assertedAt) {
    return {
      violations: [
        violation(
          target,
          'missing `fallbackModelsAssertedAt` — a hardcoded model list must record the date it was' +
            ' last checked against the vendor, or its going stale is undetectable',
        ),
      ],
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(assertedAt)) {
    return { violations: [violation(target, `\`fallbackModelsAssertedAt\` is not a YYYY-MM-DD date: ${assertedAt}`)] };
  }
  const date = new Date(`${assertedAt}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return { violations: [violation(target, `\`fallbackModelsAssertedAt\` is not a real date: ${assertedAt}`)] };
  }
  const ageDays = Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
  if (ageDays < 0) {
    return { violations: [violation(target, `\`fallbackModelsAssertedAt\` is in the future: ${assertedAt}`)] };
  }
  if (ageDays > maxAgeDays) {
    const remedy =
      target.liveSource === 'none'
        ? 'Manually re-check the list against the vendor/LiteLLM docs, then bump the date.'
        : `Re-run \`pnpm guard\` on a machine with the ${target.agentId} CLI installed so rule MF3 can` +
          ' compare the list against the vendor, then bump the date.';
    return {
      violations: [
        violation(target, `\`fallbackModelsAssertedAt\` is ${ageDays} days old (limit ${maxAgeDays}). ${remedy}`),
      ],
    };
  }
  return { date };
}

/** The CLI's own full `/model` picker list — built-in models plus the server's extras — via the
 *  same credential-free stream-json `initialize` handshake `claude-code-models.ts#loadClaudeCodeModels`
 *  uses at runtime (it falls back to the `~/.claude.json` cache file internally when that handshake
 *  is unavailable). Loaded the same runtime-specifier way as the def, so the guard and the runtime
 *  cannot disagree. Passing an EMPTY fallback list makes the merged result equal to the live ids
 *  alone, which is what MF3's drift check needs. */
async function probeClaudeCodePickerCache(): Promise<LiveProbe> {
  const mod = (await import(pathToFileURL(join(REPO_ROOT, 'packages/agent-runtime/src/claude-code-models.ts')).href)) as {
    loadClaudeCodeModels?: (bin: string, env: NodeJS.ProcessEnv, fallbackModels: readonly unknown[]) => Promise<readonly { id: string }[] | null>;
  };
  if (!mod.loadClaudeCodeModels) {
    return { kind: 'skipped', reason: '`loadClaudeCodeModels` is no longer exported by claude-code-models.ts' };
  }
  const live = await mod.loadClaudeCodeModels('claude', process.env, []);
  if (!live || live.length === 0) {
    return { kind: 'skipped', reason: 'no readable ~/.claude.json and the CLI initialize handshake found nothing (Claude Code not installed/usable here)' };
  }
  return { kind: 'ids', ids: live.map((m) => m.id) };
}

/** The Codex catalog, parsed by the def's OWN parser so the guard and the runtime cannot disagree
 *  about which entries are visible. */
async function probeCodexCatalog(): Promise<LiveProbe> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('codex', ['debug', 'models'], { maxBuffer: 8 * 1024 * 1024 }));
  } catch (err) {
    return { kind: 'skipped', reason: `\`codex debug models\` unavailable (${(err as Error).message.split('\n')[0]})` };
  }
  const mod = (await import(pathToFileURL(join(REPO_ROOT, 'packages/agent-runtime/src/defs/codex.ts')).href)) as {
    parseCodexDebugModels?: (out: string) => { id: string }[] | null;
  };
  const parsed = mod.parseCodexDebugModels?.(stdout);
  if (!parsed) return { kind: 'skipped', reason: '`codex debug models` returned an unparseable catalog' };
  // `default` is a synthetic sentinel the parser prepends, not a vendor model id.
  const ids = parsed.map((m) => m.id).filter((id) => id !== 'default');
  return ids.length > 0 ? { kind: 'ids', ids } : { kind: 'skipped', reason: 'the Codex catalog listed no visible models' };
}

async function defaultProbeLive(target: GuardedDef): Promise<LiveProbe> {
  switch (target.liveSource) {
    case 'codex-catalog':
      return probeCodexCatalog();
    case 'claude-code-picker-cache':
      return probeClaudeCodePickerCache();
    case 'none':
      // See the module doc's MF3 section: either no credential-free enumerable catalog exists
      // (`aider`), or the fallback is a curated safety net rather than a claim of completeness
      // (`pi`, `opencode`) — either way MF3 does not apply and only MF1/MF2 (staleness date) do.
      return { kind: 'skipped', reason: `MF3 does not apply to \`${target.agentId}\` — only MF1/MF2 (staleness date) apply` };
  }
}

/**
 * MF3 for one def: every id the live source reports must appear in the fallback list.
 *
 * One-directional on purpose — extra fallback entries are deliberate (a superseded model an operator
 * may still be pinned to), a missing one is the defect.
 */
function checkDrift(target: GuardedDef, fallbackIds: readonly string[], probe: LiveProbe, report: (line: string) => void): Violation[] {
  if (probe.kind === 'skipped') {
    report(`[guard] ${RULE} ${target.agentId}: MF3 SKIPPED — ${probe.reason}. Staleness date still enforced (MF1/MF2).`);
    return [];
  }
  const known = new Set(fallbackIds);
  const missing = probe.ids.filter((id) => !known.has(id));
  report(`[guard] ${RULE} ${target.agentId}: MF3 compared ${probe.ids.length} live id(s) against ${fallbackIds.length} fallback entr(ies).`);
  if (missing.length === 0) return [];
  return [
    violation(
      target,
      `fallbackModels is missing ${missing.length} model(s) the live ${target.liveSource} reports: ${missing.join(', ')}.` +
        ' Add them (keeping the existing entries) and bump `fallbackModelsAssertedAt`.',
    ),
  ];
}

/** Applies the defaults in one place so {@link checkModelFallbackFreshness} stays a readable loop —
 *  each `??` is a branch, and five of them plus the loop is over this repo's complexity ceiling. */
function resolveOptions(options: FallbackFreshnessOptions): Required<FallbackFreshnessOptions> {
  return {
    guarded: options.guarded ?? GUARDED_DEFS,
    now: options.now ?? new Date(),
    maxAgeDays: options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
    probeLive: options.probeLive ?? defaultProbeLive,
    report: options.report ?? ((line: string) => console.log(line)),
  };
}

/**
 * Runs MF1/MF2/MF3 across every guarded def.
 *
 * @returns Every violation found; an empty array means each guarded list carries a fresh assertion
 * AND matched whichever live sources were reachable. Reachability is reported on stdout either way,
 * so "no violations" is never mistakable for "nothing was checked".
 * @complexity O(d·(f + l)) over d guarded defs, their f fallback entries and l live ids, plus one
 * subprocess / one file read per def whose live source is available.
 */
export async function checkModelFallbackFreshness(options?: FallbackFreshnessOptions): Promise<Violation[]> {
  const { guarded, now, maxAgeDays, probeLive, report } = resolveOptions(options ?? {});

  const violations: Violation[] = [];
  for (const target of guarded) {
    const loaded = await loadDef(target);
    if ('rule' in loaded) {
      violations.push(loaded);
      continue;
    }
    const assertion = checkAssertion(target, loaded.assertedAt, now, maxAgeDays);
    if ('violations' in assertion) violations.push(...assertion.violations);
    violations.push(...checkDrift(target, loaded.fallbackIds, await probeLive(target), report));
  }
  return violations;
}
