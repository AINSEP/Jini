import { createAgentModelDiscovery } from '../model-discovery-native.js';
import { DEFAULT_MODEL_OPTION } from './shared.js';
import { agentCapabilities } from '../capabilities.js';
import type { RuntimeAgentDef, RuntimeBuildOptions, RuntimeModelOption } from '../types.js';

/** One `<id>` or `<id> - <label>` listing line; header lines and non-id lines yield null. */
function parseCursorAgentModelLine(line: string): RuntimeModelOption | null {
  if (/^(available models|models)$/i.test(line)) return null;
  const match = line.match(/^([A-Za-z0-9][A-Za-z0-9._/:@-]*)(?:\s+-\s+(\S.*))?$/);
  if (!match) return null;
  // The id group is mandatory and non-empty whenever the pattern matched.
  const id = match[1] as string;
  return { id, label: match[2]?.trim() || id };
}

export function parseCursorAgentModels({ stdout }: { stdout: string }): RuntimeModelOption[] | null {
  const lines = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const out = [DEFAULT_MODEL_OPTION];
  const seen = new Set<string>([DEFAULT_MODEL_OPTION.id]);
  for (const line of lines) {
    const model = parseCursorAgentModelLine(line);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }

  return out.length > 1 ? out : null;
}

// `cursor-agent models` prints account-bound model ids per line. When
// the user isn't authed it prints "No models available for this
// account." — that's not a model list, so we detect it and fall back.
function parseCursorAgentListing({ stdout }: { stdout: string }): RuntimeModelOption[] | null {
  const trimmed = String(stdout || '').trim();
  if (!trimmed || /no models available/i.test(trimmed)) return null;
  return parseCursorAgentModels({ stdout: trimmed });
}

/** Approval flags: `--force` always, `--trust` only when this build's `--help` probe saw it. */
function bypassArgs(options: RuntimeBuildOptions): string[] {
  // See `RuntimeBuildOptions.permissionMode`'s doc: bypass is the default
  // (unchanged behavior) unless a caller explicitly opts into a restricted
  // run. Both flags below are auto-approval, so both are gated on it —
  // `--force` bypasses the per-action prompt and `--trust` pre-grants the
  // workspace trust that same prompt would otherwise ask for, so omitting
  // only one of them would still hand the run most of what it asked to
  // withhold.
  if (options.permissionMode === 'restricted') return [];
  const caps = (options.capabilities ?? agentCapabilities.get('cursor-agent')) || {};
  // `--trust` grants workspace trust in headless runs, but only newer
  // cursor-agent builds accept it; older ones exit 1 with "unknown option"
  // (issue #4461). Pass it only when the `--help` probe saw it.
  return caps.trust ? ['--force', '--trust'] : ['--force'];
}

export const cursorAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('cursor-agent', { fallbackModels: (): readonly import('../types.js').RuntimeModelOption[] => cursorAgentDef.fallbackModels, args: ['models'], parse: parseCursorAgentListing }),
    id: 'cursor-agent',
    name: 'Cursor Agent',
    bin: 'cursor-agent',
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    capabilityFlags: {
      // Flag string -> capability key. After probing `--help`, detection sets
      // `agentCapabilities['cursor-agent'][key] = true` for each substring it
      // finds. `--trust` is only honored in `-p`/headless mode and only exists
      // on newer cursor-agent builds; older installs reject it with
      // "unknown option '--trust'" and exit 1, which kills Test and task
      // execution (issue #4461). Gate on the probe like claude/codebuddy do.
      '--trust': 'trust',
    },
    // See `parseCursorAgentListing` for the unauthenticated "No models available" fallback.
    listModels: {
      args: ['models'],
      timeoutMs: 5000,
      parse: parseCursorAgentListing,
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'auto', label: 'auto' },
      { id: 'sonnet-4', label: 'sonnet-4' },
      { id: 'sonnet-4-thinking', label: 'sonnet-4-thinking' },
      { id: 'gpt-5', label: 'gpt-5' },
    ],
    // Cursor Agent does not use `-` as a "read prompt from stdin" sentinel.
    // Passing it makes the CLI treat the dash as the literal user prompt,
    // which then surfaces as "your message only contains '-'". Keep stdin
    // piped for prompt delivery, but do not append a fake prompt arg.
    buildArgs: (_requiredArgs, { options = {}, runtimeContext = {} } = {}) => [
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      ...bypassArgs(options),
      ...(runtimeContext.cwd ? ['--workspace', runtimeContext.cwd] : []),
      ...(options.model && options.model !== 'default' ? ['--model', options.model] : []),
    ],
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'cursor-agent',
    // `cursor-agent status` is a cheap, side-effect-free auth check. Declaring
    // it here is what makes detection surface an "auth required" badge for
    // Cursor Agent (the generalized probe only runs for adapters that opt in).
    authProbe: { args: ['status'], timeoutMs: 5000 },
    // No `externalMcpInjection`: Cursor CLI does support native MCP — it
    // auto-discovers `.cursor/mcp.json` (project) / `~/.cursor/mcp.json`
    // (global) with project→global→nested precedence, and reportedly has an
    // `--approve-mcps` flag to skip the interactive trust prompt — but there
    // is no confirmed explicit `--mcp-config <path>` flag, so wiring it would
    // mean merging into the project's real `.cursor/mcp.json` (never a
    // run-scoped file) and needs `--approve-mcps` verified live against this
    // package's headless spawn shape first. Needs a new
    // merge-into-existing-file strategy, not a reuse of `'claude-mcp-json'`
    // (which relies on an explicit per-run path, never auto-discovery — see
    // `buildClaudeMcpConfigArgs`'s doc for why).
} satisfies RuntimeAgentDef;
