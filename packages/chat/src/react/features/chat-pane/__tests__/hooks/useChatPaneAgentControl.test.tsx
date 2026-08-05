import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { CHAT_PANE_AGENT_TOOLS } from '../../agent-tools.js';
import type {
  ChatPaneAgent,
  ChatPaneAgentBridgeAccess,
  ChatPaneAgentToolAction,
} from '../../types.js';
import { useChatPane, type UseChatPaneResult } from '../../hooks/useChatPane.hooks.js';
import { useChatPaneAgentControl } from '../../hooks/useChatPaneAgentControl.hooks.js';

const agents: ChatPaneAgent[] = [
  { id: 'codex', name: 'Codex CLI', available: true },
  { id: 'offline', name: 'Offline CLI', available: false },
  // Unavailable *and* able to say why — a refusal should pass that reason through rather than
  // making the caller guess whether the runtime is missing, unauthenticated, or misconfigured.
  { id: 'unauthed', name: 'Unauthed CLI', available: false, diagnostic: 'run `unauthed login` first' },
];

interface RegisteredTool {
  name: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Minimal stand-in for the draft `document.modelContext` surface the hook feature-detects. */
function installModelContext(): {
  tools: Map<string, RegisteredTool>;
  registerCalls: number;
  unregistered: string[];
} {
  const state = { tools: new Map<string, RegisteredTool>(), registerCalls: 0, unregistered: [] as string[] };
  Object.defineProperty(globalThis.document, 'modelContext', {
    configurable: true,
    writable: true,
    value: {
      registerTool(tool: RegisteredTool) {
        state.registerCalls += 1;
        state.tools.set(tool.name, tool);
      },
      unregisterTool(name: string) {
        state.unregistered.push(name);
        state.tools.delete(name);
      },
    },
  });
  return state;
}

function removeModelContext(): void {
  Reflect.deleteProperty(globalThis.document as unknown as Record<string, unknown>, 'modelContext');
}

/** Renders a pane plus its agent-control surface, exposing both to the test. */
function renderControlledPane(
  options: {
    enabled?: boolean;
    /** Defaults to true here; the not-by-default behavior is asserted separately. */
    webmcp?: boolean;
    workingDirectory?: string | null;
    /** Host filesystem bridge — required for the pane to ever mark a directory invalid. */
    directoryExists?: boolean;
    recentDirectories?: readonly string[];
    bridgeAccess?: ChatPaneAgentBridgeAccess;
    /** Overrides the runtime inventory — a pane with none is a real state (daemon offline). */
    agents?: readonly ChatPaneAgent[];
  } = {},
) {
  const transport = createFakeChatTransport();
  const needsAccess = options.directoryExists !== undefined || options.recentDirectories !== undefined;
  const view = renderHook(() => {
    const pane = useChatPane({
      transport,
      agents: options.agents ?? agents,
      selection: { agentId: 'codex' },
      conversationId: null,
      ...(options.workingDirectory === undefined ? {} : { workingDirectory: options.workingDirectory }),
      ...(needsAccess
        ? {
            workingDirectoryAccess: {
              pickWorkingDirectory: async () => null,
              recentDirectories: async () => [...(options.recentDirectories ?? [])],
              directoryExists: async () => options.directoryExists ?? true,
            },
          }
        : {}),
    });
    useChatPaneAgentControl(pane, {
      enabled: options.enabled ?? true,
      // These cases are about what the WebMCP surface does once a host has accepted it, so they
      // opt in. That it is *not* on by default has its own case at the bottom of this file.
      webmcp: options.webmcp ?? true,
      ...(options.bridgeAccess === undefined ? {} : { bridgeAccess: options.bridgeAccess }),
    });
    return pane;
  });
  return { transport, view, pane: () => view.result.current as UseChatPaneResult };
}

afterEach(() => {
  removeModelContext();
  vi.restoreAllMocks();
});

describe('useChatPaneAgentControl — registration lifecycle', () => {
  it('registers every manifest tool once and does not re-register when the host re-renders with a fresh inline bridge object', () => {
    const context = installModelContext();
    const subscribe = vi.fn(() => vi.fn());
    const bridge: ChatPaneAgentBridgeAccess = {
      subscribe,
      respondSuccess: vi.fn(async () => undefined),
      respondError: vi.fn(async () => undefined),
    };
    const transport = createFakeChatTransport();

    const view = renderHook(() => {
      const pane = useChatPane({ transport, agents, selection: { agentId: 'codex' } });
      // A NEW object literal every render — exactly how hosts write this prop in JSX.
      useChatPaneAgentControl(pane, { enabled: true, webmcp: true, bridgeAccess: { ...bridge } });
      return pane;
    });

    expect(context.registerCalls).toBe(CHAT_PANE_AGENT_TOOLS.length);
    expect(subscribe).toHaveBeenCalledTimes(1);

    view.rerender();
    view.rerender();

    // The regression this guards: an identity-based dep re-ran the effect every render, tearing
    // down and re-registering all tools and dropping in-flight relayed actions.
    expect(context.registerCalls).toBe(CHAT_PANE_AGENT_TOOLS.length);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(context.unregistered).toEqual([]);
  });

  it('registers nothing while disabled and unregisters on unmount', () => {
    const context = installModelContext();
    const disabled = renderControlledPane({ enabled: false });
    expect(context.registerCalls).toBe(0);
    disabled.view.unmount();

    const enabled = renderControlledPane({ enabled: true });
    expect(context.registerCalls).toBe(CHAT_PANE_AGENT_TOOLS.length);
    enabled.view.unmount();
    expect(context.unregistered).toEqual(CHAT_PANE_AGENT_TOOLS.map((tool) => tool.id));
  });
});

describe('useChatPaneAgentControl — chat.send_message goes through the pane guard', () => {
  it('sends through the guarded path, carrying staged attachments and resetting the composer', async () => {
    const context = installModelContext();
    const { transport, pane } = renderControlledPane();

    act(() => {
      pane().composer.setDraft('a draft the agent did not write');
      pane().composer.addAttachment({ path: '/tmp/a.txt', name: 'a.txt', kind: 'file' });
    });

    await act(async () => {
      await context.tools.get('chat.send_message')?.execute({ prompt: 'agent prompt' });
    });

    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input).toMatchObject({
      agentId: 'codex',
      attachments: [{ path: '/tmp/a.txt', name: 'a.txt', kind: 'file' }],
    });
    // Regression: the old direct `conversation.sendMessage` call silently dropped staged
    // attachments and left the composer draft in place.
    expect(pane().composer.draft).toBe('');
  });

  it('refuses to send while a run is streaming, with a reason instead of a silent bypass', async () => {
    const context = installModelContext();
    const { transport, pane } = renderControlledPane();

    await act(async () => {
      await context.tools.get('chat.send_message')?.execute({ prompt: 'first' });
    });
    await waitFor(() => expect(pane().conversation.isStreaming).toBe(true));

    await expect(
      context.tools.get('chat.send_message')?.execute({ prompt: 'second, mid-stream' }),
    ).rejects.toThrow(/streaming/);
    expect(transport.calls).toHaveLength(1);
  });

  it('refuses to send while the working directory is invalid', async () => {
    const context = installModelContext();
    const { transport, pane } = renderControlledPane({
      workingDirectory: '/does/not/exist',
      directoryExists: false,
    });

    await waitFor(() => expect(pane().sendBlocker).not.toBeNull());
    await expect(
      context.tools.get('chat.send_message')?.execute({ prompt: 'nope' }),
    ).rejects.toThrow(/cannot send/);
    expect(transport.calls).toHaveLength(0);
  });

  it('rejects a missing or empty prompt', async () => {
    const context = installModelContext();
    renderControlledPane();
    await expect(context.tools.get('chat.send_message')?.execute({})).rejects.toThrow(/"prompt" is required/);
    await expect(context.tools.get('chat.send_message')?.execute({ prompt: '' })).rejects.toThrow(
      /"prompt" is required/,
    );
  });
});

describe('useChatPaneAgentControl — destructive and privileged capabilities', () => {
  it('requires explicit confirmation before resetting the conversation', async () => {
    const context = installModelContext();
    const { transport, pane } = renderControlledPane();

    await act(async () => {
      await context.tools.get('chat.send_message')?.execute({ prompt: 'hello' });
    });
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    const messagesBefore = pane().conversation.messages.length;
    expect(messagesBefore).toBeGreaterThan(0);

    await expect(context.tools.get('chat.reset_conversation')?.execute({})).rejects.toThrow(/confirm/);
    await expect(
      context.tools.get('chat.reset_conversation')?.execute({ confirm: 'yes' }),
    ).rejects.toThrow(/confirm/);
    expect(pane().conversation.messages).toHaveLength(messagesBefore);

    await act(async () => {
      await context.tools.get('chat.reset_conversation')?.execute({ confirm: true });
    });
    expect(pane().conversation.messages).toEqual([]);
  });

  it('rejects an unapproved working directory but accepts one the user already approved', async () => {
    const context = installModelContext();
    const { pane } = renderControlledPane({ recentDirectories: ['/work/approved'] });

    // Fail-closed by construction: the recent list is empty until the user opens the host picker,
    // so the capability rejects EVERYTHING before then — including paths the host would allow.
    expect(pane().recentDirectories).toEqual([]);
    await expect(
      context.tools.get('chat.set_working_directory')?.execute({ path: '/work/approved' }),
    ).rejects.toThrow(/recentDirectories/);

    await act(async () => {
      await pane().openWorkingDirectoryPicker();
    });
    await waitFor(() => expect(pane().recentDirectories).toContain('/work/approved'));

    // Regression: a model-supplied path went straight to `selectRecentDirectory`, inverting the
    // host's human-approval model.
    await expect(
      context.tools.get('chat.set_working_directory')?.execute({ path: '/etc' }),
    ).rejects.toThrow(/recentDirectories/);
    expect(pane().workingDirectory).not.toBe('/etc');

    await act(async () => {
      await context.tools.get('chat.set_working_directory')?.execute({ path: '/work/approved' });
    });
    expect(pane().workingDirectory).toBe('/work/approved');
  });

  it('flags truncation and labels untrusted content in chat.get_state', async () => {
    const context = installModelContext();
    const { pane } = renderControlledPane();
    const long = 'x'.repeat(2500);

    act(() => {
      pane().conversation.setMessages([{ id: 'm1', role: 'assistant', content: long }]);
    });

    const state = await context.tools.get('chat.get_state')?.execute({}) as {
      lastMessage?: { content: string; truncated: boolean; originalLength: number };
      untrustedFields: string[];
      sendBlocker: string | null;
      recentDirectories: readonly string[];
    };

    expect(state.lastMessage?.content).toHaveLength(2000);
    // Regression: content was sliced with no signal that anything had been cut.
    expect(state.lastMessage?.truncated).toBe(true);
    expect(state.lastMessage?.originalLength).toBe(2500);
    expect(state.untrustedFields).toContain('lastMessage.content');
    expect(state).toHaveProperty('sendBlocker');
    expect(state).toHaveProperty('recentDirectories');
  });

  it('reports an unknown capability id rather than silently succeeding', async () => {
    const context = installModelContext();
    renderControlledPane();
    const send = context.tools.get('chat.send_message');
    expect(send).toBeDefined();
    // The manifest is the allowlist: nothing outside it is registered.
    expect(context.tools.has('chat.evaluate')).toBe(false);
  });
});

describe('useChatPaneAgentControl — bridge response delivery', () => {
  function createBridge() {
    let emit: ((action: ChatPaneAgentToolAction) => void) | undefined;
    const bridge = {
      subscribe: vi.fn((onAction: (action: ChatPaneAgentToolAction) => void) => {
        emit = onAction;
        return vi.fn();
      }),
      respondSuccess: vi.fn(async (_invocationId: string, _output: unknown) => undefined),
      respondError: vi.fn(async (_invocationId: string, _message: string) => undefined),
    };
    return { bridge, emit: (action: ChatPaneAgentToolAction) => emit?.(action) };
  }

  it('reports a failed delivery as a delivery failure, not as a failed action', async () => {
    installModelContext();
    const { bridge, emit } = createBridge();
    bridge.respondSuccess.mockRejectedValueOnce(new Error('socket closed'));
    const { pane } = renderControlledPane({ bridgeAccess: bridge });

    await act(async () => {
      emit({ invocationId: 'inv-1', capabilityId: 'chat.get_state', input: {} });
      await Promise.resolve();
    });

    await waitFor(() => expect(bridge.respondError).toHaveBeenCalledTimes(1));
    // The action itself succeeded — the old `.then(...).catch(...)` chain reported this as an
    // execution failure because the delivery rejection landed in the same catch.
    expect(bridge.respondError.mock.calls[0]?.[1]).toMatch(/could not be delivered/);
    expect(pane().activity).not.toBe('failed');
  });

  it('reports an execution failure through respondError and survives a dead channel', async () => {
    installModelContext();
    const { bridge, emit } = createBridge();
    bridge.respondError.mockRejectedValue(new Error('channel gone'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    renderControlledPane({ bridgeAccess: bridge });

    await act(async () => {
      emit({ invocationId: 'inv-2', capabilityId: 'chat.reset_conversation', input: {} });
      await Promise.resolve();
    });

    await waitFor(() => expect(bridge.respondError).toHaveBeenCalledTimes(1));
    expect(bridge.respondError.mock.calls[0]?.[1]).toMatch(/confirm/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });

  it('answers a relayed action successfully when delivery works', async () => {
    installModelContext();
    const { bridge, emit } = createBridge();
    renderControlledPane({ bridgeAccess: bridge });

    await act(async () => {
      emit({ invocationId: 'inv-3', capabilityId: 'chat.get_state', input: {} });
      await Promise.resolve();
    });

    await waitFor(() => expect(bridge.respondSuccess).toHaveBeenCalledTimes(1));
    expect(bridge.respondSuccess.mock.calls[0]?.[0]).toBe('inv-3');
    expect(bridge.respondError).not.toHaveBeenCalled();
  });
});

describe('useChatPaneAgentControl — host surface detection', () => {
  function installNavigatorModelContext() {
    const state = { tools: new Map<string, RegisteredTool>() };
    Object.defineProperty(globalThis.navigator, 'modelContext', {
      configurable: true,
      writable: true,
      value: {
        registerTool(tool: RegisteredTool) { state.tools.set(tool.name, tool); },
      },
    });
    return state;
  }

  it('falls back to navigator.modelContext when document does not carry it', async () => {
    // WebMCP moved from navigator to document on 2026-07-21 and Chrome 150 deprecated the old
    // location while the origin trial still serves it — both paths have to work.
    const context = installNavigatorModelContext();
    try {
      const { pane } = renderControlledPane();
      expect(context.tools.size).toBe(CHAT_PANE_AGENT_TOOLS.length);
      const state = await context.tools.get('chat.get_state')?.execute({});
      expect(state).toHaveProperty('activity');
      expect(pane().activity).toBeDefined();
    } finally {
      Reflect.deleteProperty(globalThis.navigator as unknown as Record<string, unknown>, 'modelContext');
    }
  });

  it('is a no-op when no host surface exists at all', () => {
    // Neither document nor navigator carries modelContext: registration must simply not happen
    // rather than throw, since this is the common case in every browser today.
    expect(() => renderControlledPane()).not.toThrow();
  });

  it('defaults to disabled when `enabled` is omitted', () => {
    const context = installModelContext();
    const transport = createFakeChatTransport();
    renderHook(() => {
      const pane = useChatPane({ transport, agents, selection: { agentId: 'codex' } });
      useChatPaneAgentControl(pane, {});
      return pane;
    });
    // Agent control is opt-in in the library even when a host means to enable it.
    expect(context.registerCalls).toBe(0);
  });

  it('does not register with WebMCP unless the host opted in, even with agent control enabled', () => {
    // A WebMCP caller has no run and no principal, so it never passes ToolExecutor. Anything that
    // can reach `document.modelContext` — a browser extension, another script on the page — would
    // otherwise drive the pane ungated the moment a host enabled the daemon-relayed channel.
    const context = installModelContext();
    const transport = createFakeChatTransport();
    renderHook(() => {
      const pane = useChatPane({ transport, agents, selection: { agentId: 'codex' } });
      useChatPaneAgentControl(pane, { enabled: true });
      return pane;
    });
    expect(context.registerCalls).toBe(0);
  });

  it('registers with WebMCP once the host accepts the tradeoff', () => {
    const context = installModelContext();
    const transport = createFakeChatTransport();
    renderHook(() => {
      const pane = useChatPane({ transport, agents, selection: { agentId: 'codex' } });
      useChatPaneAgentControl(pane, { enabled: true, webmcp: true });
      return pane;
    });
    expect(context.registerCalls).toBeGreaterThan(0);
  });
});

describe('useChatPaneAgentControl — remaining capabilities', () => {
  it('sets the composer draft without sending', async () => {
    const context = installModelContext();
    const { transport, pane } = renderControlledPane();

    await act(async () => {
      await context.tools.get('chat.set_draft')?.execute({ text: 'a drafted question' });
    });
    expect(pane().composer.draft).toBe('a drafted question');
    expect(transport.calls).toHaveLength(0);
  });

  it('rejects a draft with no text', async () => {
    const context = installModelContext();
    renderControlledPane();
    await expect(context.tools.get('chat.set_draft')?.execute({})).rejects.toThrow(/"text" is required/);
  });

  it('selects an agent, carrying optional model and reasoning when given', async () => {
    const context = installModelContext();
    const { pane } = renderControlledPane();

    await act(async () => {
      await context.tools.get('chat.select_agent')?.execute({ agentId: 'codex' });
    });
    expect(pane().selection.agentId).toBe('codex');

    await act(async () => {
      await context.tools.get('chat.select_agent')?.execute({
        agentId: 'codex',
        model: 'default',
        reasoning: 'high',
      });
    });
    expect(pane().selection.agentId).toBe('codex');
  });

  it('ignores blank optional fields rather than selecting an empty model', async () => {
    const context = installModelContext();
    const { pane } = renderControlledPane();
    await act(async () => {
      await context.tools.get('chat.select_agent')?.execute({ agentId: 'codex', model: '', reasoning: '' });
    });
    expect(pane().selection.model).toBeUndefined();
  });

  it('rejects agent selection with no agentId', async () => {
    const context = installModelContext();
    renderControlledPane();
    await expect(context.tools.get('chat.select_agent')?.execute({}))
      .rejects.toThrow(/"agentId" is required/);
  });

  // setSelection normalizes an unknown agent to the first available one, which is right for the
  // picker and a lie for a caller that gets {ok:true}: asking for a constrained runtime and
  // silently getting a more capable one is how a prompt meant for a sandboxed agent reaches a full
  // coding agent. Observed live on 2026-07-26 before this refusal existed.
  it('refuses an agent this pane does not offer, naming the ones it does', async () => {
    const context = installModelContext();
    const { pane } = renderControlledPane();

    await expect(context.tools.get('chat.select_agent')?.execute({ agentId: 'playground-demo' }))
      .rejects.toThrow('unknown agent "playground-demo" — this pane offers: codex, offline, unauthed');
    // The previous selection survives, rather than being quietly replaced.
    expect(pane().selection.agentId).toBe('codex');
  });

  it('refuses an agent that exists but is unavailable on this machine', async () => {
    const context = installModelContext();
    const { pane } = renderControlledPane();

    await expect(context.tools.get('chat.select_agent')?.execute({ agentId: 'offline' }))
      .rejects.toThrow('agent "offline" is not available on this machine');
    expect(pane().selection.agentId).toBe('codex');
  });

  it('says so plainly when the pane has no runtimes at all', async () => {
    const context = installModelContext();
    renderControlledPane({ agents: [] });

    await expect(context.tools.get('chat.select_agent')?.execute({ agentId: 'codex' }))
      .rejects.toThrow('unknown agent "codex" — this pane offers: none');
  });

  it('passes the runtime\'s own diagnostic through, so the caller need not guess why', async () => {
    const context = installModelContext();
    renderControlledPane();

    await expect(context.tools.get('chat.select_agent')?.execute({ agentId: 'unauthed' }))
      .rejects.toThrow('agent "unauthed" is not available on this machine (run `unauthed login` first)');
  });

  it('cancels an in-flight run', async () => {
    const context = installModelContext();
    const { pane } = renderControlledPane();

    await act(async () => {
      await context.tools.get('chat.send_message')?.execute({ prompt: 'start something' });
    });
    await waitFor(() => expect(pane().conversation.isStreaming).toBe(true));

    await act(async () => {
      await context.tools.get('chat.cancel_run')?.execute({});
    });
    await waitFor(() => expect(pane().conversation.isStreaming).toBe(false));
  });

  it('tolerates a host invoking a zero-argument tool with no arguments object at all', async () => {
    const context = installModelContext();
    const { pane } = renderControlledPane();

    await act(async () => {
      await context.tools.get('chat.send_message')?.execute({ prompt: 'start something' });
    });
    await waitFor(() => expect(pane().conversation.isStreaming).toBe(true));

    // Some WebMCP hosts invoke a zero-argument tool with `undefined` rather than `{}` — the
    // registered `execute: (args) => runAction(tool.id, args ?? {})` wrapper exists for exactly
    // this, so it must behave identically to passing `{}`.
    await act(async () => {
      await context.tools.get('chat.cancel_run')?.execute(undefined as unknown as Record<string, unknown>);
    });
    await waitFor(() => expect(pane().conversation.isStreaming).toBe(false));
  });
});

describe('useChatPaneAgentControl — relayed error reporting', () => {
  it('reports an unknown capability id relayed over the bridge', async () => {
    installModelContext();
    let emit: ((action: ChatPaneAgentToolAction) => void) | undefined;
    const bridge: ChatPaneAgentBridgeAccess = {
      subscribe: vi.fn((onAction: (action: ChatPaneAgentToolAction) => void) => {
        emit = onAction;
        return vi.fn();
      }),
      respondSuccess: vi.fn(async () => undefined),
      respondError: vi.fn(async () => undefined),
    };
    renderControlledPane({ bridgeAccess: bridge });

    await act(async () => {
      emit?.({ invocationId: 'inv-x', capabilityId: 'chat.evaluate', input: {} });
      await Promise.resolve();
    });

    // Only the manifest is registered in-page, so an unknown id can only arrive relayed — and it
    // must come back as a reported error, not a silent success.
    await waitFor(() => expect(bridge.respondError).toHaveBeenCalledTimes(1));
    expect(vi.mocked(bridge.respondError).mock.calls[0]?.[1]).toMatch(/unknown chat capability: chat\.evaluate/);
  });

  it('stringifies a non-Error rejection rather than reporting [object Object]', async () => {
    installModelContext();
    let emit: ((action: ChatPaneAgentToolAction) => void) | undefined;
    const bridge: ChatPaneAgentBridgeAccess = {
      subscribe: vi.fn((onAction: (action: ChatPaneAgentToolAction) => void) => {
        emit = onAction;
        return vi.fn();
      }),
      // A transport that rejects with a bare string — legal, and common across postMessage bridges.
      respondSuccess: vi.fn(async () => { throw 'socket closed'; }),
      respondError: vi.fn(async () => undefined),
    };
    renderControlledPane({ bridgeAccess: bridge });

    await act(async () => {
      emit?.({ invocationId: 'inv-y', capabilityId: 'chat.get_state', input: {} });
      await Promise.resolve();
    });

    await waitFor(() => expect(bridge.respondError).toHaveBeenCalledTimes(1));
    expect(vi.mocked(bridge.respondError).mock.calls[0]?.[1]).toMatch(/socket closed/);
  });
});
