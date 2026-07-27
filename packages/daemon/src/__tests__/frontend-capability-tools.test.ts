import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_FRONTEND_CAPABILITY_TIMEOUT_MS,
  createFrontendCapabilityRegistrations,
  denyAllFrontendCapabilityPolicy,
} from '../frontend-capability-tools.js';
import {
  createFrontendSessionRegistry,
  type FrontendSessionRegistry,
} from '../frontend-session-registry.js';
import type { ToolExecutionContext } from '@jini/core';

const PAGE_CLICK = {
  id: 'page.click',
  description: 'Activate one control.',
} as const;

const CHAT_RESET = {
  id: 'chat.reset_conversation',
  description: 'Throw the conversation away.',
  requiresConfirmation: true,
} as const;

/** A `ToolExecutionContext` with only the fields these handlers actually read. */
function executionContext(overrides: {
  runId?: string;
  input?: unknown;
  signal?: AbortSignal;
} = {}): ToolExecutionContext {
  return {
    executionId: 'exec-1',
    principal: { id: 'principal-1', kind: 'user' },
    run: { id: overrides.runId ?? 'run-1' },
    input: overrides.input,
    signal: overrides.signal ?? new AbortController().signal,
  } as ToolExecutionContext;
}

/** Records what `invoke` was handed, so a test can assert routing without a live surface. */
function recordingRegistry(): {
  registry: FrontendSessionRegistry;
  invoke: ReturnType<typeof vi.fn>;
} {
  const invoke = vi.fn(async () => 'ok');
  return { registry: { invoke } as unknown as FrontendSessionRegistry, invoke };
}

describe('denyAllFrontendCapabilityPolicy', () => {
  it('denies every call, so registering a manifest never grants access on its own', () => {
    expect(denyAllFrontendCapabilityPolicy.authorize({} as never)).toBe('deny');
  });
});

describe('createFrontendCapabilityRegistrations', () => {
  describe('descriptors', () => {
    it('uses each capability id verbatim as the tool id, in manifest order', () => {
      const { registry } = recordingRegistry();

      const registrations = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK, CHAT_RESET],
      });

      expect(registrations.map((r) => r.descriptor.id)).toEqual(['page.click', 'chat.reset_conversation']);
      expect(registrations[0]?.descriptor.description).toBe('Activate one control.');
    });

    it('applies the default timeout so a surface that never answers cannot hang the run', () => {
      const { registry } = recordingRegistry();

      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
      });

      expect(registration?.descriptor.timeoutMs).toBe(DEFAULT_FRONTEND_CAPABILITY_TIMEOUT_MS);
    });

    it('lets a host override the timeout', () => {
      const { registry } = recordingRegistry();

      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
        timeoutMs: 1_500,
      });

      expect(registration?.descriptor.timeoutMs).toBe(1_500);
    });

    it('carries requiresConfirmation through to the descriptor, and omits it when unset', () => {
      const { registry } = recordingRegistry();

      const [click, reset] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK, CHAT_RESET],
      });

      expect(reset?.descriptor.requiresConfirmation).toBe(true);
      expect(click?.descriptor).not.toHaveProperty('requiresConfirmation');
    });

    it('carries inputSchema onto the descriptor so ToolRegistry.list() can describe the arguments', () => {
      const { registry } = recordingRegistry();
      const schema = {
        type: 'object',
        properties: { element: { type: 'string' } },
        required: ['element'],
        additionalProperties: false,
      };

      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [{ ...PAGE_CLICK, inputSchema: schema }],
      });

      expect(registration?.descriptor.inputSchema).toEqual(schema);
    });

    // Present-but-undefined and absent serialize identically, so a catalog would render
    // "takes no arguments" for a capability that takes several.
    it('omits inputSchema entirely rather than setting it to undefined', () => {
      const { registry } = recordingRegistry();

      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
      });

      expect(registration?.descriptor).not.toHaveProperty('inputSchema');
    });

    it('accepts a full CapabilityDef-shaped manifest entry without conversion', () => {
      const { registry } = recordingRegistry();
      // The shape @jini/agentic's PAGE_CAPABILITIES entries actually have, extra fields and all.
      const capabilityDef = {
        id: 'page.fill',
        description: 'Type text into one input field.',
        inputSchema: { type: 'object', properties: { element: { type: 'string' } } },
        risk: 'write' as const,
        surface: 'session' as const,
      };

      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [capabilityDef],
      });

      expect(registration?.descriptor.id).toBe('page.fill');
      expect(registration?.descriptor.inputSchema).toEqual(capabilityDef.inputSchema);
    });

    it('carries maxOutputBytes through when supplied, and omits it when not', () => {
      const { registry } = recordingRegistry();

      const [bounded] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
        maxOutputBytes: 4_096,
      });
      const [unbounded] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
      });

      expect(bounded?.descriptor.maxOutputBytes).toBe(4_096);
      expect(unbounded?.descriptor).not.toHaveProperty('maxOutputBytes');
    });
  });

  describe('policy', () => {
    it('defaults to deny-by-default rather than granting page control for free', () => {
      const { registry } = recordingRegistry();

      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
      });

      expect(registration?.policy).toBe(denyAllFrontendCapabilityPolicy);
    });

    it('uses the host-supplied policy when there is one', () => {
      const { registry } = recordingRegistry();
      const policy = { authorize: () => 'allow' as const };

      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
        policy,
      });

      expect(registration?.policy).toBe(policy);
    });
  });

  describe('handler routing', () => {
    it('routes to the calling run, the capability id, the input and the executor signal', async () => {
      const { registry, invoke } = recordingRegistry();
      const controller = new AbortController();
      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
      });

      await registration?.handler(
        executionContext({ runId: 'run-9', input: { element: 'save' }, signal: controller.signal }),
      );

      expect(invoke).toHaveBeenCalledWith('run-9', 'page.click', { element: 'save' }, controller.signal);
    });

    it('resolves with whatever the surface returned', async () => {
      const { registry, invoke } = recordingRegistry();
      invoke.mockResolvedValueOnce({ clicked: 'save' });
      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
      });

      await expect(registration?.handler(executionContext())).resolves.toEqual({ clicked: 'save' });
    });

    it('rejects when the surface refuses, rather than swallowing the refusal', async () => {
      const { registry, invoke } = recordingRegistry();
      invoke.mockRejectedValueOnce(new Error('no element published as "save" on this page'));
      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
      });

      await expect(registration?.handler(executionContext())).rejects.toThrow(
        'no element published as "save" on this page',
      );
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
    ])('treats %s input as no arguments, so a zero-argument capability needs no empty object', async (_label, input) => {
      const { registry, invoke } = recordingRegistry();
      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
      });

      await registration?.handler(executionContext({ input }));

      expect(invoke).toHaveBeenCalledWith('run-1', 'page.click', {}, expect.anything());
    });

    it.each([
      ['an array', ['element'], 'array'],
      ['a string', 'save', 'string'],
      ['a number', 7, 'number'],
      ['a boolean', true, 'boolean'],
    ])('rejects %s input by naming what arrived, instead of coercing it to {}', async (_label, input, received) => {
      const { registry, invoke } = recordingRegistry();
      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
      });

      await expect(registration?.handler(executionContext({ input }))).rejects.toThrow(
        `page.click: input must be a JSON object, received ${received}`,
      );
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  describe('against a real registry', () => {
    it('completes a round trip from tool handler to attached surface and back', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      const delivered: unknown[] = [];
      registry.attach({ sessionId: 'session-1', capabilities: ['page.click'] }, (invocation) => {
        delivered.push(invocation);
      });
      registry.bindRun('run-1', 'session-1');
      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
        policy: { authorize: () => 'allow' },
      });

      const pending = registration?.handler(executionContext({ input: { element: 'save' } }));
      await Promise.resolve();

      expect(delivered).toEqual([
        { invocationId: 'inv-1', capabilityId: 'page.click', input: { element: 'save' } },
      ]);
      registry.settle('session-1', 'inv-1', { ok: true, output: { clicked: 'save' } });
      await expect(pending).resolves.toEqual({ clicked: 'save' });
    });

    it('fails closed with the registry\'s own message when no surface is bound to the run', async () => {
      const registry = createFrontendSessionRegistry();
      const [registration] = createFrontendCapabilityRegistrations({
        registry,
        capabilities: [PAGE_CLICK],
        policy: { authorize: () => 'allow' },
      });

      await expect(registration?.handler(executionContext({ runId: 'run-unbound' }))).rejects.toThrow(
        'no frontend is bound to run "run-unbound", so "page.click" cannot be executed',
      );
    });
  });
});
