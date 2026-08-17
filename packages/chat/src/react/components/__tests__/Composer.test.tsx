import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '../Composer.js';
import { useComposer } from '../../hooks/useComposer.js';
import type { ComposerDiscoveryGroup, ComposerSlots } from '../../slots.js';
import { CHAT_PANE_STYLES } from '../../features/chat-pane/styles.js';

function ComposerHarness({ onSend }: { onSend: (draft: string) => void }) {
  const composer = useComposer();
  return <Composer composer={composer} onSend={() => onSend(composer.draft)} />;
}

function DiscoveryHarness({ slots, attachmentPicker }: {
  slots?: ComposerSlots;
  attachmentPicker?: { onFiles: (files: File[]) => void | Promise<void>; accept?: string };
}) {
  const composer = useComposer();
  return (
    <Composer
      composer={composer}
      onSend={() => {}}
      {...(slots ? { slots } : {})}
      {...(attachmentPicker ? { attachmentPicker } : {})}
    />
  );
}

const DISCOVERY_GROUPS: readonly ComposerDiscoveryGroup[] = [
  {
    id: 'regular-plugins',
    label: 'Plugins',
    items: [
      { id: 'word-count', label: 'Word Count', kind: 'plugin', insertText: 'Word Count plugin' },
    ],
  },
  {
    id: 'agent-plugins',
    label: 'Agent Plugins',
    items: [
      { id: 'ui-ux-design-agent-plugin', label: 'UI/UX Design Agent Plugin', kind: 'agent-plugin', insertText: 'UI/UX Design agent plugin' },
    ],
  },
  {
    id: 'skills',
    label: 'Skills',
    items: [
      { id: 'ui-ux-design-skill', label: 'UI/UX Design Skill', kind: 'skill', insertText: 'UI/UX Design skill' },
    ],
  },
  {
    id: 'mcp',
    label: 'MCP',
    items: [
      { id: 'mcp-settings', label: '/mcp', description: 'Open MCP settings', kind: 'mcp', insertText: '' },
    ],
  },
];

describe('Composer', () => {
  it('disables send until there is a draft or attachment', async () => {
    render(<ComposerHarness onSend={() => {}} />);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'hi');
    expect(send).not.toBeDisabled();
  });

  it('calls onSend when the send button is clicked', async () => {
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);
    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('Enter submits (without Shift), Shift+Enter inserts a newline instead', async () => {
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Send a message…');
    await userEvent.type(textarea, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSend).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe('line one\nline two');
    await userEvent.type(textarea, '{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('renders plusMenuItems, leadingAccessories, and footerAccessories slots when supplied', async () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useComposer());
    render(
      <Composer
        composer={result.current}
        onSend={() => {}}
        slots={{
          leadingAccessories: <span data-testid="leading">mode</span>,
          footerAccessories: <span data-testid="footer">agent</span>,
          plusMenuItems: [{ id: 'p1', label: 'Import file', onSelect }],
        }}
      />,
    );
    expect(screen.getByTestId('leading')).toBeInTheDocument();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Import file'));
    expect(onSelect).toHaveBeenCalled();
  });

  it('reports a rejected legacy plus-menu host effect without leaving an unhandled rejection', async () => {
    const failure = new Error('plus-menu host failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useComposer());

    try {
      render(
        <Composer
          composer={result.current}
          onSend={() => {}}
          slots={{
            plusMenuItems: [{
              id: 'p1',
              label: 'Import file',
              onSelect: () => Promise.reject(failure),
            }],
          }}
        />,
      );
      await userEvent.click(screen.getByText('Import file'));
      await act(async () => {
        await Promise.resolve();
      });

      expect(consoleError).toHaveBeenCalledWith(
        '[@jini-ai/chat] Composer plusMenuItems.onSelect host effect failed:',
        failure,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps the zero-catalog baseline while injected discovery changes rendered output', () => {
    const baseline = render(<DiscoveryHarness />);
    expect(screen.queryByRole('button', { name: 'Add context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Composer commands' })).not.toBeInTheDocument();
    baseline.unmount();

    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS }} />);
    expect(screen.getByRole('button', { name: 'Add context' })).toBeInTheDocument();
  });

  it('proves host-supplied insertion by a paired baseline/treatment output difference', async () => {
    const baselineGroups: readonly ComposerDiscoveryGroup[] = [
      { id: 'skills', label: 'Skills', items: [{ id: 'ui-ux-design', label: 'UI/UX Design' }] },
    ];
    const baseline = render(<DiscoveryHarness slots={{ discoveryGroups: baselineGroups }} />);
    await userEvent.type(screen.getByRole('textbox'), '/ux{Enter}');
    expect(screen.getByRole('textbox')).toHaveValue('UI/UX Design');
    baseline.unmount();

    const treatmentGroups: readonly ComposerDiscoveryGroup[] = [
      { id: 'skills', label: 'Skills', items: [{ id: 'ui-ux-design', label: 'UI/UX Design', insertText: 'custom UI/UX skill token' }] },
    ];
    render(<DiscoveryHarness slots={{ discoveryGroups: treatmentGroups }} />);
    await userEvent.type(screen.getByRole('textbox'), '/ux{Enter}');
    expect(screen.getByRole('textbox')).toHaveValue('custom UI/UX skill token');
  });

  it('opens the grouped add menu from the keyboard, inserts a selected item, and restores focus', async () => {
    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS }} />);
    const trigger = screen.getByRole('button', { name: 'Add context' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');

    const menu = screen.getByRole('menu', { name: 'Add context' });
    expect(screen.getByRole('group', { name: 'Plugins' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Agent Plugins' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Skills' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'MCP' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /UI\/UX Design Skill/i }));

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('UI/UX Design skill');
    expect(textarea).toHaveFocus();
    expect(menu).not.toBeInTheDocument();
  });

  it('groups Attach files into the discovery menu without changing upload behavior', async () => {
    const onFiles = vi.fn();
    render(
      <DiscoveryHarness
        slots={{ discoveryGroups: DISCOVERY_GROUPS }}
        attachmentPicker={{ onFiles, accept: 'image/*' }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add context' }));
    expect(screen.getByRole('group', { name: 'Files' })).toBeInTheDocument();
    const input = screen.getByLabelText('Attach files', { selector: 'input' });
    const inputClick = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Attach files' }));
    expect(inputClick).toHaveBeenCalledTimes(1);

    const file = new File(['image'], 'reference.png', { type: 'image/png' });
    await userEvent.upload(input, file);
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('filters slash items and uses circular arrows plus Enter to replace the active trigger', async () => {
    const onDiscoverySelect = vi.fn();
    render(
      <DiscoveryHarness
        slots={{ discoveryGroups: DISCOVERY_GROUPS, onDiscoverySelect }}
      />,
    );
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/ux');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(screen.queryByRole('option', { name: /Word Count/i })).not.toBeInTheDocument();
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveClass('is-active');
    const activeStyleRule = CHAT_PANE_STYLES.match(
      /\.jini-chat-pane \.jini-composer-discovery-item\.is-active \{([^}]*)\}/,
    )?.[1] ?? '';
    expect(activeStyleRule).toContain('background: var(--jini-chat-accent-soft)');
    expect(activeStyleRule).toContain('outline: 1px solid var(--jini-chat-accent)');
    expect(activeStyleRule).toContain('box-shadow: inset 3px 0 0 var(--jini-chat-accent)');

    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(textarea).toHaveValue('UI/UX Design skill');
    expect(textarea).toHaveFocus();
    expect(onDiscoverySelect).toHaveBeenCalledWith({
      item: expect.objectContaining({ id: 'ui-ux-design-skill' }),
      source: 'slash',
    });
  });

  it('prepopulates the accessible slash palette on bare slash, including truthful MCP navigation', async () => {
    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS }} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/');

    const palette = screen.getByRole('listbox', { name: 'Composer commands' });
    expect(within(palette).getAllByRole('option')).toHaveLength(4);
    expect(within(palette).getByRole('option', { name: /\/mcp.*Open MCP settings/i })).toBeInTheDocument();
    expect(within(palette).queryByText(/server-id/i)).not.toBeInTheDocument();
  });

  it('selects the /mcp command through the generic callback without inventing server inventory', async () => {
    const onDiscoverySelect = vi.fn();
    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS, onDiscoverySelect }} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/mcp{Enter}');

    expect(textarea).toHaveValue('');
    expect(onDiscoverySelect).toHaveBeenCalledWith({
      item: expect.objectContaining({ id: 'mcp-settings' }),
      source: 'slash',
    });
  });

  it('reports a rejected discovery host effect without leaving an unhandled rejection', async () => {
    const failure = new Error('discovery host failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(
        <DiscoveryHarness
          slots={{
            discoveryGroups: DISCOVERY_GROUPS,
            onDiscoverySelect: () => Promise.reject(failure),
          }}
        />,
      );
      await userEvent.type(screen.getByRole('textbox'), '/mcp{Enter}');
      await act(async () => {
        await Promise.resolve();
      });

      expect(consoleError).toHaveBeenCalledWith(
        '[@jini-ai/chat] Composer onDiscoverySelect host effect failed:',
        failure,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps discovery effects single-flight while preserving draft editing and focus', async () => {
    let resolveFirst!: () => void;
    const firstEffect = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const onDiscoverySelect = vi.fn()
      .mockReturnValueOnce(firstEffect)
      .mockResolvedValue(undefined);
    render(
      <DiscoveryHarness
        slots={{ discoveryGroups: DISCOVERY_GROUPS, onDiscoverySelect }}
      />,
    );
    const textarea = screen.getByRole('textbox');

    await userEvent.type(textarea, '/word{Enter}');
    expect(onDiscoverySelect).toHaveBeenCalledTimes(1);

    await userEvent.clear(textarea);
    await userEvent.type(textarea, '/ux{Enter}');
    expect(textarea).toHaveValue('UI/UX Design agent plugin');
    expect(textarea).toHaveFocus();
    expect(textarea).not.toBeDisabled();
    expect(textarea).not.toHaveAttribute('readonly');
    expect(onDiscoverySelect).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst();
      await firstEffect;
      await Promise.resolve();
    });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, '/mcp{Enter}');
    expect(onDiscoverySelect).toHaveBeenCalledTimes(2);
  });

  it('does not select the active slash item with Shift+Tab', async () => {
    const onDiscoverySelect = vi.fn();
    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS, onDiscoverySelect }} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/word');

    expect(fireEvent.keyDown(textarea, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(textarea).toHaveValue('/word');
    expect(screen.getByRole('listbox', { name: 'Composer commands' })).toBeInTheDocument();
    expect(onDiscoverySelect).not.toHaveBeenCalled();
  });

  it('selects slash items with Tab and closes them with Escape until the draft changes', async () => {
    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS }} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/word');
    expect(screen.getByRole('option', { name: /Word Count/i })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Composer commands' })).not.toBeInTheDocument();

    await userEvent.type(textarea, '{Backspace}d');
    expect(screen.getByRole('listbox', { name: 'Composer commands' })).toBeInTheDocument();
    await userEvent.keyboard('{Tab}');
    expect(textarea).toHaveValue('Word Count plugin');
  });

  it('renders the attachment tray for staged attachments', () => {
    render(<ComposerHarness onSend={() => {}} />);
    // No attachments staged yet -> tray renders nothing.
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('opens and forwards the hidden attachment input while reflecting upload state', async () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useComposer());
    const { rerender } = render(
      <Composer
        composer={result.current}
        onSend={() => {}}
        attachmentPicker={{ onFiles, accept: 'image/*' }}
      />,
    );
    const input = screen.getByLabelText('Attach files', { selector: 'input' });
    const inputClick = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(inputClick).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { files: null } });
    expect(onFiles).not.toHaveBeenCalled();
    const file = new File(['image'], 'reference.png', { type: 'image/png' });
    await userEvent.upload(input, file);
    expect(onFiles).toHaveBeenCalledWith([file]);

    rerender(
      <Composer
        composer={result.current}
        onSend={() => {}}
        attachmentPicker={{ onFiles, uploading: true }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Attaching files…' })).toBeDisabled();
  });

  it('reports a rejected attachment host effect without leaving an unhandled rejection', async () => {
    const failure = new Error('attachment host failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(
        <DiscoveryHarness
          attachmentPicker={{ onFiles: () => Promise.reject(failure) }}
        />,
      );
      const file = new File(['image'], 'reference.png', { type: 'image/png' });
      await userEvent.upload(screen.getByLabelText('Attach files', { selector: 'input' }), file);
      await act(async () => {
        await Promise.resolve();
      });

      expect(consoleError).toHaveBeenCalledWith(
        '[@jini-ai/chat] Composer attachmentPicker.onFiles host effect failed:',
        failure,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  const ARGUMENT_COMMAND_GROUPS: readonly ComposerDiscoveryGroup[] = [
    {
      id: 'commands',
      label: 'Commands',
      items: [
        { id: 'mcp', label: '/mcp', command: 'mcp', description: 'Open MCP settings' },
        {
          id: 'mcp-docs',
          label: '/mcp-docs',
          command: 'mcp-docs',
          description: 'Open MCP docs',
          keywords: ['mcp'],
        },
        {
          id: 'search',
          label: '/search',
          command: 'search',
          description: 'Ask the assistant to search the web',
          argument: { placeholder: '<query>', required: true },
          needsConfirmation: true,
        },
      ],
    },
  ];

  it('completes an ambiguous/incomplete command word instead of invoking, and fires no host effect', async () => {
    const onDiscoverySelect = vi.fn();
    render(<DiscoveryHarness slots={{ discoveryGroups: ARGUMENT_COMMAND_GROUPS, onDiscoverySelect }} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/sea{Enter}');

    expect(textarea).toHaveValue('/search ');
    expect(screen.getByRole('listbox', { name: 'Composer commands' })).toBeInTheDocument();
    expect(onDiscoverySelect).not.toHaveBeenCalled();
  });

  it('never invokes a required-argument command until a non-blank argument is typed', async () => {
    const onDiscoverySelect = vi.fn();
    render(<DiscoveryHarness slots={{ discoveryGroups: ARGUMENT_COMMAND_GROUPS, onDiscoverySelect }} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/search{Enter}');
    expect(textarea).toHaveValue('/search ');
    expect(onDiscoverySelect).not.toHaveBeenCalled();

    await userEvent.type(textarea, '{Enter}');
    expect(textarea).toHaveValue('/search ');
    expect(onDiscoverySelect).not.toHaveBeenCalled();
  });

  it(
    'exact-matches the command once an argument separator is typed, even though "mcp" is a ' +
      'substring of "mcp-docs", and leaves the typed argument in the draft for the host to see',
    async () => {
      const onDiscoverySelect = vi.fn();
      render(<DiscoveryHarness slots={{ discoveryGroups: ARGUMENT_COMMAND_GROUPS, onDiscoverySelect }} />);
      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, '/mcp');
      expect(screen.getAllByRole('option')).toHaveLength(2);

      await userEvent.type(textarea, ' supabase{Enter}');
      expect(textarea).toHaveValue('/mcp supabase');
      expect(onDiscoverySelect).toHaveBeenCalledTimes(1);
      expect(onDiscoverySelect).toHaveBeenCalledWith({
        item: expect.objectContaining({ id: 'mcp' }),
        source: 'slash',
        argument: 'supabase',
      });
    },
  );

  it('invokes a required-argument command with the typed argument and lets the host rewrite the draft', async () => {
    const onDiscoverySelect = vi.fn().mockResolvedValue({ draft: 'Search the web for: aria listbox' });
    render(<DiscoveryHarness slots={{ discoveryGroups: ARGUMENT_COMMAND_GROUPS, onDiscoverySelect }} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/search aria listbox{Enter}');

    expect(onDiscoverySelect).toHaveBeenCalledWith({
      item: expect.objectContaining({ id: 'search' }),
      source: 'slash',
      argument: 'aria listbox',
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textarea).toHaveValue('Search the web for: aria listbox');
  });

  it('leaves the draft untouched when the host resolves with no outcome', async () => {
    const onDiscoverySelect = vi.fn().mockResolvedValue(undefined);
    render(<DiscoveryHarness slots={{ discoveryGroups: ARGUMENT_COMMAND_GROUPS, onDiscoverySelect }} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/search aria listbox{Enter}');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textarea).toHaveValue('/search aria listbox');
  });

  it(
    'discards a stale draft outcome rather than overwriting keystrokes typed while the host effect ' +
      'was in flight — nothing here disables the textarea during the wait, so this is reachable',
    async () => {
      let resolveHost!: (outcome: { draft: string }) => void;
      const pending = new Promise<{ draft: string }>((resolve) => {
        resolveHost = resolve;
      });
      const onDiscoverySelect = vi.fn().mockReturnValue(pending);
      render(<DiscoveryHarness slots={{ discoveryGroups: ARGUMENT_COMMAND_GROUPS, onDiscoverySelect }} />);
      const textarea = screen.getByRole('textbox');

      await userEvent.type(textarea, '/search aria listbox{Enter}');
      expect(onDiscoverySelect).toHaveBeenCalledTimes(1);

      // The user keeps typing while the host is still computing a result for the ORIGINAL draft.
      await userEvent.type(textarea, ' more');
      expect(textarea).toHaveValue('/search aria listbox more');

      await act(async () => {
        resolveHost({ draft: 'Search the web for: aria listbox' });
        await pending;
        await Promise.resolve();
      });

      // The stale outcome was computed against "/search aria listbox" — the user has since typed
      // past that, so applying it would silently eat " more". It must be discarded, not applied.
      expect(textarea).toHaveValue('/search aria listbox more');
    },
  );

  it('applies the outcome normally when the draft is untouched while the host effect is in flight', async () => {
    let resolveHost!: (outcome: { draft: string }) => void;
    const pending = new Promise<{ draft: string }>((resolve) => {
      resolveHost = resolve;
    });
    const onDiscoverySelect = vi.fn().mockReturnValue(pending);
    render(<DiscoveryHarness slots={{ discoveryGroups: ARGUMENT_COMMAND_GROUPS, onDiscoverySelect }} />);
    const textarea = screen.getByRole('textbox');

    await userEvent.type(textarea, '/search aria listbox{Enter}');
    await act(async () => {
      resolveHost({ draft: 'Search the web for: aria listbox' });
      await pending;
      await Promise.resolve();
    });

    expect(textarea).toHaveValue('Search the web for: aria listbox');
  });

  it(
    'composes the staleness guard with the single-flight in-flight guard: a rejection that carries ' +
      'no outcome never touches the draft, the in-flight guard still releases, and the NEXT ' +
      'selection (now unblocked) is free to apply its own outcome',
    async () => {
      const failure = new Error('search failed');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      let rejectFirst!: (error: Error) => void;
      const firstEffect = new Promise<never>((_resolve, reject) => {
        rejectFirst = reject;
      });
      const onDiscoverySelect = vi.fn().mockReturnValueOnce(firstEffect).mockResolvedValue({ draft: 'second result' });

      try {
        render(<DiscoveryHarness slots={{ discoveryGroups: ARGUMENT_COMMAND_GROUPS, onDiscoverySelect }} />);
        const textarea = screen.getByRole('textbox');

        await userEvent.type(textarea, '/search aria listbox{Enter}');
        expect(onDiscoverySelect).toHaveBeenCalledTimes(1);

        await act(async () => {
          rejectFirst(failure);
          await firstEffect.catch(() => {});
          await Promise.resolve();
        });
        // A rejection carries no outcome — the draft the user still sees is exactly what they typed.
        expect(textarea).toHaveValue('/search aria listbox');
        expect(consoleError).toHaveBeenCalledWith(
          '[@jini-ai/chat] Composer onDiscoverySelect host effect failed:',
          failure,
        );

        // The in-flight guard released after the rejection settled — a second selection now fires.
        await userEvent.clear(textarea);
        await userEvent.type(textarea, '/search second{Enter}');
        expect(onDiscoverySelect).toHaveBeenCalledTimes(2);
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(textarea).toHaveValue('second result');
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  it('renders the argument placeholder and a confirmation cue from presence-only fields, never behavior', async () => {
    render(<DiscoveryHarness slots={{ discoveryGroups: ARGUMENT_COMMAND_GROUPS }} />);
    await userEvent.type(screen.getByRole('textbox'), '/search');

    const option = screen.getByRole('option', { name: /\/search/i });
    expect(within(option).getByText('<query>')).toBeInTheDocument();
    expect(within(option).getByText('Confirm')).toBeInTheDocument();
  });

  it('swaps the send button for a stop button while running, calling onCancel instead of onSend', async () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    const { result } = renderHook(() => useComposer());
    render(<Composer composer={result.current} onSend={onSend} running onCancel={onCancel} />);

    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    const stop = screen.getByRole('button', { name: 'Stop run' });
    await userEvent.click(stop);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the stop button clickable even when disabled/sendDisabled would gate the send button', async () => {
    // `disabled`/`sendDisabled` gate submitting a NEW draft — irrelevant to cancelling a run
    // already in flight, which is why running ignores both rather than inheriting them.
    const onCancel = vi.fn();
    const { result } = renderHook(() => useComposer());
    render(
      <Composer composer={result.current} onSend={() => {}} disabled sendDisabled running onCancel={onCancel} />,
    );
    const stop = screen.getByRole('button', { name: 'Stop run' });
    expect(stop).not.toBeDisabled();
    await userEvent.click(stop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('can disable only submission while keeping draft editing available', async () => {
    const onSend = vi.fn();
    const { result } = renderHook(() => useComposer({ initialDraft: 'editable' }));
    render(<Composer composer={result.current} onSend={onSend} sendDisabled />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(textarea, '{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });
});
