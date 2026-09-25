import { describe, expect, it } from 'vitest';
import { isReadOnlyTool, ToolInputError } from '@jini-ai/core';

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
} from '../registration-kit.js';

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
    expect(() => requireInputRecord('nope')).toThrow(ToolInputError);
  });

  it('requireString — missing key', () => {
    expect(() => requireString({}, 'themeId')).toThrow(ToolInputError);
  });

  it('requireString — wrong type', () => {
    expect(() => requireString({ themeId: 42 }, 'themeId')).toThrow(ToolInputError);
  });

  it('requireNumber', () => {
    expect(() => requireNumber({}, 'count')).toThrow(ToolInputError);
  });

  it('requireObject', () => {
    expect(() => requireObject({ filters: 'nope' }, 'filters')).toThrow(ToolInputError);
  });

  it('optionalString — wrong type', () => {
    expect(() => optionalString({ tier: 3 }, 'tier')).toThrow(ToolInputError);
  });

  it('optionalNumber — wrong type', () => {
    expect(() => optionalNumber({ limit: 'ten' }, 'limit')).toThrow(ToolInputError);
  });

  it('optionalBoolean — wrong type', () => {
    expect(() => optionalBoolean({ flag: 'yes' }, 'flag')).toThrow(ToolInputError);
  });

  it('requireNoInput — rejects a populated object', () => {
    expect(() => requireNoInput({ unexpected: true })).toThrow(ToolInputError);
  });

  it('a well-formed call does not throw', () => {
    expect(requireString({ themeId: 'plain' }, 'themeId')).toBe('plain');
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
      withSchemaOnRejection(
        { toolId: 'theme_read_file', catalog, isShapeRejection: (e) => e instanceof FakeThemeNotFoundError },
        async () => {
          throw new FakeThemeNotFoundError("theme 'nope' was not found");
        },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('withSchemaOnRejection leaves an UNrecognized rejection as whatever it originally was — not promoted to ToolInputError', async () => {
    const catalog = new Map();
    await expect(
      withSchemaOnRejection({ toolId: 'x', catalog, isShapeRejection: () => false }, async () => {
        throw new Error('a genuine internal failure');
      }),
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
    expect(registrations.map((r) => isReadOnlyTool(r.descriptor))).toEqual([true, false]);
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
      askHuman: async (_ctx, prepared) => {
        seen.push(["ask", prepared]);
        return { confirmed: true };
      },
      run: async (_ctx, prepared, confirmer) => {
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
        throw new ToolInputError("NO_CONFIRMATION_CHANNEL");
      },
      run: async () => {
        ran = true;
      },
    });
    await expect(handler(ctx())).rejects.toThrow("NO_CONFIRMATION_CHANNEL");
    expect(ran).toBe(false);
  });
});
