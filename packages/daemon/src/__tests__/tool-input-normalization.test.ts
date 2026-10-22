import { describe, expect, it, vi } from 'vitest';
import { applyTargetScope, withBatchInput, createBatchApprovalHandler, createToolRegistry, ToolInputError, type ToolAuthorizationContext, type ToolExecutionContext } from '@jini-ai/core';
import { createToolExecutor, type ToolConfirmationRequest } from '../tool-executor.js';

const inputSchema = { type: 'object', additionalProperties: false, required: ['expectedVersion'], properties: { expectedVersion: { type: 'integer' }, enabled: { type: 'boolean' } } };

describe('ToolExecutor normalization gate', () => {
  it('authorizes and confirms exactly the fully normalized combined plan before any effect', async () => {
    const registry = createToolRegistry({});
    const authorized: unknown[] = [];
    const prepared: unknown[] = [];
    const executed: unknown[] = [];
    const confirmed: unknown[] = [];
    const handler = createBatchApprovalHandler({ steps: {
      prepare: async ({ ctx }) => { prepared.push(ctx.input); return ctx.input; },
      describe: () => ({ ask: true, description: 'delete' }),
      askHuman: async ({ ctx }) => { confirmed.push(ctx.input); expect(executed).toEqual([]); return { confirmed: true }; },
      run: async ({ ctx }) => { executed.push(ctx.input); return { deleted: true }; },
      notConfirmed: () => ({ deleted: false }),
    }, combineDescriptions: () => 'delete all' });
    registry.register(withBatchInput({ registration: {
      descriptor: { id: 'delete', inputSchema }, handler,
      normalizeInput: ({ input }) => { const { version, ...rest } = input; return { input: version === undefined ? rest : { ...rest, expectedVersion: version }, notes: [] }; },
      policy: { authorize: ({ input }) => { authorized.push(input); return 'allow'; } },
    }, tool: { toolId: 'delete', itemDefaults: { expectedVersion: 1 } } }, { mode: 'plan' }));
    const delegated: unknown[] = [];
    const executor = createToolExecutor({ registry }, { delegate: { onAuthorize: ({ input }) => { delegated.push(input); return 'allow'; } } });
    const result = await executor.execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'delete',
      input: { enabled: 'false', items: [{ expected_version: '2' }, { version: '3', enabled: 'true' }] } });
    const items = [{ expectedVersion: 2, enabled: false }, { expectedVersion: 3, enabled: true }];
    expect(result.status).toBe('completed');
    expect(authorized).toEqual([{ items }]);
    expect(delegated[0]).toBe(authorized[0]);
    expect(confirmed).toEqual(authorized);
    expect(prepared).toEqual(items);
    expect(executed).toEqual(items);
    expect(result.output).toMatchObject({ batch: true, total: 2 });
  });

  it('merges canonicalized defaults, shared fields and item overrides before domain normalization and gates', async () => {
    const registry = createToolRegistry({});
    const seen: unknown[] = [];
    const handler = vi.fn(async ({ input }: ToolExecutionContext) => { seen.push(input); return { fetched: true }; });
    registry.register(withBatchInput({ registration: {
      descriptor: { id: 'web_fetch_page', requiresConfirmation: true, inputSchema: { type: 'object', additionalProperties: false,
        properties: { url: { type: 'string' }, maxChars: { type: 'integer' } } } },
      normalizeInput: ({ input }) => ({ input: { ...input, url: String(input.url).replace(/\/$/, '') }, notes: [] }),
      policy: { authorize: ({ input }) => { if (!('items' in (input as object))) seen.push(input); return 'allow'; } }, handler,
    }, tool: { toolId: 'web_fetch_page', itemDefaults: { max_chars: 8000 } } }));
    const executor = createToolExecutor({ registry }, { delegate: { onConfirm: ({ input }) => {
      if (!('items' in (input as object))) seen.push(input);
      return 'confirm';
    } } });
    const result = await executor.execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'web_fetch_page',
      input: { max_chars: '2000', items: [{ url: 'https://example.com/', max_chars: '1000' }, { url: 'https://other.com/' }] } });
    expect(result.output).toMatchObject({ succeeded: 2, failed: 0 });
    expect(seen).toEqual([
      { url: 'https://example.com', maxChars: 1000 }, { url: 'https://example.com', maxChars: 1000 }, { url: 'https://example.com', maxChars: 1000 },
      { url: 'https://other.com', maxChars: 2000 }, { url: 'https://other.com', maxChars: 2000 }, { url: 'https://other.com', maxChars: 2000 },
    ]);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[1]).toBe(seen[2]);
  });

  it.each(['defaults', 'shared', 'item'])('rejects spelling collisions within %s rather than selecting one', async layer => {
    const registry = createToolRegistry({});
    const handler = vi.fn(async () => ({ written: true }));
    const collision = { expectedVersion: 1, expected_version: '2' };
    registry.register(withBatchInput({ registration: { descriptor: { id: 'write', inputSchema }, policy: { authorize: () => 'allow' }, handler },
      tool: { toolId: 'write', itemDefaults: layer === 'defaults' ? collision : { expectedVersion: 1 } } }));
    const result = await createToolExecutor({ registry }).execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'write',
      input: { ...(layer === 'shared' ? collision : {}), items: [layer === 'item' ? collision : { expectedVersion: 3 }] } });
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain("Send only 'expectedVersion'");
    registry.register(withBatchInput({ registration: { descriptor: { id: 'clean', inputSchema }, policy: { authorize: () => 'allow' }, handler },
      tool: { toolId: 'clean', itemDefaults: { expectedVersion: 1 } } }));
    const clean = await createToolExecutor({ registry }).execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'clean',
      input: { items: [{ expected_version: '3' }] } });
    expect(clean.output).toMatchObject({ succeeded: 1, failed: 0 });
  });

  it('reports rewrite notes on handler validation failures without exposing policy errors', async () => {
    const registry = createToolRegistry({});
    registry.register({ descriptor: { id: 'invalid', inputSchema }, policy: { authorize: () => 'allow' },
      handler: async () => { throw new ToolInputError({ message: 'version is stale; re-read first' }); } });
    registry.register({ descriptor: { id: 'policy-error', inputSchema }, policy: { authorize: () => { throw new ToolInputError({ message: 'private infrastructure detail' }); } }, handler: async () => null });
    const executor = createToolExecutor({ registry });
    const args = { principal: { id: 'owner' }, run: { id: 'run' }, input: { expected_version: '3' } };
    const invalid = await executor.execute({ ...args, toolId: 'invalid' });
    expect(invalid.errorKind).toBe('validation');
    expect(invalid.error).toContain('version is stale; re-read first');
    expect(invalid.error).toContain('normalized: expected_version→expectedVersion');
    const infrastructure = await executor.execute({ ...args, toolId: 'policy-error' });
    expect(infrastructure.error).toBe('authorization failed');
  });

  it('authorizes, confirms and validates the same canonical input, with model-visible rewrite notes', async () => {
    const registry = createToolRegistry({});
    const authorize = vi.fn((_ctx: ToolAuthorizationContext) => 'allow' as const);
    const confirm = vi.fn((_request: ToolConfirmationRequest) => 'confirm' as const);
    const handler = vi.fn(async (ctx: ToolExecutionContext) => {
      const input = ctx.input as Record<string, unknown>;
      if (input.expectedVersion !== 3 || input.enabled !== true) throw new Error('validator saw raw input');
      return { written: true };
    });
    registry.register({ descriptor: { id: 'write', inputSchema, requiresConfirmation: true }, policy: { authorize }, handler });
    const executor = createToolExecutor({ registry }, { delegate: { onConfirm: confirm } });
    const result = await executor.execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'write', input: { expected_version: '3', enabled: 'true' } });
    expect(result.status).toBe('completed');
    expect(authorize.mock.calls[0]![0].input).toEqual({ expectedVersion: 3, enabled: true });
    expect(confirm.mock.calls[0]![0].input).toEqual({ expectedVersion: 3, enabled: true });
    expect(handler.mock.calls[0]![0].input).toEqual({ expectedVersion: 3, enabled: true });
    expect(result.output).toMatchObject({ written: true, normalizationNotes: expect.arrayContaining(['expected_version→expectedVersion']) });
    expect(executor.getAuditRecord({ executionId: result.executionId })!.events.find(event => event.phase === 'authorized')!.detail).toContain('normalized:');
  });

  it('returns precise validation errors for ambiguous/near-miss inputs before policy or effects', async () => {
    const registry = createToolRegistry({});
    const handler = vi.fn(async () => ({ written: true }));
    const authorize = vi.fn(() => 'allow' as const);
    registry.register({ descriptor: { id: 'write', inputSchema }, policy: { authorize }, handler });
    const executor = createToolExecutor({ registry });
    // MOVE: Near misses now name the unknown field and suggest the declared property without rewriting it.
    for (const { input, error } of [
      { input: { expectedVersion: 3, expected_version: 4 }, error: "Conflicting inputs 'expectedVersion' and 'expected_version' both name 'expectedVersion'. Send only 'expectedVersion'." },
      { input: { expectedVersoin: '3' }, error: "Unknown input 'expectedVersoin'. Declared inputs: expectedVersion (required), enabled (optional). Did you mean 'expectedVersion'? Resend with the declared name." },
    ]) {
      const result = await executor.execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'write', input });
      expect(result).toMatchObject({ status: 'failed', errorKind: 'validation' });
      expect(result.error).toBe(error);
    }
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('batch and target normalization safety', () => {
  it.each(['site', 'Site', 'SITE', 's_ite', 's-ite'])('retains guarded write target %s in single, shared and per-item inputs', async key => {
    const handler = vi.fn(async () => ({ written: true }));
    const registry = createToolRegistry({});
    const [scoped] = applyTargetScope({
      registrations: [{ descriptor: { id: 'write', inputSchema }, policy: { authorize: () => 'allow' }, handler }],
      resolveTarget: async () => { throw new Error('writes cannot resolve a peer'); },
      isCurrentTarget: ({ target }) => target === 'current',
    }, { refuseMessage: 'foreign writes refused' });
    registry.register(withBatchInput({ registration: scoped!, tool: { toolId: 'write' } }));
    const executor = createToolExecutor({ registry });
    const call = (input: unknown) => executor.execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'write', input });
    const single = await call({ expectedVersion: 3, [key]: 'foreign' });
    expect(single).toMatchObject({ status: 'failed', errorKind: 'validation' });
    expect(single.error).toContain('foreign writes refused');
    for (const input of [
      { [key]: 'foreign', items: [{ expectedVersion: 3 }, { expectedVersion: 3 }] },
      { items: [{ expectedVersion: 3, [key]: 'foreign' }, { expectedVersion: 3, [key]: 'foreign' }] },
    ]) {
      const result = await call(input);
      expect(result.status).toBe('completed');
      expect(result.output).toMatchObject({ total: 2, succeeded: 0, failed: 2,
        results: [{ ok: false, error: expect.stringContaining('foreign writes refused') }, { ok: false, error: expect.stringContaining('foreign writes refused') }] });
    }
    expect(handler).not.toHaveBeenCalled();
    expect((await call({ expectedVersion: 3, [key]: 'current' })).status).toBe('completed');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('never drops unknown guard fields before authorization', async () => {
    const registry = createToolRegistry({});
    const authorize = vi.fn(() => 'allow' as const);
    const handler = vi.fn(async () => ({ written: true }));
    registry.register({ descriptor: { id: 'write', inputSchema }, policy: { authorize }, handler });
    const executor = createToolExecutor({ registry });
    for (const key of ['site', 'workspaceId', 'permission', 'tenant', 'principal']) {
      const result = await executor.execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'write', input: { expectedVersion: 3, [key]: 'foreign' } });
      expect(result).toMatchObject({ status: 'failed', errorKind: 'validation' });
      expect(result.error).toContain(`Unknown input '${key}'`);
    }
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('gates each final merged item through registration policy, delegate and confirmation, preserving partial failures and the cap', async () => {
    const registry = createToolRegistry({});
    const handled: unknown[] = [];
    const authorized: unknown[] = [];
    const delegated: unknown[] = [];
    const confirmed: unknown[] = [];
    const schema = { type: 'object', additionalProperties: false, properties: { expectedVersion: { type: 'integer' }, enabled: { type: 'boolean' } } };
    registry.register(withBatchInput({
      registration: {
        descriptor: { id: 'write', inputSchema: schema, requiresConfirmation: true },
        policy: { authorize: ({ input }) => {
          if (Array.isArray((input as Record<string, unknown>).items)) return 'allow';
          authorized.push(input);
          return (input as Record<string, unknown>).enabled === true ? 'deny' : 'allow';
        } },
        handler: async ({ input }) => { handled.push(input); return { written: true }; },
      }, tool: { toolId: 'write', maxItems: 4, itemDefaults: { expectedVersion: 1 } },
    }));
    const executor = createToolExecutor({ registry }, { delegate: {
      onAuthorize: ({ input }) => {
        if (Array.isArray((input as Record<string, unknown>).items)) return 'allow';
        delegated.push(input);
        return (input as Record<string, unknown>).expectedVersion === 2 ? 'deny' : 'allow';
      },
      onConfirm: ({ input }) => {
        if (Array.isArray((input as Record<string, unknown>).items)) return 'confirm';
        confirmed.push(input);
        return (input as Record<string, unknown>).expectedVersion === 3 ? 'deny' : 'confirm';
      },
    } });
    const call = (input: unknown) => executor.execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'write', input });
    const result = await call({ enabled: 'false', items: [
      { enabled: 'true' }, { expected_version: '2' }, { expected_version: '3' }, { expected_version: '4' },
    ] });
    expect(result.status).toBe('completed');
    expect(result.output).toMatchObject({ total: 4, succeeded: 1, failed: 3,
      results: [{ ok: false, error: expect.stringContaining('denied') }, { ok: false, error: expect.stringContaining('denied') },
        { ok: false, error: expect.stringContaining('confirmation-denied') }, { ok: true, result: { written: true } }] });
    expect(authorized).toEqual([{ expectedVersion: 1, enabled: true }, { expectedVersion: 2, enabled: false }, { expectedVersion: 3, enabled: false }, { expectedVersion: 4, enabled: false }]);
    expect(delegated).toEqual(authorized.slice(1));
    expect(confirmed).toEqual(authorized.slice(2));
    expect(handled).toEqual(authorized.slice(3));
    expect(handled[0]).toBe(confirmed[1]);
    expect(handled[0]).toBe(delegated[2]);
    expect(handled[0]).toBe(authorized[3]);
    expect((await call({ items: Array.from({ length: 5 }, () => ({ enabled: false })) })).error).toContain('most one call takes is 4');
    expect(handled).toHaveLength(1);
  });
});

it('fails batch items closed when no gated invocation port was supplied', async () => {
  const handler = vi.fn(async () => ({ written: true }));
  const registration = withBatchInput({ registration: {
    descriptor: { id: 'write', inputSchema }, policy: { authorize: () => 'allow' }, handler,
  }, tool: { toolId: 'write' } });
  const result = await registration.handler({ executionId: 'raw', principal: { id: 'owner' }, run: { id: 'run' }, signal: new AbortController().signal,
    input: { items: [{ expectedVersion: 3 }] } });
  expect(result).toMatchObject({ total: 1, succeeded: 0, failed: 1, results: [{ ok: false, error: expect.stringContaining('require the gated ToolExecutor') }] });
  expect(handler).not.toHaveBeenCalled();
});

it('retains live registration revocation while confirming a batch item', async () => {
  const { createToolRegistrationScope } = await import('@jini-ai/core');
  const registry = createToolRegistry({});
  const scope = createToolRegistrationScope({ registry });
  const handler = vi.fn(async () => ({ written: true }));
  scope.replace({ registrations: [withBatchInput({ registration: {
    descriptor: { id: 'write', inputSchema, requiresConfirmation: true }, policy: { authorize: () => 'allow' }, handler,
  }, tool: { toolId: 'write' } })] });
  const executor = createToolExecutor({ registry }, { delegate: { onConfirm: ({ input }) => {
    if (!Array.isArray((input as Record<string, unknown>).items)) scope.replace({ registrations: [] });
    return 'confirm';
  } } });
  const result = await executor.execute({ principal: { id: 'owner' }, run: { id: 'run' }, toolId: 'write', input: { items: [{ expectedVersion: 3 }, { expectedVersion: 3 }] } });
  expect(result.output).toMatchObject({ succeeded: 0, failed: 2 });
  expect(handler).not.toHaveBeenCalled();
});
