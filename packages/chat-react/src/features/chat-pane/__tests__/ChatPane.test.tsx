import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@jini-ai/chat-core';
import { FILE_SYSTEM_READ_ERROR_MESSAGE } from '@jini-ai/ui';
import { createFakeChatTransport } from '../../../react/hooks/testing/fake-transport.js';
import { ChatPane } from '../react/components/ChatPane.js';
import type { ChatPaneActivity, ChatPaneAgent } from '../types.js';

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

    expect(screen.getByRole('status')).toHaveTextContent('Checking working directory…');
    expect(await screen.findByText('inventory unavailable')).toBeInTheDocument();
    await act(async () => resolveExists(false));
    expect(await screen.findByText('Working directory is unavailable.')).toBeInTheDocument();
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

    it('shows the plain working directory, without a picker, when no access is supplied', () => {
      render(
        <ChatPane
          transport={createFakeChatTransport()}
          agents={agents}
          initialWorkingDirectory="/Users/test/current"
        />,
      );

      expect(screen.getByText('Working directory')).toBeInTheDocument();
      expect(screen.getByText('/Users/test/current')).toBeInTheDocument();
      expect(screen.queryByLabelText('Select working directory')).not.toBeInTheDocument();
    });
  });
});
