// PARITY: moved contracts preserve input refusals, independent risk gates and handler authorization.
import { describe, expect, it } from 'vitest';
import { isReadOnlyTool, ToolInputError, type ToolExecutionOptions, type SurfaceEmission } from '../index.js';

import {
  buildDomainRegistrations,
  decorateWithSchema,
  humanConfirmedHandler,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireInputRecord,
  requireNoInput,
  requireNumber,
  requireObject,
  requireString,
  withSchemaOnRejection,
  type AgentToolSideEffect,
  type AgentToolDefinition,
} from '../index.js';

it.each([undefined, null, {}, { permission: '' }, { permission: '  ' }, { permission: 1 }])('refuses a catalog entry with no authorization permission at composition (%j)', (authorization) => {
  const entry = { name: 'unsafe', description: 'Unsafe', sideEffects: 'none', inputSchema: { type: 'object' }, authorization } as unknown as AgentToolDefinition;
  expect(() => buildDomainRegistrations({
    domain: 'test', catalogModule: 'test/agent-tools.ts', catalog: new Map([['unsafe', entry]]),
    handlers: { unsafe: async () => null }, derivedRisk: new Map([['unsafe', 'none']]),
  })).toThrow(/unsafe.*authorization permission/);
});

/**
 * @file Every input reader in this kit throws `@jini-ai/core`'s `ToolInputError` — the marker
 * `@jini-ai/daemon`'s `ToolExecutor` reads to tag a `'failed'` execution `errorKind: 'validation'`,
 * which is what lets a transport (e.g. `@jini-ai/http-kit`'s `delegated-tools.ts`) answer a malformed
 * call with a real 400 instead of folding it into a redacted 500. Regression coverage for the
 * theme_list_files "wrong parameter name" bug: before this, `requireString` threw a plain `Error`,
 * indistinguishable from a genuine internal failure once it reached the transport.
 */
describe('registration-kit input readers throw ToolInputError, not a plain Error', () => {
  it('requireInputRecord', () => {
    expect(() => requireInputRecord({ input: 'nope' })).toThrow(ToolInputError);
  });

  it('requireString — missing key', () => {
    expect(() => requireString({ input: {}, key: 'themeId' })).toThrow(ToolInputError);
  });

  it('requireString — wrong type', () => {
    expect(() => requireString({ input: { themeId: 42 }, key: 'themeId' })).toThrow(ToolInputError);
  });

  it('requireString — missing key lists received keys without their values and keeps the prefix', () => {
    expect(() => requireString({
      input: { id: 'page-1', expectedVersion: 2, region: 'hero', html: '<p>private content</p>' },
      key: 'handle',
    })).toThrowError(new ToolInputError({
      message: "'handle' (non-empty string) is required; received: id, expectedVersion, region, html",
    }));
  });

  it.each([{ items: [] }, { items: [{ id: 'page-1' }] }])('requireString — missing key explains unsupported items[] batching (%j)', ({ items }) => {
    expect(() => requireString({ input: { items }, key: 'id' })).toThrowError(new ToolInputError({
      message: "'id' (non-empty string) is required; received: items; this tool takes one input per call — items[] batching is not supported here",
    }));
  });

  it('requireString — non-array items lists the key without a batching hint', () => {
    expect(() => requireString({ input: { items: 'wrong shape' }, key: 'id' })).toThrowError(new ToolInputError({
      message: "'id' (non-empty string) is required; received: items",
    }));
  });

  it('requireString — empty input keeps the exact existing message', () => {
    expect(() => requireString({ input: {}, key: 'handle' })).toThrowError(new ToolInputError({
      message: "'handle' (non-empty string) is required",
    }));
  });

  it.each(['', 42, null])('requireString — present invalid value keeps the exact existing message (%j)', (handle) => {
    expect(() => requireString({ input: { handle, items: [] }, key: 'handle' })).toThrowError(new ToolInputError({
      message: "'handle' (non-empty string) is required",
    }));
  });

  it('requireNumber', () => {
    expect(() => requireNumber({ input: {}, key: 'count' })).toThrow(ToolInputError);
  });

  it('requireNumber — missing key lists received keys without their values and keeps the prefix', () => {
    expect(() => requireNumber({
      input: { id: 'page-1', version: 2, html: '<p>private content</p>' },
      key: 'expectedVersion',
    })).toThrowError(new ToolInputError({
      message: "'expectedVersion' (number) is required; received: id, version, html",
    }));
  });

  it.each([{ items: [] }, { items: [{ id: 'page-1' }] }])('requireNumber — missing key explains unsupported items[] batching (%j)', ({ items }) => {
    expect(() => requireNumber({ input: { items }, key: 'count' })).toThrowError(new ToolInputError({
      message: "'count' (number) is required; received: items; this tool takes one input per call — items[] batching is not supported here",
    }));
  });

  it('requireNumber — non-array items lists the key without a batching hint', () => {
    expect(() => requireNumber({ input: { items: 'wrong shape' }, key: 'count' })).toThrowError(new ToolInputError({
      message: "'count' (number) is required; received: items",
    }));
  });

  it('requireNumber — empty input keeps the exact existing message', () => {
    expect(() => requireNumber({ input: {}, key: 'count' })).toThrowError(new ToolInputError({
      message: "'count' (number) is required",
    }));
  });

  it.each(['2', null, NaN, Infinity, -Infinity])('requireNumber — present invalid value keeps the exact existing message (%s)', (count) => {
    expect(() => requireNumber({ input: { count, items: [] }, key: 'count' })).toThrowError(new ToolInputError({
      message: "'count' (number) is required",
    }));
  });

  it('requireObject', () => {
    expect(() => requireObject({ input: { filters: 'nope' }, key: 'filters' })).toThrow(ToolInputError);
  });

  it('requireObject — missing key lists received keys without their values and keeps the prefix', () => {
    expect(() => requireObject({
      input: { id: 'page-1', filter: { html: '<p>private content</p>' } },
      key: 'filters',
    })).toThrowError(new ToolInputError({
      message: "'filters' (object) is required; received: id, filter",
    }));
  });

  it.each([{ items: [] }, { items: [{ id: 'page-1' }] }])('requireObject — missing key explains unsupported items[] batching (%j)', ({ items }) => {
    expect(() => requireObject({ input: { items }, key: 'filters' })).toThrowError(new ToolInputError({
      message: "'filters' (object) is required; received: items; this tool takes one input per call — items[] batching is not supported here",
    }));
  });

  it('requireObject — non-array items lists the key without a batching hint', () => {
    expect(() => requireObject({ input: { items: 'wrong shape' }, key: 'filters' })).toThrowError(new ToolInputError({
      message: "'filters' (object) is required; received: items",
    }));
  });

  it('requireObject — empty input keeps the exact existing message', () => {
    expect(() => requireObject({ input: {}, key: 'filters' })).toThrowError(new ToolInputError({
      message: "'filters' (object) is required",
    }));
  });

  it.each([{ filters: 'nope' }, { filters: null }, { filters: [] }, { filters: 42 }])('requireObject — present invalid value keeps the exact existing message (%j)', ({ filters }) => {
    expect(() => requireObject({ input: { filters, items: [] }, key: 'filters' })).toThrowError(new ToolInputError({
      message: "'filters' (object) is required",
    }));
  });

  it('optionalString — wrong type', () => {
    expect(() => optionalString({ input: { tier: 3 }, key: 'tier' })).toThrow(ToolInputError);
  });

  it('optionalNumber — wrong type', () => {
    expect(() => optionalNumber({ input: { limit: 'ten' }, key: 'limit' })).toThrow(ToolInputError);
  });

  it('optionalBoolean — wrong type', () => {
    expect(() => optionalBoolean({ input: { flag: 'yes' }, key: 'flag' })).toThrow(ToolInputError);
  });

  it('requireNoInput — rejects a populated object', () => {
    expect(() => requireNoInput({ input: { unexpected: true } })).toThrow(ToolInputError);
  });

  it('a well-formed call does not throw', () => {
    expect(requireString({ input: { themeId: 'plain' }, key: 'themeId' })).toBe('plain');
  });
});

describe('decorateWithSchema / withSchemaOnRejection preserve the ToolInputError marker on domain shape rejections', () => {
  class FakeThemeNotFoundError extends Error {}

  it('decorateWithSchema returns a ToolInputError', () => {
    const decorated = decorateWithSchema({
      toolId: 'theme_read_file',
      catalog: new Map([['theme_read_file', { name: 'theme_read_file', description: 'x', sideEffects: 'none', authorization: { permission: 'theme.set' }, inputSchema: { type: 'object' } }]]),
      message: "theme 'nope' was not found",
    });
    expect(decorated).toBeInstanceOf(ToolInputError);
    expect(decorated.message).toContain("theme 'nope' was not found");
  });

  it('withSchemaOnRejection re-throws a recognized shape rejection as a ToolInputError', async () => {
    const catalog = new Map([['theme_read_file', { name: 'theme_read_file', description: 'x', sideEffects: 'none' as const, authorization: { permission: 'theme.set' }, inputSchema: { type: 'object' } }]]);
    await expect(
      withSchemaOnRejection({ toolId: 'theme_read_file', catalog, isShapeRejection: ({ error: e }) => e instanceof FakeThemeNotFoundError, fn: async () => {
          throw new FakeThemeNotFoundError("theme 'nope' was not found");
        } }),
    ).rejects.toThrow(ToolInputError);
  });

  it('withSchemaOnRejection leaves an UNrecognized rejection as whatever it originally was — not promoted to ToolInputError', async () => {
    const catalog = new Map();
    await expect(
      withSchemaOnRejection({ toolId: 'x', catalog, isShapeRejection: () => false, fn: async () => {
        throw new Error('a genuine internal failure');
      } }),
    ).rejects.not.toBeInstanceOf(ToolInputError);
  });
});

/**
 * @file (cont.) The one place a domain's declared `sideEffects` becomes the descriptor flag every
 * read-only gate reads. Change the mapping here and every one of the twelve domains follows; there
 * is no per-domain copy to keep in step.
 */
describe('buildDomainRegistrations projects sideEffects onto ToolDescriptor.readOnly', () => {
  const inputSchema = { type: "object", additionalProperties: false, properties: {} } as const;

  function build(entries: Array<{ name: string; sideEffects: AgentToolSideEffect }>): ReturnType<typeof buildDomainRegistrations> {
    const catalog = new Map(
      entries.map((e) => [
        e.name,
        { name: e.name, description: `${e.name} description`, sideEffects: e.sideEffects, authorization: { permission: "p" }, inputSchema },
      ]),
    );
    return buildDomainRegistrations({
      domain: "test",
      catalogModule: "test/agent-tools.ts",
      catalog,
      handlers: Object.fromEntries(entries.map((e) => [e.name, async () => "ok"])),
      derivedRisk: new Map(entries.map((e) => [e.name, e.sideEffects])),
    });
  }

  it('marks a sideEffects:"none" tool readOnly: true', () => {
    const [registration] = build([{ name: "thing_list", sideEffects: "none" }]);
    expect(registration!.descriptor).toMatchObject({ id: "thing_list", readOnly: true });
  });

  it('marks every state-changing classification readOnly: false — including a delete and a token mint', () => {
    const registrations = build([
      { name: "thing_update", sideEffects: "mutates-durable-state" },
      { name: "thing_delete", sideEffects: "deletes-durable-state" },
      { name: "thing_token", sideEffects: "mints-token" },
    ]);
    expect(registrations.map((r) => [r.descriptor.id, r.descriptor.readOnly])).toEqual([
      ["thing_update", false],
      ["thing_delete", false],
      ["thing_token", false],
    ]);
  });

  it('agrees with @jini-ai/core\'s isReadOnlyTool, the single determination every gate consults', () => {
    const registrations = build([
      { name: "thing_list", sideEffects: "none" },
      { name: "thing_update", sideEffects: "mutates-durable-state" },
    ]);
    expect(registrations.map((r) => isReadOnlyTool({ descriptor: r.descriptor }))).toEqual([true, false]);
  });
});

/**
 * @file (cont.) A tool whose actor-class rule needs a human confirmer is wirable only through
 * `humanConfirmedHandler`: the human's answer comes from the host's confirmation transport, never
 * from the model's input, and `run` gets the delegating human as the confirmer.
 */
describe('humanConfirmedHandler: the sanctioned wiring for confirmer-must-equal-own-delegatedBy tools', () => {
  const inputSchema = { type: "object", additionalProperties: false, properties: {} } as const;
  const catalog = new Map([
    [
      "thing_execute",
      {
        name: "thing_execute",
        description: "thing_execute description",
        sideEffects: "mutates-durable-state" as const,
        authorization: { permission: "p" },
        actorClassRule: "confirmer-must-equal-own-delegatedBy" as const,
        inputSchema,
      },
    ],
  ]);
  const derivedRisk = new Map<string, AgentToolSideEffect>([["thing_execute", "mutates-durable-state"]]);

  function ctx(input: unknown = {}) {
    return {
      executionId: "exec-1",
      principal: { id: "human-1" },
      run: { id: "run-1" },
      input,
      signal: new AbortController().signal,
    };
  }

  function wire(handler: Parameters<typeof buildDomainRegistrations>[0]["handlers"][string]) {
    return buildDomainRegistrations({ domain: "test", catalogModule: "test/agent-tools.ts", catalog, handlers: { thing_execute: handler }, derivedRisk });
  }

  it('still refuses a plain handler for a tool carrying the rule, at build time', () => {
    expect(() => wire(async () => "ran")).toThrow(
      "tool-registrations: 'thing_execute' declares actorClassRule 'confirmer-must-equal-own-delegatedBy', which needs a human confirmer — build its handler with humanConfirmedHandler so a human answers through the host's confirmation transport (see ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT)",
    );
  });

  it('wires a humanConfirmedHandler, and never sets requiresConfirmation on the descriptor', () => {
    const [registration] = wire(humanConfirmedHandler({ prepare: async () => null, askHuman: async () => ({ confirmed: true }), run: async () => "ran" }));
    expect(registration!.descriptor.id).toBe("thing_execute");
    expect(registration!.descriptor).not.toHaveProperty("requiresConfirmation");
  });

  it('a human confirm runs the action, with the delegating human as a kind "user" confirmer', async () => {
    const seen: unknown[] = [];
    const handler = humanConfirmedHandler({
      prepare: async () => ({ planHash: "h1" }),
      askHuman: async ({ prepared }) => {
        seen.push(["ask", prepared]);
        return { confirmed: true };
      },
      run: async ({ prepared, confirmer }) => {
        seen.push(["run", prepared, confirmer]);
        return { executed: true };
      },
    });
    expect(await handler(ctx())).toEqual({ executed: true });
    expect(seen).toEqual([
      ["ask", { planHash: "h1" }],
      ["run", { planHash: "h1" }, { id: "human-1", kind: "user" }],
    ]);
  });

  // REGRESSION: dropping options at any step loses the transport's confirmation channel.
  it('forwards execution options through every step and emits the human confirmation before running', async () => {
    const emissions: SurfaceEmission[] = [];
    const options: ToolExecutionOptions = {
      emitSurface: async (emission) => { emissions.push(emission); },
    };
    const handler = humanConfirmedHandler({
      prepare: async ({ ctx: context }, optional) => {
        expect(optional).toBe(options);
        return { principalId: context.principal.id, planHash: 'h1' };
      },
      askHuman: async ({ prepared }, optional) => {
        if (!optional?.emitSurface) throw new Error('NO_CONFIRMATION_CHANNEL');
        expect(optional).toBe(options);
        await optional.emitSurface({ channel: 'surface_request', payload: prepared });
        return { confirmed: true };
      },
      run: async ({ confirmer }, optional) => {
        expect(optional).toBe(options);
        expect(emissions).toEqual([{
          channel: 'surface_request', payload: { principalId: 'human-1', planHash: 'h1' },
        }]);
        return { executed: true, confirmer };
      },
    });
    expect(await handler(ctx(), options)).toEqual({
      executed: true, confirmer: { id: 'human-1', kind: 'user' },
    });
  });

  it('a human decline returns the not-confirmed result and never runs', async () => {
    let ran = false;
    const handler = humanConfirmedHandler({
      prepare: async () => null,
      askHuman: async () => ({ confirmed: false, result: { executed: false, cancelled: true } }),
      run: async () => {
        ran = true;
      },
    });
    expect(await handler(ctx())).toEqual({ executed: false, cancelled: true });
    expect(ran).toBe(false);
  });

  it('model input claiming confirmation does not count — only the human answer does', async () => {
    let ran = false;
    const handler = humanConfirmedHandler({
      prepare: async () => null,
      askHuman: async () => ({ confirmed: false, result: { executed: false } }),
      run: async () => {
        ran = true;
      },
    });
    expect(await handler(ctx({ confirm: true, confirmed: true, confirmationToken: "tok" }))).toEqual({ executed: false });
    expect(ran).toBe(false);
  });

  it('an answer that is only truthy, not exactly confirmed: true, is a no', async () => {
    let ran = false;
    const handler = humanConfirmedHandler({
      prepare: async () => null,
      askHuman: async () => ({ confirmed: "yes", result: { executed: false } }) as never,
      run: async () => {
        ran = true;
      },
    });
    expect(await handler(ctx())).toEqual({ executed: false });
    expect(ran).toBe(false);
  });

  it('a failing ask (no channel) propagates and never runs', async () => {
    let ran = false;
    const handler = humanConfirmedHandler({
      prepare: async () => null,
      askHuman: async () => {
        throw new ToolInputError({ message: "NO_CONFIRMATION_CHANNEL" });
      },
      run: async () => {
        ran = true;
      },
    });
    await expect(handler(ctx())).rejects.toThrow("NO_CONFIRMATION_CHANNEL");
    expect(ran).toBe(false);
  });
});

// PARITY: recognized error-like objects retain their message without asserting an Error shape.
it('preserves a recognized error-like rejection message', async () => {
  await expect(withSchemaOnRejection({ toolId: 'x', catalog: new Map(),
    isShapeRejection: () => true, fn: async () => { throw { message: 'missing field' }; },
  })).rejects.toThrow('missing field');
});
// REGRESSION: fails if the wrapper again reads .message blindly from a thrown string.
it('retains a recognized non-Error rejection as model-facing text', async () => {
  await expect(withSchemaOnRejection({ toolId: 'x', catalog: new Map(),
    isShapeRejection: () => true, fn: async () => { throw 'missing field'; },
  })).rejects.toThrow('missing field');
});
