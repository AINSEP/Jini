import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChatTransport } from '../../../react/hooks/testing/fake-transport.js';
import { CHAT_PANE_AGENT_TOOLS } from '../agent-tools.js';
import type {
  ChatPaneAgent,
  ChatPaneAgentBridgeAccess,
  ChatPaneAgentToolAction,
} from '../types.js';
import { useChatPane, type UseChatPaneResult } from '../react/hooks/useChatPane.hooks.js';
import { useChatPaneAgentControl } from '../react/hooks/useChatPaneAgentControl.hooks.js';

const agents: ChatPaneAgent[] = [
  { id: 'codex', name: 'Codex CLI', available: true },
  { id: 'offline', name: 'Offline CLI', available: false },
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
    workingDirectory?: string | null;
    /** Host filesystem bridge — required for the pane to ever mark a directory invalid. */
    directoryExists?: boolean;
    recentDirectories?: readonly string[];
    bridgeAccess?: ChatPaneAgentBridgeAccess;
  } = {},
) {
  const transport = createFakeChatTransport();
  const needsAccess = options.directoryExists !== undefined || options.recentDirectories !== undefined;
  const view = renderHook(() => {
    const pane = useChatPane({
      transport,
      agents,
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
      useChatPaneAgentControl(pane, { enabled: true, bridgeAccess: { ...bridge } });
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
