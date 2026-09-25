import { afterEach, describe, expect, it } from 'vitest';
import {
  codexAgentDef,
  codexNeedsDangerFullAccessSandbox,
  parseCodexDebugModels,
  unionModelReasoningOptions,
} from '../codex.js';

describe('codexAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(codexAgentDef.id).toBe('codex');
    expect(codexAgentDef.bin).toBe('codex');
    expect(codexAgentDef.promptViaStdin).toBe(true);
    expect(codexAgentDef.resumesSessionViaCli).toBe(true);
    expect(codexAgentDef.capturesSessionIdFromStream).toBe(true);
    expect(codexAgentDef.streamFormat).toBe('json-event-stream');
    expect(codexAgentDef.eventParser).toBe('codex');
    // Codex gets the caller's external MCP servers via a relocated, run-scoped CODEX_HOME carrying
    // a `[mcp_servers.jini]` TOML table — see `@jini-ai/daemon`'s `agent-executor.ts`
    // (`buildMcpBridgeDelivery`'s `'codex-toml'` case, `prepareCodexHomeForRun`), which dispatches
    // on this declared strategy alone, never on `def.id`.
    expect(codexAgentDef.externalMcpInjection).toBe('codex-toml');
    expect(codexAgentDef.listModels).toEqual({ args: ['debug', 'models'], parse: parseCodexDebugModels, timeoutMs: 5000 });
    expect(codexAgentDef.authProbe).toEqual({ args: ['login', 'status'], timeoutMs: 5000 });
    expect(codexAgentDef.reasoningOptions?.map((r) => r.id)).toEqual([
      'default',
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });
});

describe('parseCodexDebugModels', () => {
  it('returns null for unparseable JSON', () => {
    expect(parseCodexDebugModels('not json')).toBeNull();
  });

  it('returns null for empty stdout / falsy input', () => {
    expect(parseCodexDebugModels('')).toBeNull();
  });

  it('returns null when the parsed JSON is not an object', () => {
    expect(parseCodexDebugModels('42')).toBeNull();
    expect(parseCodexDebugModels('null')).toBeNull();
    expect(parseCodexDebugModels('"a string"')).toBeNull();
  });

  it('returns null when .models is missing or not an array', () => {
    expect(parseCodexDebugModels(JSON.stringify({}))).toBeNull();
    expect(parseCodexDebugModels(JSON.stringify({ models: 'nope' }))).toBeNull();
  });

  it('skips non-object entries in the models array', () => {
    const result = parseCodexDebugModels(JSON.stringify({ models: [null, 42, 'str', { slug: 'gpt-5' }] }));
    expect(result?.map((m) => m.id)).toEqual(['default', 'gpt-5']);
  });

  it('skips entries with visibility: "hidden"', () => {
    const result = parseCodexDebugModels(
      JSON.stringify({ models: [{ slug: 'gpt-5', visibility: 'hidden' }, { slug: 'gpt-5.1' }] }),
    );
    expect(result?.map((m) => m.id)).toEqual(['default', 'gpt-5.1']);
  });

  // Regression: OpenAI's real Codex catalog spells the hidden state `hide`, not `hidden` — verified
  // live against `codex debug models` (0.153.4), where `gpt-reserve` and `codex-auto-review` both
  // carry `visibility: "hide"`, and corroborated by openai/codex PR #42874, which describes flipping
  // Astra from `hide` to `list`. Testing only `=== 'hidden'` let both internal entries render in the
  // picker. Asserting the WHOLE list, not just "gpt-reserve is absent": a filter that dropped every
  // entry would also satisfy the narrower assertion.
  it("skips entries with the catalog's real hidden literal `hide`, keeping the listed ones", () => {
    const result = parseCodexDebugModels(
      JSON.stringify({
        models: [
          { slug: 'gpt-6-astra', visibility: 'list' },
          { slug: 'gpt-reserve', visibility: 'hide' },
          { slug: 'gpt-5.6-sol', visibility: 'list' },
          { slug: 'codex-auto-review', visibility: 'hide' },
        ],
      }),
    );
    expect(result?.map((m) => m.id)).toEqual(['default', 'gpt-6-astra', 'gpt-5.6-sol']);
  });

  // Permissive on input by design: a vendor that already shipped two spellings of the same state can
  // ship a third, and the cost of over-normalizing is zero (no real catalog value is a cased or
  // padded variant of a DIFFERENT state).
  it('treats cased and padded hidden literals as hidden too', () => {
    const result = parseCodexDebugModels(
      JSON.stringify({
        models: [{ slug: 'a', visibility: 'HIDE' }, { slug: 'b', visibility: '  hidden ' }, { slug: 'c' }],
      }),
    );
    expect(result?.map((m) => m.id)).toEqual(['default', 'c']);
  });

  it('uses .id when .slug is absent, and skips an entry with neither', () => {
    const result = parseCodexDebugModels(JSON.stringify({ models: [{ id: 'o3' }, { display_name: 'no id here' }] }));
    expect(result?.map((m) => m.id)).toEqual(['default', 'o3']);
  });

  it('skips entries whose id/slug trims to empty', () => {
    const result = parseCodexDebugModels(JSON.stringify({ models: [{ slug: '   ' }, { slug: 'gpt-5' }] }));
    expect(result?.map((m) => m.id)).toEqual(['default', 'gpt-5']);
  });

  it('de-duplicates repeated ids, including against the synthetic default id', () => {
    const result = parseCodexDebugModels(
      JSON.stringify({ models: [{ slug: 'default' }, { slug: 'gpt-5' }, { slug: 'gpt-5' }] }),
    );
    expect(result?.map((m) => m.id)).toEqual(['default', 'gpt-5']);
  });

  it('prefers display_name for the label, then name, then falls back to the id', () => {
    const result = parseCodexDebugModels(
      JSON.stringify({
        models: [
          { slug: 'a', display_name: 'Display A' },
          { slug: 'b', name: 'Name B' },
          { slug: 'c' },
          { slug: 'd', display_name: '   ' },
          { slug: 'e', display_name: '   ', name: 'Name E' },
        ],
      }),
    );
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'a', label: 'Display A' },
      { id: 'b', label: 'Name B' },
      { id: 'c', label: 'c' },
      { id: 'd', label: 'd' },
      { id: 'e', label: 'Name E' },
    ]);
  });

  it('returns null when every model entry is filtered out (only the synthetic default would remain)', () => {
    expect(parseCodexDebugModels(JSON.stringify({ models: [{ visibility: 'hidden', slug: 'x' }] }))).toBeNull();
    expect(parseCodexDebugModels(JSON.stringify({ models: [] }))).toBeNull();
  });
});

describe('codexNeedsDangerFullAccessSandbox', () => {
  it('returns true when CODEX_SANDBOX_MODE is "danger-full-access"', () => {
    expect(codexNeedsDangerFullAccessSandbox('darwin', { CODEX_SANDBOX_MODE: 'danger-full-access' })).toBe(true);
  });

  it('ignores CODEX_SANDBOX_MODE values other than the exact accepted string', () => {
    expect(codexNeedsDangerFullAccessSandbox('darwin', { CODEX_SANDBOX_MODE: 'workspace-write' })).toBe(false);
  });

  it('trims whitespace around CODEX_SANDBOX_MODE before comparing', () => {
    expect(codexNeedsDangerFullAccessSandbox('darwin', { CODEX_SANDBOX_MODE: '  danger-full-access  ' })).toBe(true);
  });

  it('returns true unconditionally on win32', () => {
    expect(codexNeedsDangerFullAccessSandbox('win32', {})).toBe(true);
  });

  it('returns true on linux when WSL_DISTRO_NAME is a non-empty env var (WSL detection)', () => {
    expect(codexNeedsDangerFullAccessSandbox('linux', { WSL_DISTRO_NAME: 'Ubuntu' })).toBe(true);
  });

  it('returns false on linux when WSL_DISTRO_NAME is absent', () => {
    expect(codexNeedsDangerFullAccessSandbox('linux', {})).toBe(false);
  });

  it('returns false on linux when WSL_DISTRO_NAME is present but blank/whitespace-only', () => {
    expect(codexNeedsDangerFullAccessSandbox('linux', { WSL_DISTRO_NAME: '   ' })).toBe(false);
  });

  it('returns false on darwin with no overrides and no WSL marker', () => {
    expect(codexNeedsDangerFullAccessSandbox('darwin', {})).toBe(false);
  });

  it('defaults platform/env to the real process.platform/process.env when omitted', () => {
    // Just prove it does not throw and returns a boolean using live process state.
    expect(typeof codexNeedsDangerFullAccessSandbox()).toBe('boolean');
  });
});

describe('codexAgentDef.buildArgs', () => {
  const originalPlatform = process.platform;
  const originalWsl = process.env.WSL_DISTRO_NAME;
  const originalSandboxMode = process.env.CODEX_SANDBOX_MODE;
  const originalDisablePlugins = process.env.CODEX_DISABLE_PLUGINS;

  function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: platform });
  }

  afterEach(() => {
    setPlatform(originalPlatform);
    if (originalWsl === undefined) delete process.env.WSL_DISTRO_NAME;
    else process.env.WSL_DISTRO_NAME = originalWsl;
    if (originalSandboxMode === undefined) delete process.env.CODEX_SANDBOX_MODE;
    else process.env.CODEX_SANDBOX_MODE = originalSandboxMode;
    if (originalDisablePlugins === undefined) delete process.env.CODEX_DISABLE_PLUGINS;
    else process.env.CODEX_DISABLE_PLUGINS = originalDisablePlugins;
  });

  it('builds a fresh (non-resume) turn with workspace-write sandbox on a non-Windows/non-WSL host', () => {
    setPlatform('darwin');
    delete process.env.WSL_DISTRO_NAME;
    delete process.env.CODEX_SANDBOX_MODE;
    const args = codexAgentDef.buildArgs('hi', [], [], {}, { cwd: '/proj' });
    expect(args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '-c',
      'sandbox_workspace_write.network_access=true',
      '-C',
      '/proj',
    ]);
  });

  it('uses danger-full-access sandbox on win32 for a fresh turn', () => {
    setPlatform('win32');
    const args = codexAgentDef.buildArgs('hi', [], []);
    expect(args).toContain('--sandbox');
    expect(args[args.indexOf('--sandbox') + 1]).toBe('danger-full-access');
  });

  it('uses -c sandbox_mode="danger-full-access" (not --sandbox) on a resume turn under WSL/win32', () => {
    setPlatform('win32');
    const args = codexAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: 'thread-1' });
    expect(args).not.toContain('--sandbox');
    expect(args).toContain('sandbox_mode="danger-full-access"');
  });

  it('uses -c sandbox_mode="workspace-write" plus network_access on a resume turn on a normal host', () => {
    setPlatform('darwin');
    delete process.env.WSL_DISTRO_NAME;
    const args = codexAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: 'thread-1' });
    expect(args).not.toContain('--sandbox');
    expect(args).toContain('sandbox_mode="workspace-write"');
    expect(args).toContain('sandbox_workspace_write.network_access=true');
  });

  it('uses "exec resume" with the thread id as the trailing positional when resumeSessionId is set', () => {
    setPlatform('darwin');
    const args = codexAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: 'thread-xyz' });
    expect(args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(args[args.length - 1]).toBe('thread-xyz');
  });

  it('uses plain "exec" (no resume) when resumeSessionId is an empty string', () => {
    setPlatform('darwin');
    const args = codexAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: '' });
    expect(args[0]).toBe('exec');
    expect(args[1]).not.toBe('resume');
  });

  it('does NOT append -C/--add-dir on a resume turn even if cwd/extraAllowedDirs are set', () => {
    setPlatform('darwin');
    const args = codexAgentDef.buildArgs('hi', [], ['/extra'], {}, { resumeSessionId: 'thread-1', cwd: '/proj' });
    expect(args).not.toContain('-C');
    expect(args).not.toContain('--add-dir');
  });

  it('omits -C when runtimeContext.cwd is absent on a fresh turn', () => {
    setPlatform('darwin');
    const args = codexAgentDef.buildArgs('hi', [], [], {}, {});
    expect(args).not.toContain('-C');
  });

  it('appends one --add-dir per non-empty string dir on a fresh turn, filtering blanks', () => {
    setPlatform('darwin');
    const args = codexAgentDef.buildArgs('hi', [], ['/a', '', '/b']);
    const dirFlags = args.reduce<string[]>((acc, v, i) => (v === '--add-dir' ? [...acc, args[i + 1]!] : acc), []);
    expect(dirFlags).toEqual(['/a', '/b']);
  });

  it('tolerates an explicit null extraAllowedDirs on a fresh turn (the `|| []` fallback, distinct from the default param)', () => {
    setPlatform('darwin');
    const args = codexAgentDef.buildArgs('hi', [], null as unknown as string[]);
    expect(args).not.toContain('--add-dir');
  });

  it('adds --model <id> for a concrete model selection', () => {
    setPlatform('darwin');
    const args = codexAgentDef.buildArgs('hi', [], [], { model: 'gpt-5' });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5');
  });

  it('omits --model for the "default" sentinel and when falsy', () => {
    setPlatform('darwin');
    expect(codexAgentDef.buildArgs('hi', [], [], { model: 'default' })).not.toContain('--model');
    expect(codexAgentDef.buildArgs('hi', [], [], { model: '' })).not.toContain('--model');
  });

  it('adds a -c model_reasoning_effort override for a concrete reasoning selection (clamped via clampCodexReasoning)', () => {
    setPlatform('darwin');
    const args = codexAgentDef.buildArgs('hi', [], [], { model: 'gpt-5', reasoning: 'high' });
    expect(args).toContain('model_reasoning_effort="high"');
  });

  it('omits the reasoning-effort override for the "default" sentinel and when falsy', () => {
    setPlatform('darwin');
    expect(codexAgentDef.buildArgs('hi', [], [], { reasoning: 'default' }).join(' ')).not.toContain(
      'model_reasoning_effort',
    );
    expect(codexAgentDef.buildArgs('hi', [], [], { reasoning: '' }).join(' ')).not.toContain('model_reasoning_effort');
  });

  it('adds --disable plugins when CODEX_DISABLE_PLUGINS=1', () => {
    setPlatform('darwin');
    process.env.CODEX_DISABLE_PLUGINS = '1';
    const args = codexAgentDef.buildArgs('hi', [], []);
    expect(args).toContain('--disable');
    expect(args[args.indexOf('--disable') + 1]).toBe('plugins');
  });

  it('omits --disable plugins when CODEX_DISABLE_PLUGINS is unset or not "1"', () => {
    setPlatform('darwin');
    delete process.env.CODEX_DISABLE_PLUGINS;
    expect(codexAgentDef.buildArgs('hi', [], [])).not.toContain('--disable');
    process.env.CODEX_DISABLE_PLUGINS = '0';
    expect(codexAgentDef.buildArgs('hi', [], [])).not.toContain('--disable');
  });

  it('defaults extraAllowedDirs/options/runtimeContext when omitted entirely', () => {
    setPlatform('darwin');
    expect(() => codexAgentDef.buildArgs('hi', [])).not.toThrow();
  });

  it('adds -i <path> for each attachment path on a fresh turn (not silently dropped)', () => {
    setPlatform('darwin');
    const args = codexAgentDef.buildArgs('hi', ['/img/one.png', '/notes/two.md'], [], {}, { cwd: '/proj' });
    const attachFlags = args.reduce<string[]>((acc, v, i) => (v === '-i' ? [...acc, args[i + 1]!] : acc), []);
    expect(attachFlags).toEqual(['/img/one.png', '/notes/two.md']);
  });

  it('adds -i <path> on a resume turn too, unlike -C/--add-dir which are create-only', () => {
    setPlatform('darwin');
    const args = codexAgentDef.buildArgs('hi', ['/img/one.png'], [], {}, { resumeSessionId: 'thread-1' });
    expect(args).toContain('-i');
    expect(args[args.indexOf('-i') + 1]).toBe('/img/one.png');
    // The resume thread id positional must still come after every flag, attachments included.
    expect(args[args.length - 1]).toBe('thread-1');
  });

  it('filters out non-string/empty attachment path entries', () => {
    setPlatform('darwin');
    const args = codexAgentDef.buildArgs('hi', ['', 123 as unknown as string, '/img/ok.png']);
    const attachFlags = args.reduce<string[]>((acc, v, i) => (v === '-i' ? [...acc, args[i + 1]!] : acc), []);
    expect(attachFlags).toEqual(['/img/ok.png']);
  });

  it('adds no -i flag when imagePaths is empty or nullish', () => {
    setPlatform('darwin');
    expect(codexAgentDef.buildArgs('hi', [])).not.toContain('-i');
    expect(codexAgentDef.buildArgs('hi', null as unknown as string[])).not.toContain('-i');
  });
});

describe('codexAgentDef.imageDelivery', () => {
  it('declares "native" so attachments are never silently dropped (regression: was undefined)', () => {
    expect(codexAgentDef.imageDelivery).toBe('native');
  });
});


/**
 * The real catalog shape, trimmed to the fields these tests read. Copied from a live
 * `codex debug models` run (codex-cli 0.153.4) — the effort sets below are NOT invented: Astra and
 * the Sol/Terra models really do offer `ultra`, Luna stops at `max`, and 5.5 / 5.4-mini stop at
 * `xhigh`. That per-model divergence is the whole reason a single global effort list is wrong.
 */
const LIVE_CATALOG_SHAPE = JSON.stringify({
  models: [
    {
      slug: 'gpt-6-astra',
      display_name: 'GPT-6 Astra',
      visibility: 'list',
      supported_reasoning_levels: [
        { effort: 'low' }, { effort: 'medium' }, { effort: 'high' },
        { effort: 'xhigh' }, { effort: 'max' }, { effort: 'ultra' },
      ],
    },
    {
      slug: 'gpt-reserve',
      visibility: 'hide',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'nonsense-internal-level' }],
    },
    {
      slug: 'gpt-5.5',
      visibility: 'list',
      supported_reasoning_levels: [
        { effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' },
      ],
    },
  ],
});

describe('parseCodexDebugModels — per-model reasoning levels', () => {
  it("carries each model's own supported_reasoning_levels on its option row", () => {
    const models = parseCodexDebugModels(LIVE_CATALOG_SHAPE);
    const astra = models?.find((m) => m.id === 'gpt-6-astra');
    expect(astra?.reasoning?.map((r) => r.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    // Not the same set — a global list cannot be right for both.
    const gpt55 = models?.find((m) => m.id === 'gpt-5.5');
    expect(gpt55?.reasoning?.map((r) => r.id)).toEqual(['low', 'medium', 'high', 'xhigh']);
  });

  it('labels the levels the way the picker already spells them', () => {
    const models = parseCodexDebugModels(LIVE_CATALOG_SHAPE);
    const astra = models?.find((m) => m.id === 'gpt-6-astra');
    expect(astra?.reasoning?.map((r) => r.label)).toEqual(['Low', 'Medium', 'High', 'XHigh', 'Max', 'Ultra']);
  });

  it('accepts a bare-string level as well as the {effort} object form', () => {
    const models = parseCodexDebugModels(
      JSON.stringify({ models: [{ slug: 'm', supported_reasoning_levels: ['low', { effort: 'high' }] }] }),
    );
    expect(models?.find((m) => m.id === 'm')?.reasoning?.map((r) => r.id)).toEqual(['low', 'high']);
  });

  it('omits `reasoning` entirely for a model that declares no levels', () => {
    const models = parseCodexDebugModels(JSON.stringify({ models: [{ slug: 'm' }] }));
    expect(models?.find((m) => m.id === 'm')).toEqual({ id: 'm', label: 'm' });
  });
});

describe('unionModelReasoningOptions', () => {
  it('unions every listed model\'s levels, so `max` and `ultra` become reachable', () => {
    const models = parseCodexDebugModels(LIVE_CATALOG_SHAPE)!;
    expect(unionModelReasoningOptions(models)?.map((r) => r.id)).toEqual([
      'default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
    ]);
  });

  it('never surfaces a hidden model\'s private levels', () => {
    // `gpt-reserve` is `visibility: "hide"` and carries a bogus level; it is filtered out by
    // `parseCodexDebugModels` before the union ever sees it. Asserted here, not just implied by the
    // test above, because the union is the thing that renders.
    const models = parseCodexDebugModels(LIVE_CATALOG_SHAPE)!;
    expect(unionModelReasoningOptions(models)?.map((r) => r.id)).not.toContain('nonsense-internal-level');
  });

  it('returns null when no model carries levels, so the caller keeps its static list', () => {
    expect(unionModelReasoningOptions([{ id: 'default', label: 'Default' }, { id: 'm', label: 'm' }])).toBeNull();
    expect(unionModelReasoningOptions([])).toBeNull();
  });
});

describe('codexAgentDef.deriveReasoningOptions', () => {
  it('is declared, and turns the live catalog into the effort list the picker renders', () => {
    const models = parseCodexDebugModels(LIVE_CATALOG_SHAPE)!;
    expect(codexAgentDef.deriveReasoningOptions?.(models)?.map((r) => r.id)).toEqual([
      'default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
    ]);
  });
});
