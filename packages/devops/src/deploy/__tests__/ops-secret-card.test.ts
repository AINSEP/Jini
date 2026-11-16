import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import { collectTypedDeploySecret } from '../ops-secret-card.js';
import { buildDeployOpsRegistrations } from '../ops-tools.js';
import type { DeployOpsRegistrationHost, DeployOpsSecretCards, SecretConfirm, SetSecretInput } from '../ops-tool-contracts.js';
import { TOOL_IDS, catchErr, fullModule, makeRuntime } from './ops-fixtures.js';

type Cfg = { toolId: string; prepare(): Promise<{ locale: string }>; form(a: { prep: { locale: string } }): unknown; save(a: { values: { value?: unknown }; signal: AbortSignal }): Promise<{ result: unknown; saved: boolean; recovery?: true }>; result(a: { prep: { locale: string }; run: unknown }): unknown; outcome(a: { prep: { locale: string }; run: unknown }): unknown };
type Opts = { uriHost: string; text: { noEmitter: string }; safeError(): string };

/** Stand-in for the card kit: records the config, then lets a test drive the lifecycle. */
function fakeCards(over: Partial<DeployOpsSecretCards> = {}) {
  const seen: { cfg?: Cfg; opts?: Opts; handlerArgs?: unknown; callArgs?: unknown[] } = {};
  const cards = {
    defineSecretCardTool: vi.fn((cfg: Cfg, opts: Opts) => {
      seen.cfg = cfg; seen.opts = opts;
      return { handler: (args: unknown) => async (...callArgs: unknown[]) => { seen.handlerArgs = args; seen.callArgs = callArgs; return 'card-result'; } };
    }),
    askThenReport: vi.fn(),
    surfaceExchanges: { open: vi.fn() },
    uriHost: 'host.example',
    defaultLocale: 'en',
    noEmitter: 'NO EMITTER',
    locale: vi.fn(async () => 'fr'),
    form: vi.fn(({ locale, title }: { locale: string; title: string }) => ({ locale, title })),
    text: vi.fn(({ locale, id }: { locale: string; id: string }) => `${id}@${locale}`),
    ...over,
  } as unknown as DeployOpsSecretCards;
  return { cards, seen };
}

const input: SetSecretInput = { platform: 'p', target: 'app', name: 'TOKEN', source: { kind: 'typed' } };
const ctxOf = (signal = new AbortController().signal) => ({ executionId: 'e', principal: { kind: 'user', id: 'u' }, run: { id: 'r' }, input: {}, signal }) as unknown as ToolExecutionContext;

async function start(opts: { module?: ReturnType<typeof fullModule>; cards?: Partial<DeployOpsSecretCards>; permit?: () => Promise<void>; signal?: AbortSignal; confirm?: SecretConfirm; emitSurface?: unknown } = {}) {
  const rt = makeRuntime(opts.module);
  const fc = fakeCards(opts.cards);
  const ctx = ctxOf(opts.signal);
  const permit = opts.permit ?? vi.fn(async () => undefined);
  const out = await collectTypedDeploySecret({ ctx, deps: rt.deps, cards: fc.cards, input, permit }, { confirm: opts.confirm, ...(opts.emitSurface ? { emitSurface: opts.emitSurface as never } : {}) });
  return { ...rt, ...fc, ctx, permit, out };
}

describe('collectTypedDeploySecret wiring', () => {
  it('refuses when there is no exchange store to ask through', async () => {
    const rt = makeRuntime();
    const { cards } = fakeCards({ surfaceExchanges: undefined });
    const err = await catchErr(collectTypedDeploySecret({ ctx: ctxOf(), deps: rt.deps, cards, input, permit: async () => undefined }));
    expect(err.message).toBe('NO EMITTER');
    expect(cards.defineSecretCardTool).not.toHaveBeenCalled();
  });

  it('defines the card under the set-secret tool id and hands the call to its handler', async () => {
    const r = await start();
    expect(r.out).toBe('card-result');
    expect(r.seen.cfg!.toolId).toBe('ops_set_secret');
    expect(r.seen.opts).toMatchObject({ uriHost: 'host.example', text: { noEmitter: 'NO EMITTER' } });
    expect(r.seen.handlerArgs).toEqual({ surfaceExchanges: r.cards.surfaceExchanges, askThenReport: r.cards.askThenReport });
    expect(r.seen.callArgs).toEqual([r.ctx, {}]);
  });

  it('forwards the surface emitter when the transport has one', async () => {
    const emitSurface = () => undefined;
    const r = await start({ emitSurface });
    expect(r.seen.callArgs).toEqual([r.ctx, { emitSurface }]);
  });

  it('safeError returns fixed storage text, never the underlying error', async () => {
    const r = await start();
    expect(r.seen.opts!.safeError()).toBe('storage@en');
  });

  it('draws the form with the prepared locale and a name · target title', async () => {
    const r = await start();
    const prep = await r.seen.cfg!.prepare();
    expect(r.seen.cfg!.form({ prep })).toEqual({ locale: 'fr', title: 'TOKEN · app' });
  });
});

describe('card prepare', () => {
  it('resolves the host credential first and then the locale', async () => {
    const r = await start();
    const prep = await r.seen.cfg!.prepare();
    expect(prep).toEqual({ locale: 'fr' });
    expect(r.deps.loadDeployOps).toHaveBeenCalledWith({ workspaceId: 'ws1' });
    expect(r.deps.credentials.list).toHaveBeenCalledTimes(1);
    expect(r.cards.locale).toHaveBeenCalledWith({ ctx: r.ctx });
    expect(r.seen.opts!.safeError()).toBe('storage@fr');
  });

  it('skips all work and keeps the default locale when already aborted', async () => {
    const ac = new AbortController(); ac.abort();
    const r = await start({ signal: ac.signal });
    expect(await r.seen.cfg!.prepare()).toEqual({ locale: 'en' });
    expect(r.deps.loadDeployOps).not.toHaveBeenCalled();
    expect(r.cards.locale).not.toHaveBeenCalled();
  });

  it('refuses an unknown platform', async () => {
    const rt = makeRuntime();
    const fc = fakeCards();
    await collectTypedDeploySecret({ ctx: ctxOf(), deps: rt.deps, cards: fc.cards, input: { ...input, platform: 'nope' }, permit: async () => undefined });
    expect((await catchErr(fc.cards.defineSecretCardTool.mock.calls[0]![0].prepare())).message).toMatch(/^Unknown deployment ops platform 'nope'/);
  });

  it('refuses a platform with no secrets adapter', async () => {
    const r = await start({ module: fullModule({ setSecret: undefined }) });
    expect((await catchErr(r.seen.cfg!.prepare())).message).toBe('This platform has no secrets adapter.');
  });

  it('surfaces a missing credential so recovery opens that card first', async () => {
    const r = await start();
    (r.deps.credentials.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    expect((await catchErr(r.seen.cfg!.prepare())).message).toBe('setup p');
    expect(r.cards.locale).not.toHaveBeenCalled();
  });
});

describe('card save', () => {
  const values = { value: '  secret with spaces\n' };

  it('checks write permission, writes the value untrimmed and reports saved', async () => {
    const m = fullModule();
    const r = await start({ module: m });
    const saved = await r.seen.cfg!.save({ values, signal: new AbortController().signal });
    expect(r.permit).toHaveBeenCalledTimes(1);
    expect((m.setSecret as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual({ target: 'app', name: 'TOKEN', value: '  secret with spaces\n' });
    expect(saved).toMatchObject({ saved: true, result: { changed: true, name: 'TOKEN' } });
    expect(JSON.stringify(saved)).not.toContain('secret with spaces');
  });

  it('counts an identical stored value as saved', async () => {
    const m = fullModule({ readSecret: vi.fn(async () => ({ value: 'same' })) });
    const r = await start({ module: m });
    const saved = await r.seen.cfg!.save({ values: { value: 'same' }, signal: new AbortController().signal });
    expect(saved).toMatchObject({ saved: true, result: { changed: false, comparison: 'same' } });
    expect(m.setSecret).not.toHaveBeenCalled();
  });

  it('does not count a declined overwrite as saved', async () => {
    const m = fullModule({ readSecret: vi.fn(async () => ({ value: 'old' })) });
    const confirm: SecretConfirm = async () => ({ confirmed: false, result: { cancelled: true, note: 'declined' } });
    const r = await start({ module: m, confirm });
    const saved = await r.seen.cfg!.save({ values, signal: new AbortController().signal });
    expect(saved).toMatchObject({ saved: false, result: { changed: false, cancelled: true } });
    expect(m.setSecret).not.toHaveBeenCalled();
  });

  it('returns a recovery payload when the credential is not set up', async () => {
    const r = await start();
    (r.deps.credentials.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const saved = await r.seen.cfg!.save({ values, signal: new AbortController().signal });
    expect(saved).toEqual({ result: { executed: false, credentialSetup: { hint: 'hint-p' } }, saved: false, recovery: true });
  });

  it('propagates a permission failure without writing', async () => {
    const denied = new Error('write denied');
    const m = fullModule();
    const r = await start({ module: m, permit: async () => { throw denied; } });
    expect(await catchErr(r.seen.cfg!.save({ values, signal: new AbortController().signal }))).toBe(denied);
    expect(m.setSecret).not.toHaveBeenCalled();
  });

  it('rejects a blank or missing typed value', async () => {
    const r = await start();
    const sig = new AbortController().signal;
    expect((await catchErr(r.seen.cfg!.save({ values: { value: '   ' }, signal: sig }))).message).toBe('The secure form requires a non-blank secret of at most 8192 characters.');
    expect((await catchErr(r.seen.cfg!.save({ values: {}, signal: sig }))).message).toMatch(/non-blank secret/);
  });
});

describe('card result and outcome', () => {
  const prep = { locale: 'de' };
  const savedRun = (saved: boolean, extra: object = {}) => ({ status: 'saved', saved: { result: { marker: 'r' }, saved, ...extra } });

  it('returns the save result when saved', async () => {
    const r = await start();
    expect(r.seen.cfg!.result({ prep, run: savedRun(true) })).toEqual({ marker: 'r' });
  });

  it.each(['failed', 'blank'])('returns fixed storage text for a %s run', async status => {
    const r = await start();
    expect(r.seen.cfg!.result({ prep, run: { status } })).toEqual({ changed: false, message: 'storage@de' });
  });

  it.each(['cancelled', 'expired'])('reports %s as not changed and cancelled', async status => {
    const r = await start();
    expect(r.seen.cfg!.result({ prep, run: { status } })).toEqual({ changed: false, cancelled: true });
  });

  it('announces success on the same card after a real save', async () => {
    const r = await start();
    expect(r.seen.cfg!.outcome({ prep, run: savedRun(true) })).toEqual({ title: 'TOKEN · app', state: 'success', message: 'savedTitle@de' });
  });

  it('announces failure when the run saved nothing, failed or was blank', async () => {
    const r = await start();
    const failure = { title: 'TOKEN · app', state: 'failure', message: 'storage@de' };
    expect(r.seen.cfg!.outcome({ prep, run: savedRun(false) })).toEqual(failure);
    expect(r.seen.cfg!.outcome({ prep, run: { status: 'failed' } })).toEqual(failure);
    expect(r.seen.cfg!.outcome({ prep, run: { status: 'blank' } })).toEqual(failure);
  });

  it('emits no outcome for a recovery save (the credential card owns the next step) or an unanswered card', async () => {
    const r = await start();
    expect(r.seen.cfg!.outcome({ prep, run: savedRun(false, { recovery: true }) })).toBeUndefined();
    expect(r.seen.cfg!.outcome({ prep, run: { status: 'cancelled' } })).toBeUndefined();
    expect(r.seen.cfg!.outcome({ prep, run: { status: 'expired' } })).toBeUndefined();
  });
});

describe('typed secret through the registered tool', () => {
  it('asks the card to save and checks the write permission from inside it', async () => {
    const rt = makeRuntime();
    const fc = fakeCards();
    const catalog = [{ name: TOOL_IDS.setSecret, description: 'd', sideEffects: 'external-write', authorization: { permission: 'perm.set' }, inputSchema: { type: 'object' } }];
    const permit = vi.fn(async (_r: { permission: string }) => undefined);
    const host = {
      catalog, metadata: {}, derivedRisk: new Map([[TOOL_IDS.setSecret, 'external-write']]), domain: 'd', catalogModule: 'c.ts',
      permissions: { write: 'perm.write', siteKey: 'perm.sitekey' }, permit, approvals: { confirmFor: () => undefined }, cards: fc.cards,
    } as unknown as DeployOpsRegistrationHost;
    const [reg] = buildDeployOpsRegistrations({ deps: rt.deps, host });
    const input = { platform: 'p', target: 'app', name: 'TOKEN', source: { kind: 'typed' } };
    const res = await reg!.handler({ ...ctxOf(), input } as ToolExecutionContext, {} as never);
    expect(res).toBe('card-result');
    await fc.seen.cfg!.save({ values: { value: 'v' }, signal: new AbortController().signal });
    expect(permit.mock.calls.map(c => c[0].permission)).toEqual(['perm.set', 'perm.write']);
  });
});
