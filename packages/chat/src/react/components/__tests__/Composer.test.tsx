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
