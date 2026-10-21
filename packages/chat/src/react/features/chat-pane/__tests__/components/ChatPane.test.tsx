import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@jini-ai/chat';
import { FILE_SYSTEM_READ_ERROR_MESSAGE } from '@jini-ai/ui';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { ChatPane } from '../../components/ChatPane.js';
import { createTypedAnswerPoster } from '../../create-typed-answer-poster.js';
import { CHAT_PANE_STYLES } from '../../styles.js';
import type { ChatPaneActivity, ChatPaneAgent, ChatPaneComposerHandle, DeliverTypedAnswer } from '../../types.js';

const agents: ChatPaneAgent[] = [{
  id: 'codex',
  name: 'Codex CLI',
  available: true,
  models: [{ id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' }],
  reasoningOptions: [{ id: 'medium', label: 'Medium' }],
}];

const welcome: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Welcome to Jini.',
  runStatus: 'succeeded',
  createdAt: 1,
};

describe('ChatPane', () => {
  it('enables Send with an off-list Claude default and sends the concrete picker model', async () => {
    const transport = createFakeChatTransport();
    const catalog = {
      models: [
        { id: 'opus', label: 'Opus', identityKind: 'alias' as const },
        { id: 'sonnet', label: 'Sonnet', identityKind: 'alias' as const },
        { id: 'claude-opus-5-5', label: 'Opus 5.5' },
      ],
      defaultSelectionId: 'opus[1m]',
      source: 'rpc' as const, freshness: 'fresh' as const, coverage: 'account' as const,
      fetchedAt: '2026-10-17T00:00:00.000Z', expiresAt: '2026-10-17T00:15:00.000Z', launchFingerprint: 'fixture',
    };
    const claude: ChatPaneAgent = {
      id: 'claude', name: 'Claude Code', available: true, models: catalog.models, modelCatalog: catalog,
      defaultModelResolution: { status: 'unresolved', selectionId: 'opus[1m]', reason: 'No concrete model evidence.' },
    };
    render(<ChatPane transport={transport} agents={[claude]} selection={{ agentId: 'claude' }}
      runContext={({ selection }) => ({ model: selection.model })} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello Claude' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input).toMatchObject({ agentId: 'claude', context: { model: 'claude-opus-5-5' } });
    act(() => transport.finish([]));
  });

  it('exposes the blocker in the Send title and footer when the agent becomes unavailable', () => {
    const transport = createFakeChatTransport();
    const { rerender } = render(<ChatPane transport={transport} agents={agents} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my draft' } });
    rerender(<ChatPane transport={transport} agents={[{ ...agents[0]!, available: false }]} />);
    expect(screen.getByRole('textbox')).toHaveValue('Keep my draft');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('title', 'no agent is selected');
    expect(screen.getByText('no agent is selected').closest('.jini-composer-footer')).not.toBeNull();
    expect(transport.calls).toHaveLength(0);
  });

  it('excludes workspace controls on the embed surface while retaining draft and send behavior', async () => {
    const transport = createFakeChatTransport();
    const upload = vi.fn(async () => []);
    render(<ChatPane variant="embed" transport={transport} agents={agents}
      workingDirectoryControlPlacement="composer" uploadAttachments={upload}
      leadingAccessory={<button>Admin context</button>}
      composerSlots={{ footerLeadingAccessory: <button>Admin tool</button>,
        discoveryGroups: [{ id: 'admin', label: 'Admin tools', items: [{ id: 'secret', label: 'Admin command', insertText: '/admin' }] }] }}
      emptyState={<p>Ask about this site.</p>} suggestions={['Find posts']} />);
    expect(screen.queryByRole('button', { name: /working directory/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /runtime|Codex|model|attach|context|discover|Admin/i })).toBeNull();
    expect(screen.getByText('Ask about this site.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Find posts' }));
    expect(screen.getByRole('textbox')).toHaveValue('Find posts');
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Find posts' }).closest('.jini-message-list--empty')).not.toBeNull();
    expect(transport.calls).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input.agentId).toBe('codex');
    expect(screen.queryByText('Ask about this site.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Find posts' })).toBeNull();
    expect(upload).not.toHaveBeenCalled();
    act(() => transport.finish([]));
  });
  it('owns composer/conversation/send orchestration and forwards selection plus run context', async () => {
    const transport = createFakeChatTransport();
    const activities: ChatPaneActivity[] = [];
    render(
      <ChatPane
        title="Starter Site"
        transport={transport}
        agents={agents}
        initialMessages={[welcome]}
        initialSelection={{ agentId: '' }}
        placeholder="Ask Jini…"
        suggestions={['Inspect this project']}
        initialWorkingDirectory="examples/sample-projects/starter-site"
        runContext={({ selection, prompt, workingDirectory }) => ({
          project: 'starter-site',
          model: selection.model,
          reasoning: selection.reasoning,
          promptLength: prompt.length,
          workingDirectory,
        })}
        onActivityChange={(activity) => activities.push(activity)}
      />,
    );

    expect(screen.getByText('Welcome to Jini.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Inspect this project' }));
    expect(screen.getByPlaceholderText('Ask Jini…')).toHaveValue('Inspect this project');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input).toMatchObject({
      agentId: 'codex',
      context: {
        project: 'starter-site',
        model: 'gpt-5.6-terra',
        reasoning: 'medium',
        promptLength: 20,
        workingDirectory: 'examples/sample-projects/starter-site',
      },
    });
    expect(screen.getAllByText('Inspect this project')).toHaveLength(2);
    expect(activities).toContain('queued');
    expect(activities).toContain('streaming');

    act(() => {
      transport.emit({ kind: 'text', text: 'Done.' });
      transport.finish([{ kind: 'text', text: 'Done.' }]);
    });
    expect(await screen.findByText('Done.')).toBeInTheDocument();
    await waitFor(() => expect(activities).toContain('ready'));
  });

  it('resolves placeholders to a single composer placeholder, taking over from placeholder', () => {
    // Wiring only — `useChatPaneComposerPlaceholder.test.tsx` owns the rotation/reduced-motion
    // behavior itself. This just proves `ChatPane` actually threads `placeholders` through.
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        placeholder="Ask Jini…"
        placeholders={['Summarize this repo', 'Fix the failing test']}
      />,
    );
    expect(screen.getByPlaceholderText('Summarize this repo')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Ask Jini…')).toBeNull();
  });

  it('supports controlled selection, static context, cancellation, reset, and host slots', async () => {
    const transport = createFakeChatTransport();
    const onSelectionChange = vi.fn();
    render(
      <ChatPane
        title="Controlled"
        transport={transport}
        agents={agents}
        selection={{ agentId: 'codex', model: 'gpt-5.6-terra', reasoning: 'medium' }}
        onSelectionChange={onSelectionChange}
        initialMessages={[welcome]}
        runContext={{ project: 'controlled' }}
        leadingAccessory={<span>Custom leading</span>}
        footer={<div>Custom footer</div>}
      />,
    );
    expect(screen.getByText('Custom leading')).toBeInTheDocument();
    expect(screen.getByText('Custom footer')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'Run');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input.context).toEqual({ project: 'controlled' });

    await userEvent.click(screen.getByRole('button', { name: 'Stop run' }));
    await userEvent.click(screen.getByRole('button', { name: 'New thread' }));
    expect(screen.queryByText('Run')).not.toBeInTheDocument();
    expect(screen.getByText('Welcome to Jini.')).toBeInTheDocument();
  });

  it('fails closed with no available agent and surfaces transport errors', async () => {
    const unavailable = [{ id: 'missing', name: 'Missing', available: false }] satisfies ChatPaneAgent[];
    const transport = createFakeChatTransport();
    const { rerender } = render(
      <ChatPane
        title="Unavailable"
        transport={transport}
        agents={unavailable}
        header={<div>Custom header</div>}
      />,
    );
    expect(screen.getByText('Custom header')).toBeInTheDocument();
    expect(screen.getByText('No usable CLI is selected.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    rerender(<ChatPane title="Failure" transport={transport} agents={agents} />);
    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'Fail');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() => transport.fail(new Error('runtime failed')));
    expect(await screen.findByText('runtime failed')).toBeInTheDocument();
  });

  it('supports package defaults and host styling/composer extension props', () => {
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        conversationId="conversation-1"
        initialDraft="Initial draft"
        workingDirectory={null}
        projectFileNames={new Set(['index.ts'])}
        composerSlots={{ mentionSources: [] }}
        onRescanAgents={() => {}}
        className="host-position"
        style={{ minHeight: 400 }}
        disabled
      />,
    );
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Send a message…')).toHaveValue('Initial draft');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Chat' }).closest('section'))
      .toHaveClass('jini-chat-pane--workspace', 'host-position');
    expect(screen.getByRole('heading', { name: 'Chat' }).closest('section'))
      .toHaveStyle({ minHeight: '400px' });
  });

  it('opens every in-pane link in a new tab, including host-rendered card links', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      render(
        <ChatPane
          transport={createFakeChatTransport()}
          agents={agents}
          header={<a href="/admin/pages/x">card link</a>}
        />,
      );
      fireEvent.click(screen.getByText('card link'));
      expect(open).toHaveBeenCalledWith(`${window.location.origin}/admin/pages/x`, '_blank', 'noopener,noreferrer');
    } finally {
      open.mockRestore();
    }
  });

  it('owns file picking/upload staging and forwards uploaded attachments on send', async () => {
    const transport = createFakeChatTransport();
    const uploaded = {
      path: '/tmp/reference.png',
      name: 'reference.png',
      kind: 'image' as const,
    };
    const uploadAttachments = vi.fn(async () => [uploaded]);
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        uploadAttachments={uploadAttachments}
        attachmentAccept="image/*"
      />,
    );

    const file = new File(['image bytes'], 'reference.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Attach files', { selector: 'input' }), file);
    await waitFor(() => expect(uploadAttachments).toHaveBeenCalledWith(
      [file],
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        batchId: expect.any(String),
      }),
    ));
    expect(screen.getByText('reference.png')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'Use this reference');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input.attachments).toEqual([uploaded]);
  });

  it('accepts file drops across the composer area and ignores non-file drags', async () => {
    const transport = createFakeChatTransport();
    const uploadAttachments = vi.fn(async (files: File[]) => files.map((file) => ({
      path: `/tmp/${file.name}`,
      name: file.name,
      kind: 'file' as const,
    })));
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        uploadAttachments={uploadAttachments}
        initialWorkingDirectory="/work/project"
      />,
    );
    const target = screen.getByTestId('chat-pane-file-drop-target');
    const textTransfer = {
      types: ['text/plain'],
      items: [],
      files: [],
      dropEffect: 'none',
    };
    fireEvent.dragEnter(target, { dataTransfer: textTransfer });
    expect(target).not.toHaveClass('is-dragging-files');

    const file = new File(['drop content'], 'dropped.txt', { type: 'text/plain' });
    const fileTransfer = {
      types: ['Files'],
      items: [],
      files: [file],
      dropEffect: 'none',
    };
    fireEvent.dragEnter(target, { dataTransfer: fileTransfer });
    expect(target).toHaveClass('is-dragging-files');
    expect(screen.getByRole('status')).toHaveTextContent('Drop files to attach');
    fireEvent.dragOver(target, { dataTransfer: fileTransfer });
    expect(fileTransfer.dropEffect).toBe('copy');
    fireEvent.drop(target, { dataTransfer: fileTransfer });

    await waitFor(() => expect(uploadAttachments).toHaveBeenCalledWith(
      [file],
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        batchId: expect.any(String),
      }),
    ));
    expect(target).not.toHaveClass('is-dragging-files');
    expect(await screen.findByText('dropped.txt')).toBeInTheDocument();
  });

  it('stages attach-button, dropped and pasted files while a run streams and sends them with the next message', async () => {
    const transport = createFakeChatTransport();
    const uploadAttachments = vi.fn(async (files: File[]) => files.map((file) => ({
      path: `/tmp/${file.name}`,
      name: file.name,
      kind: 'file' as const,
    })));
    render(<ChatPane transport={transport} agents={agents} uploadAttachments={uploadAttachments} />);

    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'Run');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeEnabled();
    // Send behavior while running is unchanged: an empty draft shows only Stop.
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();

    expect(screen.getByRole('button', { name: 'Attach files' })).toBeEnabled();
    expect(screen.getByTestId('composer-attachment-input')).toBeEnabled();

    const target = screen.getByTestId('chat-pane-file-drop-target');
    const dropped = new File(['drop content'], 'dropped.txt', { type: 'text/plain' });
    const fileTransfer = { types: ['Files'], items: [], files: [dropped], dropEffect: 'none' };
    fireEvent.dragEnter(target, { dataTransfer: fileTransfer });
    expect(target).toHaveClass('is-dragging-files');
    fireEvent.dragOver(target, { dataTransfer: fileTransfer });
    expect(fileTransfer.dropEffect).toBe('copy');
    fireEvent.drop(target, { dataTransfer: fileTransfer });
    expect(await screen.findByText('dropped.txt')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Attach files' })).toBeEnabled());

    const pasted = new File(['png'], 'pasted.png', { type: 'image/png' });
    fireEvent.paste(screen.getByPlaceholderText('Send a message…'), { clipboardData: { files: [pasted] } });
    expect(await screen.findByText('pasted.png')).toBeInTheDocument();
    expect(uploadAttachments.mock.calls.map(([files]) => files)).toEqual([[dropped], [pasted]]);
    expect(transport.calls).toHaveLength(1);

    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'Use these');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(transport.calls).toHaveLength(1);
    act(() => transport.finish([]));
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]?.input.attachments).toEqual([
      { path: '/tmp/dropped.txt', name: 'dropped.txt', kind: 'file' },
      { path: '/tmp/pasted.png', name: 'pasted.png', kind: 'file' },
    ]);
    act(() => transport.finish([]));
  });

  it('owns the package working-directory picker and delegates only native I/O plus changes', async () => {
    const transport = createFakeChatTransport();
    const onChangeWorkingDirectory = vi.fn();
    const workingDirectoryAccess = {
      pickWorkingDirectory: vi.fn(async () => '/Users/test/selected'),
      recentDirectories: vi.fn(async () => ['/Users/test/previous']),
      directoryExists: vi.fn(async () => true),
    };
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        initialWorkingDirectory="/Users/test/current"
        onChangeWorkingDirectory={onChangeWorkingDirectory}
        workingDirectoryAccess={workingDirectoryAccess}
      />,
    );

    await userEvent.click(screen.getByTestId('working-dir-trigger'));
    await userEvent.click(screen.getByTestId('working-dir-pick'));
    await waitFor(() => expect(onChangeWorkingDirectory).toHaveBeenCalledWith('/Users/test/selected'));
    expect(screen.getByTestId('working-dir-trigger')).toHaveTextContent('selected');

    await userEvent.click(screen.getByTestId('working-dir-trigger'));
    await waitFor(() => expect(workingDirectoryAccess.recentDirectories).toHaveBeenCalled());
    await userEvent.hover(screen.getByTestId('working-dir-recent'));
    await userEvent.click(screen.getByTitle('/Users/test/previous'));
    await waitFor(() => expect(onChangeWorkingDirectory).toHaveBeenCalledWith('/Users/test/previous'));
    expect(workingDirectoryAccess.directoryExists).toHaveBeenCalledWith('/Users/test/previous');
  });

  it('renders package-owned attachment and working-directory capability errors', async () => {
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        uploadAttachments={async () => {
          throw new Error('attachment upload unavailable');
        }}
        initialWorkingDirectory="/Users/test/current"
        workingDirectoryAccess={{
          pickWorkingDirectory: async () => null,
          recentDirectories: async () => {
            throw new Error('recent folders unavailable');
          },
          directoryExists: async () => true,
        }}
      />,
    );

    await userEvent.upload(
      screen.getByLabelText('Attach files', { selector: 'input' }),
      new File(['content'], 'notes.txt', { type: 'text/plain' }),
    );
    expect(await screen.findByText('attachment upload unavailable')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('working-dir-trigger'));
    expect(await screen.findByText('recent folders unavailable')).toBeInTheDocument();
  });

  it('renders pending, invalid, and runtime inventory failure states', async () => {
    let resolveExists!: (exists: boolean) => void;
    const exists = new Promise<boolean>((resolve) => {
      resolveExists = resolve;
    });
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        runtimeAccess={{
          listAgents: async () => {
            throw new Error('inventory unavailable');
          },
          rescanAgents: async () => [],
          daemonOnline: async () => false,
        }}
        initialWorkingDirectory="/work/pending"
        workingDirectoryAccess={{
          pickWorkingDirectory: async () => null,
          recentDirectories: async () => [],
          directoryExists: async () => exists,
        }}
      />,
    );

    // Two independent `status` banners are up at once here on purpose: CLI detection is
    // in flight (no `runtimeAccess` call has settled yet) at the same time the working
    // directory check is pending — each is its own source of truth, not a shared one.
    const statusTexts = screen.getAllByRole('status').map((el) => el.textContent);
    expect(statusTexts).toContain('Checking working directory…');
    expect(statusTexts).toContain('Loading available CLIs');
    await act(async () => resolveExists(false));
    expect(await screen.findByText('Working directory is unavailable.')).toBeInTheDocument();
    // `listAgents` REJECTED above: that is no answer yet (a daemon mid-restart), not a finished
    // detection that found nothing — so a plain "connecting" status while the pane retries, never
    // the red "No usable CLI" alert or the raw transport error (2026-09-28).
    expect(await screen.findByText('Connecting to the assistant…')).toBeInTheDocument();
    expect(screen.getByText('Connecting to the assistant…')).toHaveAttribute('role', 'status');
    expect(screen.queryByText('No usable CLI is selected.')).not.toBeInTheDocument();
    expect(screen.queryByText('inventory unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading available CLIs')).not.toBeInTheDocument();
  });

  it('recovers from a failed CLI inventory without a reload once the daemon comes back', async () => {
    let online = false;
    const listAgents = vi
      .fn<() => Promise<ChatPaneAgent[]>>()
      .mockRejectedValueOnce(new Error('GET /api/agents answered 500'))
      .mockResolvedValue(agents);
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        initialSelection={{ agentId: 'codex' }}
        runtimeStatusPollMs={20}
        runtimeAccess={{
          listAgents,
          rescanAgents: async () => [],
          daemonOnline: async () => online,
        }}
      />,
    );

    expect(await screen.findByText('Connecting to the assistant…')).toBeInTheDocument();
    expect(screen.queryByText('No usable CLI is selected.')).not.toBeInTheDocument();

    online = true;
    await waitFor(() => expect(screen.queryByText('Connecting to the assistant…')).not.toBeInTheDocument());
    expect(screen.queryByText('No usable CLI is selected.')).not.toBeInTheDocument();
    expect(listAgents).toHaveBeenCalledTimes(2);
  });

  it('shows a loading status while CLI detection is in flight, not the red unavailable banner', async () => {
    let resolveAgents!: (result: ChatPaneAgent[]) => void;
    const pending = new Promise<ChatPaneAgent[]>((resolve) => {
      resolveAgents = resolve;
    });
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        runtimeAccess={{
          listAgents: () => pending,
          rescanAgents: async () => [],
          daemonOnline: async () => true,
        }}
      />,
    );

    // Detection has not resolved yet: a status, not an alert, and the composer must not have
    // flashed the red "no usable CLI" banner in the process.
    expect(screen.getByRole('status')).toHaveTextContent('Loading available CLIs');
    expect(screen.queryByText('No usable CLI is selected.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => resolveAgents([]));

    // Detection finished and genuinely found nothing usable: now, and only now, the red alert.
    expect(await screen.findByText('No usable CLI is selected.')).toBeInTheDocument();
    expect(screen.queryByText('Loading available CLIs')).not.toBeInTheDocument();
  });

  it('shows neither the loading status nor the unavailable alert once a usable agent resolves', async () => {
    let resolveAgents!: (result: ChatPaneAgent[]) => void;
    const pending = new Promise<ChatPaneAgent[]>((resolve) => {
      resolveAgents = resolve;
    });
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        initialSelection={{ agentId: 'codex' }}
        runtimeAccess={{
          listAgents: () => pending,
          rescanAgents: async () => [],
          daemonOnline: async () => true,
        }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading available CLIs');

    await act(async () => resolveAgents(agents));

    expect(screen.queryByText('Loading available CLIs')).not.toBeInTheDocument();
    expect(screen.queryByText('No usable CLI is selected.')).not.toBeInTheDocument();
  });

  it('subscribes the daemon-relayed bridge when agentControl is supplied enabled', () => {
    const transport = createFakeChatTransport();
    const subscribe = vi.fn(() => () => {});
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        agentControl={{
          enabled: true,
          bridgeAccess: {
            subscribe,
            respondSuccess: vi.fn(async () => undefined),
            respondError: vi.fn(async () => undefined),
          },
        }}
      />,
    );
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression coverage for the gap `useChatPaneAgentControl.hooks.ts`'s own `webmcp` option
   * already documented but `ChatPane` never actually wired: `agentControl.webmcp` used to be
   * dropped on the floor here (only `enabled`/`bridgeAccess` were forwarded), so no host could ever
   * reach the hook's WebMCP branch through the public component, regardless of what it passed.
   */
  it('registers this pane\'s own tools with document.modelContext when agentControl.webmcp is true', () => {
    const registerTool = vi.fn();
    Object.defineProperty(globalThis.document, 'modelContext', {
      configurable: true,
      writable: true,
      value: { registerTool, unregisterTool: vi.fn() },
    });
    try {
      const transport = createFakeChatTransport();
      render(
        <ChatPane transport={transport} agents={agents} agentControl={{ enabled: true, webmcp: true }} />,
      );
      expect(registerTool).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(globalThis.document as unknown as Record<string, unknown>, 'modelContext');
    }
  });

  it('shows a rescan failure as an alert while keeping the last good inventory on screen', async () => {
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        runtimeAccess={{
          listAgents: async () => agents,
          rescanAgents: async () => {
            throw new Error('rescan answered 503');
          },
          daemonOnline: async () => true,
        }}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Choose AI runtime' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rescan PATH' }));
    expect(await screen.findByText('rescan answered 503')).toHaveAttribute('role', 'alert');
    expect(screen.queryByText('Connecting to the assistant…')).not.toBeInTheDocument();
  });

  it('delegates an explicit rescan to runtimeAccess and reflects the refreshed inventory', async () => {
    const transport = createFakeChatTransport();
    const rescanAgents = vi.fn(async () => [
      { id: 'claude', name: 'Claude CLI', available: true },
    ]);
    render(
      <ChatPane
        transport={transport}
        runtimeAccess={{
          listAgents: async () => agents,
          rescanAgents,
          daemonOnline: async () => true,
        }}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Choose AI runtime' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rescan PATH' }));
    expect(rescanAgents).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('radio', { name: /Claude CLI/ })).toBeInTheDocument();
  });

  it('reports a read error banner when a dropped item cannot be read from disk', async () => {
    const transport = createFakeChatTransport();
    const uploadAttachments = vi.fn(async (files: File[]) => files.map((file) => ({
      path: `/tmp/${file.name}`,
      name: file.name,
      kind: 'file' as const,
    })));
    render(<ChatPane transport={transport} agents={agents} uploadAttachments={uploadAttachments} />);

    const target = screen.getByTestId('chat-pane-file-drop-target');
    const unreadableItem = {
      kind: 'file',
      webkitGetAsEntry: () => ({
        isFile: true,
        isDirectory: false,
        file: (_resolve: (file: File) => void, reject: (error: Error) => void) => {
          reject(new Error('permission denied'));
        },
      }),
    };
    fireEvent.drop(target, {
      dataTransfer: { types: ['Files'], items: [unreadableItem], files: [] },
    });

    expect(await screen.findByText(FILE_SYSTEM_READ_ERROR_MESSAGE)).toBeInTheDocument();
    expect(uploadAttachments).not.toHaveBeenCalled();
  });

  it('lets a host that owns execution-mode switching drive it from the runtime picker', async () => {
    const transport = createFakeChatTransport();
    const onExecutionModeChange = vi.fn();
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        executionMode="local"
        apiModeAvailable
        onExecutionModeChange={onExecutionModeChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use API · BYOK' }));
    expect(onExecutionModeChange).toHaveBeenCalledWith('api');
  });

  it('lets a configured BYOK turn use the composer with zero agent CLIs available', async () => {
    // Reproduces the owner-reported bug: `unavailable` gated purely on CLI selection, so a
    // correctly-configured BYOK setup (which calls the provider directly over HTTP, no CLI
    // involved) could never be used on a host with zero agent CLIs on PATH, e.g. a Docker
    // container.
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        agents={[]}
        executionMode="api"
        apiModeAvailable
        byokRuntime={{ providerLabel: 'Google Gemini', model: 'gemini-2.5-flash-lite' }}
      />,
    );

    expect(screen.queryByText('No usable CLI is selected.')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Send a message…')).not.toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'Hello from BYOK');
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(transport.calls).toHaveLength(1));
  });

  it('still fails closed in local-CLI mode with zero agents on PATH — no regression', () => {
    const transport = createFakeChatTransport();
    render(<ChatPane transport={transport} agents={[]} />);

    expect(screen.getByText('No usable CLI is selected.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Send a message…')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('turns the unavailable banner into a working BYOK switch when the host wired onExecutionModeChange', async () => {
    // Owner-reported bug: a host with zero agent CLIs (e.g. a hosted container image) showed the
    // same dead-end "No usable CLI is selected." with no way forward, even though BYOK was a real,
    // configured way out. The banner must both say so AND actually flip the mode when a host has
    // wired the callback that makes that true.
    const transport = createFakeChatTransport();
    const onExecutionModeChange = vi.fn();
    render(
      <ChatPane
        transport={transport}
        agents={[]}
        executionMode="local"
        apiModeAvailable
        onExecutionModeChange={onExecutionModeChange}
      />,
    );

    expect(screen.getByText('No usable CLI is selected.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to BYOK' }));
    expect(onExecutionModeChange).toHaveBeenCalledWith('api');
  });

  it('falls back to copy-only BYOK pointer when apiModeAvailable but no onExecutionModeChange is wired', () => {
    // A host may report `apiModeAvailable` without wiring the callback that would make a button
    // meaningful. The pane must still point at BYOK as prose, never inventing an affordance it
    // cannot actually perform.
    const transport = createFakeChatTransport();
    render(<ChatPane transport={transport} agents={[]} executionMode="local" apiModeAvailable />);

    expect(
      screen.getByText('No usable CLI is selected — switch to BYOK to use your own API key.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to BYOK' })).not.toBeInTheDocument();
  });

  it('does not offer to switch to BYOK when it is not actually available — the honest case', () => {
    // `apiModeAvailable` false means BYOK genuinely is not a way forward here (e.g. no key saved
    // anywhere). Telling the operator to "try BYOK" would be a lie, so the original message stands
    // alone with no pointer and no button.
    const transport = createFakeChatTransport();
    render(<ChatPane transport={transport} agents={[]} executionMode="local" apiModeAvailable={false} />);

    expect(screen.getByText('No usable CLI is selected.')).toBeInTheDocument();
    expect(
      screen.queryByText('No usable CLI is selected — switch to BYOK to use your own API key.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to BYOK' })).not.toBeInTheDocument();
  });

  describe('composerHandle', () => {
    it('publishes insertText once mounted, appends onto an existing draft, and clears on unmount', () => {
      const composerHandle = createRef<ChatPaneComposerHandle | null>();
      const { unmount } = render(
        <ChatPane transport={createFakeChatTransport()} agents={agents} composerHandle={composerHandle} />,
      );

      // Populated by ChatPane's own mount effect — a host has no other way to learn the pane exists.
      expect(composerHandle.current).not.toBeNull();

      act(() => {
        composerHandle.current?.insertText('/Users/op/dropped-folder');
      });
      expect(screen.getByRole('textbox')).toHaveValue('/Users/op/dropped-folder');

      // A second insertion APPENDS onto whatever the operator already typed in between — it must
      // never clobber their own words, which is the whole reason `insertText` exists (a host that
      // wanted to replace the draft outright already has that: `workingDirectory`-style controlled
      // props, or just `pane.composer.setDraft` if it were public).
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'look at' } });
      act(() => {
        composerHandle.current?.insertText('/Users/op/dropped-folder');
      });
      expect(screen.getByRole('textbox')).toHaveValue('look at /Users/op/dropped-folder');

      unmount();
      expect(composerHandle.current).toBeNull();
    });

    it('does nothing when composerHandle is omitted — no crash, no phantom ref writes', () => {
      // The prop is optional; every other test in this file renders ChatPane without it. This test
      // exists only to make that omission an asserted case rather than an accident of coverage.
      expect(() => render(<ChatPane transport={createFakeChatTransport()} agents={agents} />)).not.toThrow();
    });
  });

  // These assert what the pane actually PUTS ON SCREEN, which line coverage cannot speak to: every
  // element below already executed during the tests above (they render a pane for other reasons),
  // so v8 reported them covered while nothing checked their output. Verified by mutation — before
  // these existed, deleting the eyebrow outright and making `title` be ignored entirely both left
  // the whole file green.
  describe('default header and chrome', () => {
    it('renders the eyebrow and puts the supplied title in the heading', () => {
      render(<ChatPane title="Starter Site" transport={createFakeChatTransport()} agents={agents} />);

      expect(screen.getByText('Workspace chat')).toBeInTheDocument();
      const heading = screen.getByRole('heading', { name: 'Starter Site' });
      expect(heading).toBeInTheDocument();
      // Specifically the title, not a coincidental match elsewhere in the pane.
      expect(heading.tagName).toBe('H1');
    });

    it('falls back to "Chat" as the heading when no title is supplied', () => {
      render(<ChatPane transport={createFakeChatTransport()} agents={agents} />);

      expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Starter Site' })).not.toBeInTheDocument();
    });

    it('replaces the whole default header when a custom one is supplied', () => {
      render(
        <ChatPane
          title="Ignored"
          transport={createFakeChatTransport()}
          agents={agents}
          header={<div>Custom header</div>}
        />,
      );

      expect(screen.getByText('Custom header')).toBeInTheDocument();
      // The default header is replaced, not rendered alongside.
      expect(screen.queryByText('Workspace chat')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'New thread' })).not.toBeInTheDocument();
    });

    it('labels the suggestions row and renders one button per suggestion', () => {
      render(
        <ChatPane
          transport={createFakeChatTransport()}
          agents={agents}
          suggestions={['Inspect this project', 'Add a filter']}
        />,
      );

      const group = screen.getByLabelText('Example prompts');
      expect(group).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Inspect this project' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add a filter' })).toBeInTheDocument();
    });

    it('omits the suggestions row entirely when there are none', () => {
      render(<ChatPane transport={createFakeChatTransport()} agents={agents} />);

      expect(screen.queryByLabelText('Example prompts')).not.toBeInTheDocument();
    });

    it('labels the working-directory trigger, and swaps to the basename once one is chosen', async () => {
      const access = {
        pickWorkingDirectory: vi.fn(async () => '/Users/test/selected'),
        recentDirectories: vi.fn(async () => []),
        directoryExists: vi.fn(async () => true),
      };
      const { rerender } = render(
        <ChatPane transport={createFakeChatTransport()} agents={agents} workingDirectoryAccess={access} />,
      );

      // With nothing chosen the trigger carries the pane-supplied prompt.
      expect(screen.getByTestId('working-dir-trigger')).toHaveTextContent('Select working directory');

      rerender(
        <ChatPane
          transport={createFakeChatTransport()}
          agents={agents}
          workingDirectory="/Users/test/current"
          workingDirectoryAccess={access}
        />,
      );
      await waitFor(() => {
        expect(screen.getByTestId('working-dir-trigger')).toHaveTextContent('current');
      });
      expect(screen.getByTestId('working-dir-trigger')).not.toHaveTextContent('Select working directory');
    });

    it('shows the composer\'s folder-icon working-directory trigger, not the native picker, when no access is supplied', () => {
      render(
        <ChatPane
          transport={createFakeChatTransport()}
          agents={agents}
          initialWorkingDirectory="/Users/test/current"
        />,
      );

      expect(screen.getByTestId('composer-workdir-trigger')).toHaveAccessibleName(
        'Working directory: /Users/test/current',
      );
      expect(screen.queryByTestId('working-dir-trigger')).not.toBeInTheDocument();
      expect(screen.queryByText('Working directory')).not.toBeInTheDocument();
    });

    it('changes the working directory through the composer\'s lightweight popover when no native access is supplied', async () => {
      render(
        <ChatPane
          transport={createFakeChatTransport()}
          agents={agents}
          initialWorkingDirectory="/Users/test/current"
        />,
      );

      await userEvent.click(screen.getByTestId('composer-workdir-trigger'));
      const input = screen.getByTestId('composer-workdir-input');
      await userEvent.clear(input);
      await userEvent.type(input, '/Users/test/new{Enter}');

      expect(screen.getByTestId('composer-workdir-trigger')).toHaveAccessibleName(
        'Working directory: /Users/test/new',
      );
    });

    // Regression: a host with a native `workingDirectoryAccess` that opts into
    // `workingDirectoryControlPlacement="composer"` must get the composer's folder-icon trigger
    // wired to the NATIVE dialog — not the below-composer `WorkingDirPicker` this used to render
    // unconditionally whenever `workingDirectoryAccess` was supplied (the regression the owner
    // reported: the control appeared below the composer instead of next to "+").
    it('places the trigger in the composer, not below it, when access is supplied with placement="composer"', () => {
      const access = {
        pickWorkingDirectory: vi.fn(async () => '/Users/test/selected'),
        recentDirectories: vi.fn(async () => []),
        directoryExists: vi.fn(async () => true),
      };
      render(
        <ChatPane
          transport={createFakeChatTransport()}
          agents={agents}
          initialWorkingDirectory="/Users/test/current"
          workingDirectoryAccess={access}
          workingDirectoryControlPlacement="composer"
        />,
      );

      expect(screen.getByTestId('composer-workdir-trigger')).toHaveAccessibleName(
        'Working directory: /Users/test/current',
      );
      expect(screen.queryByTestId('working-dir-trigger')).not.toBeInTheDocument();
      expect(screen.queryByText('Select working directory')).not.toBeInTheDocument();
    });

    it('clicking the composer trigger in placement="composer" calls the native picker directly, with no popover', async () => {
      const access = {
        pickWorkingDirectory: vi.fn(async () => '/Users/test/selected'),
        recentDirectories: vi.fn(async () => []),
        directoryExists: vi.fn(async () => true),
      };
      render(
        <ChatPane
          transport={createFakeChatTransport()}
          agents={agents}
          initialWorkingDirectory="/Users/test/current"
          workingDirectoryAccess={access}
          workingDirectoryControlPlacement="composer"
        />,
      );

      await userEvent.click(screen.getByTestId('composer-workdir-trigger'));

      expect(access.pickWorkingDirectory).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('composer-workdir-panel')).not.toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId('composer-workdir-trigger')).toHaveAccessibleName(
          'Working directory: /Users/test/selected',
        );
      });
    });

    // Regression: `workingDirectoryControlPlacement="none"` must suppress every
    // working-directory control, including the composer's own lightweight popover trigger that
    // `resolveComposerWorkingDirectory` otherwise supplies whenever `workingDirectoryAccess` is
    // absent, regardless of placement. A host with no real filesystem path to offer (e.g. a
    // browser context) needs a way to render nothing rather than a non-functional control.
    it('renders no composer folder-icon trigger when placement="none", even without native access', () => {
      render(
        <ChatPane
          transport={createFakeChatTransport()}
          agents={agents}
          initialWorkingDirectory="/Users/test/current"
          workingDirectoryControlPlacement="none"
        />,
      );

      expect(screen.queryByTestId('composer-workdir-trigger')).not.toBeInTheDocument();
      expect(screen.queryByTestId('working-dir-trigger')).not.toBeInTheDocument();
    });

    it('renders neither the composer trigger nor the below-composer picker when placement="none" with native access supplied', () => {
      const access = {
        pickWorkingDirectory: vi.fn(async () => '/Users/test/selected'),
        recentDirectories: vi.fn(async () => []),
        directoryExists: vi.fn(async () => true),
      };
      render(
        <ChatPane
          transport={createFakeChatTransport()}
          agents={agents}
          initialWorkingDirectory="/Users/test/current"
          workingDirectoryAccess={access}
          workingDirectoryControlPlacement="none"
        />,
      );

      expect(screen.queryByTestId('composer-workdir-trigger')).not.toBeInTheDocument();
      expect(screen.queryByTestId('working-dir-trigger')).not.toBeInTheDocument();
    });
  });

  describe('injected default styles', () => {
    // Regression test: the queued-prompt strip's rules used to live ONLY in reference.css, an
    // opt-in stylesheet no host actually imports (the published 0.3.2 tarball does not even ship
    // the file) — CHAT_PANE_STYLES, injected automatically into every host by ChatPane.tsx, had
    // zero '.jini-chat-pane__queued*' rules. Every host rendered the strip unstyled, which in one
    // host meant `<button>` fell through to that host's own global button styling and painted as
    // a large primary-colored pill overlapping the transcript. Asserts the rules now live in the
    // sheet every host actually gets, not just the opt-in one most hosts never import.
    // Updated when the strip moved from a composer-area banner into the transcript itself
    // (MessageList.tsx's pendingPrompt row): it now copies .jini-message-user .jini-message-content's
    // bubble geometry (asserted separately below isn't needed — the shared max-width/border-radius
    // values live in that class, not duplicated here) and is right-aligned like a real user message,
    // with a dashed border and reduced opacity standing in for the old boxed-strip-plus-label
    // treatment as the "not yet sent" signal — a sent bubble has neither.
    it('marks the queued bubble as pending — right-aligned like a real message, with a dashed border and reduced opacity a sent bubble never carries', () => {
      const rowRule = CHAT_PANE_STYLES.match(/\.jini-chat-pane__queued \{([^}]*)\}/)?.[1] ?? '';
      expect(rowRule).toMatch(/align-items:\s*flex-end/);

      const textRule = CHAT_PANE_STYLES.match(/\.jini-chat-pane__queued-text \{([^}]*)\}/)?.[1] ?? '';
      expect(textRule).toMatch(/border:\s*1px dashed/);
      expect(textRule).toMatch(/background:\s*var\(--jini-chat-subtle\)/);
      expect(textRule).toMatch(/opacity:\s*\.\d+/);
    });

    // The specific failure an operator hit live: without an explicit reset, a host's own global
    // `button` styling (background/border/padding/border-radius/bold text) turns this plain-text
    // cancel affordance into a full pill-shaped button. Asserting the reset directly (not just
    // that some rule exists) is what stops that exact regression from recurring silently.
    it('resets the queued-cancel button so a host global `button` style cannot repaint it as a pill', () => {
      const cancelRule = CHAT_PANE_STYLES.match(/\.jini-chat-pane__queued-cancel \{([^}]*)\}/)?.[1] ?? '';
      expect(cancelRule).toMatch(/background:\s*none/);
      expect(cancelRule).toMatch(/border:\s*0/);
      expect(cancelRule).toMatch(/padding:\s*\S+/);
      expect(cancelRule).toMatch(/border-radius:\s*\S+/);
      expect(cancelRule).toMatch(/font-size:\s*\S+/);
      expect(cancelRule).toMatch(/font-weight:\s*\S+/);
    });
  });

  it('explains a failed typed-answer delivery without offering to send it as a new message', async () => {
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        initialDraft="ship the post"
        deliverTypedAnswer={Object.assign(async () => 'failed' as const, { toolName: 'assistant_ask_choice' })}
      />,
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    act(() => {
      transport.emit({ kind: 'tool_use', id: 'ask-1', name: 'assistant_ask_choice', input: {} });
      transport.emit({ kind: 'ext', name: 'unregistered-question', data: {} });
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'publish it' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Your answer could not be delivered. Try sending it again.');
    expect(screen.queryByRole('button', { name: 'Send as a new message' })).toBeNull();
  });

  it('automatically sends a stale question answer as a normal message once, without an error notice', async () => {
    const transport = createFakeChatTransport();
    const post = vi.fn(async () => new Response(null, { status: 409 }));
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        initialDraft="ship the post"
        deliverTypedAnswer={createTypedAnswerPoster({ baseUrl: '', fetch: post, toolName: 'assistant_ask_choice' })}
      />,
    );

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    act(() => {
      transport.emit({ kind: 'tool_use', id: 'ask-1', name: 'assistant_ask_choice', input: {} });
      transport.emit({ kind: 'ext', name: 'unregistered-question', data: {} });
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'publish it' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/mcp-ui/tool-calls', expect.objectContaining({
      body: JSON.stringify({ toolName: 'assistant_ask_choice', params: { __typedAnswer: 'publish it' } }),
    }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send as a new message' })).toBeNull();
    expect(transport.calls).toHaveLength(1);
    expect(screen.getAllByText('publish it')).toHaveLength(1);
    act(() => transport.finish());
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('publish it');
    expect(screen.getAllByText('publish it')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowUp', selectionStart: 0, selectionEnd: 0 });
    expect(screen.getByRole('textbox')).toHaveValue('publish it');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

it('hides prior automatic plugin usage immediately when the host chooses Off', () => {
  const initialMessages: ChatMessage[] = [{ id: 'plugin-turn', role: 'assistant', content: '', createdAt: 1,
    events: [{ kind: 'ext', name: 'agent_plugins', data: { conversationId: 'plugins-off-chat', plugins: [{ id: 'fixture', name: 'Fixture plugin' }] } }] }];
  const transport = createFakeChatTransport();
  const { rerender } = render(<ChatPane transport={transport} agents={agents} conversationId="plugins-off-chat" initialMessages={initialMessages} agentPluginsMode="auto" />);
  expect(screen.getByText('Using:')).toBeInTheDocument();
  rerender(<ChatPane transport={transport} agents={agents} conversationId="plugins-off-chat" initialMessages={initialMessages} agentPluginsMode="off" />);
  expect(screen.queryByText('Using:')).not.toBeInTheDocument();
});


describe('ChatPane accepted input recording', () => {
  it.each(['normal', 'answer', 'steer', 'queue', 'interrupt'] as const)(
    'shows and recalls an accepted %s once, including storage remount', async (path) => {
      let saved: readonly string[] = [];
      let transcript: ChatMessage[] = [];
      const storage = { read: async () => saved, write: async ({ entries }: { entries: readonly string[] }) => { saved = [...entries]; } };
      const transport = createFakeChatTransport();
      const answer: DeliverTypedAnswer = Object.assign(vi.fn(async () => 'delivered' as const), { toolName: 'assistant_ask_choice' });
      const steer = vi.fn(async () => 'delivered' as const);
      const view = render(<ChatPane transport={transport} agents={agents} initialDraft="first"
        composerHistoryScope={`accepted-${path}`} composerHistoryStorage={storage}
        onMessagesChange={messages => { transcript = messages; }}
        {...(path === 'answer' ? { deliverTypedAnswer: answer } : {})}
        {...(path === 'steer' ? { deliverMidRunMessage: steer } : {})} />);
      await act(async () => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); });
      await waitFor(() => expect(saved).toEqual(['first']));
      if (path === 'normal') act(() => transport.finish());
      if (path === 'answer') act(() => {
        transport.emit({ kind: 'tool_use', id: 'ask', name: answer.toolName, input: {} });
        transport.emit({ kind: 'ext', name: 'mcp-ui', data: { uri: 'ui://ask' } });
      });
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'accepted text' } });
      await act(async () => {
        const event = { key: 'Enter', ...(path === 'interrupt' ? { ctrlKey: true } : {}) };
        fireEvent.keyDown(screen.getByRole('textbox'), event);
        fireEvent.keyDown(screen.getByRole('textbox'), event);
      });
      await waitFor(() => expect(saved).toEqual(['first', 'accepted text']));
      expect(screen.getAllByText('accepted text')).toHaveLength(1);
      if (path === 'answer' || path === 'steer' || path === 'queue') expect(transport.calls).toHaveLength(1);
      if (path === 'answer') act(() => transport.emit({ kind: 'tool_result', toolUseId: 'ask', content: JSON.stringify({ submitted: true, freeText: 'accepted text' }), isError: false }));
      if (path === 'steer') act(() => transport.emit({ kind: 'ext', name: 'user_message', data: { id: 'persisted-steer', text: 'accepted text' } }));
      if (path === 'queue') act(() => transport.finish());
      await waitFor(() => expect(screen.getAllByText('accepted text')).toHaveLength(1));
      expect(saved).toEqual(['first', 'accepted text']);
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowUp', selectionStart: 0, selectionEnd: 0 });
      expect(screen.getByRole('textbox')).toHaveValue('accepted text');
      act(() => transport.finish());
      const reloaded = JSON.parse(JSON.stringify(transcript)) as ChatMessage[];
      view.unmount();
      const recovered = render(<ChatPane transport={createFakeChatTransport()} agents={agents}
        composerHistoryScope={`accepted-${path}`} composerHistoryStorage={storage} initialMessages={reloaded} />);
      await waitFor(() => expect(screen.getAllByText('accepted text')).toHaveLength(1));
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowUp', selectionStart: 0, selectionEnd: 0 });
      expect(screen.getByRole('textbox')).toHaveValue('accepted text');
      expect(saved).toEqual(['first', 'accepted text']);
      recovered.unmount();
    },
  );

  it('reconstructs typed answer bubbles and recall from saved tool results alone', () => {
    render(<ChatPane transport={createFakeChatTransport()} agents={agents} initialMessages={[{
      id: 'saved-answer', role: 'assistant', content: '', runStatus: 'succeeded', events: [
        { kind: 'tool_use', id: 'ask-saved', name: 'assistant_ask_choice', input: {} },
        { kind: 'tool_result', toolUseId: 'ask-saved', content: JSON.stringify({ submitted: true, freeText: 'saved answer' }), isError: false },
      ],
    }]} />);
    expect(screen.getAllByText('saved answer')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowUp', selectionStart: 0, selectionEnd: 0 });
    expect(screen.getByRole('textbox')).toHaveValue('saved answer');
  });

  it('keeps a rejected normal draft out of recall and preserves it for retry', async () => {
    const transport = createFakeChatTransport();
    transport.startRun = vi.fn(async () => { throw new Error('409 refused'); });
    let saved: readonly string[] = [];
    const storage = { read: async () => saved, write: async ({ entries }: { entries: readonly string[] }) => { saved = entries; } };
    render(<ChatPane transport={transport} agents={agents} composerHistoryStorage={storage} initialDraft="keep this draft" />);
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); });
    expect(screen.getByRole('textbox')).toHaveValue('keep this draft');
    expect(saved).toEqual([]);
    expect(document.querySelectorAll('.jini-message-user')).toHaveLength(0);
  });
});

// MOVE: Owner regression, 2026-10-20: preserve each submitted message and the screenshot's owner,
// while delivery remains one paid run. Inspect rendered bubbles as well as the transport payload.
describe('ChatPane per-message queue', () => {
  async function queueOwnerMessages(_required: {}, _options = {}) {
    const transport = createFakeChatTransport();
    const image = { path: 'attachment:footer', name: 'footer.png', kind: 'image' as const };
    let transcript: ChatMessage[] = [];
    const view = render(<ChatPane transport={transport} agents={agents} initialDraft="first turn"
      uploadAttachments={async () => [image]} onMessagesChange={messages => { transcript = messages; }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'were you stuck?' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await userEvent.upload(screen.getByTestId('composer-attachment-input'), new File(['pixels'], 'footer.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByTestId('composer-attachment-tray')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'add the footer icons' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    return { ...view, transport, image, transcript: () => transcript };
  }

  it('shows two queued bubbles with the screenshot only on message 2 and an empty composer', async () => {
    await queueOwnerMessages({});
    const bubbles = screen.getAllByTestId('chat-pane-queued');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toHaveTextContent('were you stuck?');
    expect(bubbles[0]!.querySelector('.jini-message-attachment-chip')).toBeNull();
    expect(bubbles[1]).toHaveTextContent('add the footer icons');
    expect(bubbles[1]!.querySelector('[aria-label="Open footer.png"]')).toBeInTheDocument();
    expect(bubbles.map(bubble => bubble.querySelectorAll('button[title="Cancel queued message"]').length)).toEqual([1, 1]);
    expect(screen.queryByTestId('composer-attachment-tray')).toBeNull();
  });

  it('flushes one combined turn with the screenshot and displays separate history bubbles, including reload', async () => {
    const fixture = await queueOwnerMessages({});
    act(() => fixture.transport.finish());
    await waitFor(() => expect(fixture.transport.calls).toHaveLength(2));
    expect(fixture.transport.calls[1]!.input.history.at(-1)?.content).toBe('were you stuck?\n\nadd the footer icons');
    expect(fixture.transport.calls[1]!.input.attachments).toEqual([fixture.image]);
    expect(screen.queryAllByTestId('chat-pane-queued')).toHaveLength(0);
    const first = screen.getByText('were you stuck?').closest('[data-message-id]');
    const second = screen.getByText('add the footer icons').closest('[data-message-id]');
    expect(first).not.toBe(second);
    expect(first!.querySelector('.jini-message-attachment-chip')).toBeNull();
    expect(second!.querySelector('[aria-label="Open footer.png"]')).toBeInTheDocument();
    act(() => fixture.transport.finish());
    const persisted = JSON.parse(JSON.stringify(fixture.transcript())) as ChatMessage[];
    fixture.unmount();
    render(<ChatPane transport={createFakeChatTransport()} agents={agents} initialMessages={persisted} />);
    expect(screen.getByText('were you stuck?').closest('[data-message-id]')).toHaveAttribute('data-message-id', first!.getAttribute('data-message-id'));
    expect(screen.getByText('add the footer icons').closest('[data-message-id]')).toHaveAttribute('data-message-id', second!.getAttribute('data-message-id'));
    expect(screen.getByRole('button', { name: 'Open footer.png' })).toBeInTheDocument();
  });

  it.each([0, 1])('cancels only queued message %s and delivers only the surviving message and its files', async index => {
    const { transport, image } = await queueOwnerMessages({});
    await userEvent.click(screen.getAllByTitle('Cancel queued message')[index]!);
    const remaining = screen.getAllByTestId('chat-pane-queued');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toHaveTextContent(index === 0 ? 'add the footer icons' : 'were you stuck?');
    act(() => transport.finish());
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]!.input.history.at(-1)?.content).toBe(index === 0 ? 'add the footer icons' : 'were you stuck?');
    expect(transport.calls[1]!.input.attachments).toEqual(index === 0 ? [image] : undefined);
  });

  it('canceling the last bubble empties the queue and never sends either message', async () => {
    const { transport } = await queueOwnerMessages({});
    await userEvent.click(screen.getAllByTitle('Cancel queued message')[0]!);
    await userEvent.click(screen.getByTitle('Cancel queued message'));
    expect(screen.queryAllByTestId('chat-pane-queued')).toHaveLength(0);
    expect(screen.queryByTestId('composer-attachment-tray')).toBeNull();
    act(() => transport.finish());
    expect(transport.calls).toHaveLength(1);
  });
});
