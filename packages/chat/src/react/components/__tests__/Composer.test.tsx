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

  it('closes the grouped add menu on an outside click but not on a click inside it', async () => {
    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add context' }));
    const menu = screen.getByRole('menu', { name: 'Add context' });

    // A click INSIDE the popover (its own group label, not an actionable item) must not dismiss it —
    // only a click that lands outside `.jini-composer-discovery` entirely should.
    await userEvent.click(within(menu).getByText('Plugins'));
    expect(screen.getByRole('menu', { name: 'Add context' })).toBeInTheDocument();

    await userEvent.click(document.body);
    expect(screen.queryByRole('menu', { name: 'Add context' })).not.toBeInTheDocument();
  });

  it('closes the slash palette on an outside click, but a click back into the textarea keeps it open', async () => {
    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS }} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/word');
    expect(screen.getByRole('listbox', { name: 'Composer commands' })).toBeInTheDocument();

    // Repositioning the cursor in the textarea is not "clicking away" — the palette must survive it,
    // or every click a user makes to edit their own draft would silently kill the palette.
    await userEvent.click(textarea);
    expect(screen.getByRole('listbox', { name: 'Composer commands' })).toBeInTheDocument();

    await userEvent.click(document.body);
    expect(screen.queryByRole('listbox', { name: 'Composer commands' })).not.toBeInTheDocument();
  });

  it('keeps the add-menu row compact — description is a real styled hover/focus tooltip, not a bare title, and stays reachable for assistive tech', async () => {
    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add context' }));
    const item = screen.getByRole('menuitem', { name: /^\/mcp/ });

    // A bare native `title` was rejected on review (~1s delay, unstyled, no touch support) in favor
    // of a real tooltip matching the popover's own look — asserting its absence keeps this test
    // honest about which mechanism is actually in play.
    expect(item).not.toHaveAttribute('title');
    const describedBy = item.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy!);
    expect(description).toHaveTextContent('Open MCP settings');
    expect(description).toHaveClass('jini-composer-discovery-description');
    // Never `display: none` — most screen readers drop an `aria-describedby` target from the
    // accessibility tree entirely once it's `display: none`, which would silently un-fix this bug.
    // `opacity`/`pointer-events` (not `display`/`visibility`) is what keeps this node present at
    // rest and only visually revealed on `:hover`/`:focus-visible` of the row.
    const descriptionStyleRule = CHAT_PANE_STYLES.match(
      /\.jini-chat-pane \.jini-composer-discovery-description \{([^}]*)\}/,
    )?.[1] ?? '';
    expect(descriptionStyleRule).not.toContain('display: none');
    expect(descriptionStyleRule).toContain('opacity: 0');
    expect(descriptionStyleRule).toContain('pointer-events: none');
    const revealStyleRule = CHAT_PANE_STYLES.match(
      /\.jini-chat-pane \.jini-composer-discovery-item:hover \.jini-composer-discovery-description,\s*\n\.jini-chat-pane \.jini-composer-discovery-item:focus-visible \.jini-composer-discovery-description \{([^}]*)\}/,
    )?.[1] ?? '';
    expect(revealStyleRule).toContain('opacity: 1');
  });

  it('expands the hovered description in normal flow instead of floating it over the next row', async () => {
    // Regression test for an owner-reported bug: hovering "UI/UX Design (Skill)" popped a
    // description box that painted over the "/mcp" row beneath it. Root cause was
    // '.jini-composer-discovery-description' being 'position: absolute; top: 100%' of its own
    // row — a stacking z-index fix would only have changed WHICH box wins the overlap, not
    // removed the overlap itself, so the real fix is confining the description to the row's own
    // normal flex-column flow so an expanding row pushes its siblings down instead of covering
    // them. This asserts the mechanism, not just the visual symptom: the description rule must
    // not remove itself from flow via 'position: absolute' (or 'fixed').
    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add context' }));
    const item = screen.getByRole('menuitem', { name: /^\/mcp/ });
    const describedBy = item.getAttribute('aria-describedby');
    const description = document.getElementById(describedBy!);
    expect(description).toHaveClass('jini-composer-discovery-description');

    const descriptionStyleRule = CHAT_PANE_STYLES.match(
      /\.jini-chat-pane \.jini-composer-discovery-description \{([^}]*)\}/,
    )?.[1] ?? '';
    expect(descriptionStyleRule).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(descriptionStyleRule).not.toContain('z-index');

    // Collapsed at rest via 'max-height: 0', not 'display: none' — still resolvable via
    // 'aria-describedby' — and now sized to the row's own width so it wraps in place instead of
    // floating off to one side.
    expect(descriptionStyleRule).toContain('max-height: 0');
    expect(descriptionStyleRule).toContain('width: 100%');
  });

  it('anchors the add-menu and slash palette with position: fixed so an overflow: hidden ancestor cannot clip them', async () => {
    // Regression test for an owner-reported bug: the list read as "clipped mid-item" at the top
    // instead of cleanly scrolled. Root cause was both popovers being plain `position: absolute`
    // descendants of `.jini-composer`, itself inside `.jini-chat-pane__body` — which sets
    // `overflow: hidden` unconditionally — plus whatever clipping box a host's own dock chrome
    // adds (a host admin's `.admin-chat-dock` is `overflow: hidden` too, and its mobile "peek" sheet
    // caps the whole dock at 58vh). The exact arithmetic (viewport-clamped `maxHeight`/`bottom`) is
    // covered directly in `composer-discovery.test.ts`; this asserts the wiring — that `Composer`
    // actually applies the computed `position: fixed` style to each popover's DOM node, the same
    // way `AgentRuntimePicker`'s already-portaled popover escapes the identical ancestor.
    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS }} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add context' }));
    const menu = screen.getByRole('menu', { name: 'Add context' });
    expect(menu.style.position).toBe('fixed');
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu', { name: 'Add context' })).not.toBeInTheDocument();

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/word');
    const palette = screen.getByRole('listbox', { name: 'Composer commands' });
    expect(palette.style.position).toBe('fixed');
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

  it('hints that typing narrows the list on a bare slash, and drops the hint once a real query is typed', async () => {
    render(<DiscoveryHarness slots={{ discoveryGroups: DISCOVERY_GROUPS }} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '/');

    const palette = screen.getByRole('listbox', { name: 'Composer commands' });
    const hint = within(palette).getByText('Keep typing to narrow the list');
    expect(hint).toHaveAttribute('role', 'presentation');

    await userEvent.type(textarea, 'word');
    expect(within(palette).queryByText('Keep typing to narrow the list')).not.toBeInTheDocument();
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

  it(
    'stages a file pasted directly into the textarea — a screenshot or a Finder-copied video ' +
      'carries no text, so without this the owner-reported symptom is total silence: no chip, no ' +
      'network call, nothing',
    () => {
      const onFiles = vi.fn();
      render(<DiscoveryHarness attachmentPicker={{ onFiles, accept: 'image/*' }} />);
      const textarea = screen.getByRole('textbox');
      const file = new File(['image'], 'clipboard-image.png', { type: 'image/png' });
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(pasteEvent, 'clipboardData', { value: { files: [file] } });

      act(() => {
        textarea.dispatchEvent(pasteEvent);
      });

      expect(onFiles).toHaveBeenCalledWith([file]);
    },
  );

  it('lets an ordinary text paste through untouched when the clipboard carries no files', async () => {
    const onFiles = vi.fn();
    render(<DiscoveryHarness attachmentPicker={{ onFiles }} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'hello ');
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', { value: { files: [] } });

    act(() => {
      textarea.dispatchEvent(pasteEvent);
    });

    expect(onFiles).not.toHaveBeenCalled();
  });

  it('ignores a file paste when no attachmentPicker is wired, without throwing', () => {
    render(<ComposerHarness onSend={() => {}} />);
    const textarea = screen.getByRole('textbox');
    const file = new File(['image'], 'clipboard-image.png', { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', { value: { files: [file] } });

    expect(() => {
      act(() => {
        textarea.dispatchEvent(pasteEvent);
      });
    }).not.toThrow();
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

  it('puts the argument placeholder and confirm badge on the same type scale as the row label', async () => {
    // `<code>`/`<small>` default to the browser's own UA styling (monospace, unrelated size) with
    // nothing overriding it today — that's what read as "visibly larger" next to the label even
    // though the computed font-size already happened to match; the fix is a font-family reset, not
    // a size change, so this asserts the actual rule rather than a computed size that already passed.
    const argumentStyleRule = CHAT_PANE_STYLES.match(
      /\.jini-chat-pane \.jini-composer-slash-argument,\s*\n\.jini-chat-pane \.jini-composer-slash-confirm-badge \{([^}]*)\}/,
    )?.[1] ?? '';
    expect(argumentStyleRule).toContain('font-family: inherit');
    expect(argumentStyleRule).toContain('font-size: inherit');
  });

  it('keeps the slash row compact — description is a real hover/focus tooltip, not a bare title, and stays reachable for assistive tech', async () => {
    render(<DiscoveryHarness slots={{ discoveryGroups: ARGUMENT_COMMAND_GROUPS }} />);
    await userEvent.type(screen.getByRole('textbox'), '/mcp');
    // `/mcp` fuzzy-matches both "mcp" and "mcp-docs" (existing test above, line ~470) — disambiguate
    // the same way the existing bare-slash test does (line ~245), by requiring both label and
    // description text rather than the label alone.
    const option = screen.getByRole('option', { name: /\/mcp.*Open MCP settings/i });

    expect(option).not.toHaveAttribute('title');
    const describedBy = option.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy!);
    expect(description).toHaveTextContent('Open MCP settings');
    expect(description).toHaveClass('jini-composer-discovery-description');
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

  it('routes Cmd/Ctrl+Enter to onInterrupt instead of onSend when supplied', async () => {
    const onSend = vi.fn();
    const onInterrupt = vi.fn();
    const { result } = renderHook(() => useComposer());
    act(() => result.current.setDraft('next turn'));
    render(
      <Composer composer={result.current} onSend={onSend} onInterrupt={onInterrupt} sendDisabled />,
    );
    const textarea = screen.getByPlaceholderText('Send a message…');
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onInterrupt).toHaveBeenCalledTimes(2);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('a host with no onInterrupt keeps the original Enter behavior on Cmd/Ctrl+Enter — falls through to onSend, still gated by sendDisabled', async () => {
    const onSend = vi.fn();
    const { result } = renderHook(() => useComposer());
    act(() => result.current.setDraft('hello'));
    const { rerender } = render(<Composer composer={result.current} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Send a message…');

    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);

    rerender(<Composer composer={result.current} onSend={onSend} sendDisabled />);
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
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

  it(
    'tags the file input with a stable E2E hook regardless of which render site is live — the ' +
      'plain attachment picker (no discovery items) or the "+" discovery menu\'s Files group',
    async () => {
      const onFiles = vi.fn();
      // No discoveryGroups -> hasDiscoveryItems is false -> Composer.tsx's own <input> renders.
      const { unmount } = render(<DiscoveryHarness attachmentPicker={{ onFiles, accept: 'image/*' }} />);
      expect(screen.getByTestId('composer-attachment-input')).toHaveAttribute('accept', 'image/*');
      unmount();

      // discoveryGroups present -> hasDiscoveryItems is true -> ComposerDiscovery.tsx's <input> renders.
      render(
        <DiscoveryHarness
          slots={{ discoveryGroups: DISCOVERY_GROUPS }}
          attachmentPicker={{ onFiles, accept: 'image/*' }}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Add context' }));
      expect(screen.getByTestId('composer-attachment-input')).toHaveAttribute('accept', 'image/*');
    },
  );

  it('no longer renders any streaming interrupt hint — the queueing behavior itself is unchanged (see the Cmd/Ctrl+Enter tests above)', () => {
    const { result } = renderHook(() => useComposer());
    render(
      <Composer composer={result.current} onSend={() => {}} running onCancel={() => {}} onInterrupt={() => {}} />,
    );
    expect(screen.queryByText(/queues this after the run finishes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/interrupts it and sends now/)).not.toBeInTheDocument();
  });

  describe('working directory trigger', () => {
    it('is absent when the host has not wired onChangeWorkingDirectory', () => {
      const { result } = renderHook(() => useComposer());
      render(<Composer composer={result.current} onSend={() => {}} workingDirectory="/repo" />);
      expect(screen.queryByTestId('composer-workdir')).not.toBeInTheDocument();
    });

    it('labels the trigger with the current directory, or a fallback when none is set', () => {
      const { result } = renderHook(() => useComposer());
      const { rerender } = render(
        <Composer composer={result.current} onSend={() => {}} onChangeWorkingDirectory={() => {}} />,
      );
      expect(screen.getByTestId('composer-workdir-trigger')).toHaveAccessibleName('Set working directory');

      rerender(
        <Composer
          composer={result.current}
          onSend={() => {}}
          workingDirectory="/Users/test/project"
          onChangeWorkingDirectory={() => {}}
        />,
      );
      expect(screen.getByTestId('composer-workdir-trigger')).toHaveAccessibleName(
        'Working directory: /Users/test/project',
      );
    });

    it('confirming a typed path calls onChangeWorkingDirectory and closes the popover', async () => {
      const onChangeWorkingDirectory = vi.fn();
      const { result } = renderHook(() => useComposer());
      render(
        <Composer
          composer={result.current}
          onSend={() => {}}
          workingDirectory="/repo"
          onChangeWorkingDirectory={onChangeWorkingDirectory}
        />,
      );

      await userEvent.click(screen.getByTestId('composer-workdir-trigger'));
      const input = screen.getByTestId('composer-workdir-input');
      expect(input).toHaveValue('/repo');
      await userEvent.clear(input);
      await userEvent.type(input, '/repo/subdir');
      await userEvent.click(screen.getByTestId('composer-workdir-confirm'));

      expect(onChangeWorkingDirectory).toHaveBeenCalledTimes(1);
      expect(onChangeWorkingDirectory).toHaveBeenCalledWith('/repo/subdir');
      expect(screen.queryByTestId('composer-workdir-panel')).not.toBeInTheDocument();
    });

    it('confirming via Enter has the same effect as clicking the confirm button', async () => {
      const onChangeWorkingDirectory = vi.fn();
      const { result } = renderHook(() => useComposer());
      render(
        <Composer composer={result.current} onSend={() => {}} onChangeWorkingDirectory={onChangeWorkingDirectory} />,
      );
      await userEvent.click(screen.getByTestId('composer-workdir-trigger'));
      await userEvent.type(screen.getByTestId('composer-workdir-input'), '/new/dir{Enter}');
      expect(onChangeWorkingDirectory).toHaveBeenCalledTimes(1);
      expect(onChangeWorkingDirectory).toHaveBeenCalledWith('/new/dir');
    });

    it('Escape closes the popover without calling onChangeWorkingDirectory', async () => {
      const onChangeWorkingDirectory = vi.fn();
      const { result } = renderHook(() => useComposer());
      render(
        <Composer
          composer={result.current}
          onSend={() => {}}
          workingDirectory="/repo"
          onChangeWorkingDirectory={onChangeWorkingDirectory}
        />,
      );
      await userEvent.click(screen.getByTestId('composer-workdir-trigger'));
      await userEvent.type(screen.getByTestId('composer-workdir-input'), '{Escape}');
      expect(screen.queryByTestId('composer-workdir-panel')).not.toBeInTheDocument();
      expect(onChangeWorkingDirectory).not.toHaveBeenCalled();
    });

    it('confirming a blank draft closes without calling the host — there is no clear affordance here', async () => {
      const onChangeWorkingDirectory = vi.fn();
      const { result } = renderHook(() => useComposer());
      render(
        <Composer
          composer={result.current}
          onSend={() => {}}
          workingDirectory="/repo"
          onChangeWorkingDirectory={onChangeWorkingDirectory}
        />,
      );
      await userEvent.click(screen.getByTestId('composer-workdir-trigger'));
      await userEvent.clear(screen.getByTestId('composer-workdir-input'));
      await userEvent.click(screen.getByTestId('composer-workdir-confirm'));
      expect(onChangeWorkingDirectory).not.toHaveBeenCalled();
      expect(screen.queryByTestId('composer-workdir-panel')).not.toBeInTheDocument();
    });

    // Regression: when a host has a native `ChatPaneWorkingDirectoryAccess`, `ChatPane` wires this
    // trigger to `onPickWorkingDirectory` instead of `onChangeWorkingDirectory` — clicking must
    // invoke the native dialog directly, never open the in-page text popover.
    it('renders the trigger for onPickWorkingDirectory alone, with no onChangeWorkingDirectory', () => {
      const { result } = renderHook(() => useComposer());
      render(
        <Composer
          composer={result.current}
          onSend={() => {}}
          workingDirectory="/Users/test/project"
          onPickWorkingDirectory={() => {}}
        />,
      );
      expect(screen.getByTestId('composer-workdir-trigger')).toHaveAccessibleName(
        'Working directory: /Users/test/project',
      );
    });

    it('clicking the trigger calls onPickWorkingDirectory directly, never opening the text popover', async () => {
      const onPickWorkingDirectory = vi.fn();
      const { result } = renderHook(() => useComposer());
      render(
        <Composer
          composer={result.current}
          onSend={() => {}}
          workingDirectory="/repo"
          onPickWorkingDirectory={onPickWorkingDirectory}
        />,
      );
      await userEvent.click(screen.getByTestId('composer-workdir-trigger'));
      expect(onPickWorkingDirectory).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('composer-workdir-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('composer-workdir-input')).not.toBeInTheDocument();
    });
  });
});
