import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { ToolCard } from '../ToolCard.js';
import { registerToolRenderer, clearToolRenderers } from '../../../tool-renderer-registry.js';

afterEach(() => clearToolRenderers());

describe('ToolCard', () => {
  it('renders a Bash card with the command and output', async () => {
    render(<ToolCard use={{ kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la' } }} result={{ kind: 'tool_result', toolUseId: 't1', content: 'a.txt\nb.txt', isError: false }} runSucceeded />);
    expect(screen.getByText('Bash')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('ls -la')).toBeInTheDocument();
    expect(document.querySelector('.op-output')?.textContent).toBe('a.txt\nb.txt');
  });

  it('falls back to GenericCard for an unrecognized tool', () => {
    render(<ToolCard use={{ kind: 'tool_use', id: 't2', name: 'CustomTool', input: { query: 'hello' } }} runSucceeded />);
    expect(screen.getByText('CustomTool')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('shows a spinner status while running with no result yet', () => {
    render(<ToolCard use={{ kind: 'tool_use', id: 't3', name: 'WebFetch', input: { url: 'https://x.test' } }} runStreaming />);
    expect(screen.getByTitle('Running')).toBeInTheDocument();
  });

  it('prefers a registered custom renderer over the built-in family card', () => {
    registerToolRenderer('Bash', (props) => <div data-testid="custom">{props.name}:{props.status}</div>);
    render(<ToolCard use={{ kind: 'tool_use', id: 't4', name: 'Bash', input: { command: 'x' } }} runSucceeded />);
    expect(screen.getByTestId('custom')).toHaveTextContent('Bash:complete');
  });

  it('renders TodoWrite input as a TodoCard', () => {
    render(<ToolCard use={{ kind: 'tool_use', id: 't5', name: 'TodoWrite', input: { todos: [{ content: 'step 1', status: 'completed' }] } }} runSucceeded />);
    expect(screen.getByText('Todos')).toBeInTheDocument();
    expect(screen.getByText('1/1')).toBeInTheDocument();
  });

  it('falls back to the built-in family card when a custom renderer throws', () => {
    const err = new Error('boom');
    registerToolRenderer('Bash', () => {
      throw err;
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ToolCard use={{ kind: 'tool_use', id: 't6', name: 'Bash', input: { command: 'x' } }} runSucceeded />);
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('custom renderer for "Bash" threw'), err);
    spy.mockRestore();
  });

  describe('FileWriteCard', () => {
    it('renders file path, line count, and opens the detail accordion', async () => {
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/a/b/c.txt', content: 'one\ntwo\nthree' } }}
          result={{ kind: 'tool_result', toolUseId: 'w1', content: '', isError: false }}
        />,
      );
      expect(screen.getByText('Write')).toBeInTheDocument();
      expect(document.querySelector('.op-meta')?.textContent).toBe('c.txt · 3 lines');
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.op-path')?.textContent).toBe('/a/b/c.txt');
    });

    it('falls back to filePath/path and omits line count when content is missing', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'w2', name: 'write', input: { filePath: 'd.txt' } }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('d.txt');
    });

    it('handles create_file alias, no file path at all, and shows the shimmer while streaming with no result', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'w3', name: 'create_file', input: {} }} runStreaming />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('(unnamed)');
      expect(document.querySelector('.shimmer-text')).not.toBeNull();
    });

    it('shows the open-in-tab button and lifts the basename when clicked, gated by projectFileNames', async () => {
      const onRequestOpenFile = vi.fn();
      const { rerender } = render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'w4', name: 'Write', input: { file_path: '/x/y/known.txt' } }}
          runSucceeded
          onRequestOpenFile={onRequestOpenFile}
          projectFileNames={new Set(['other.txt'])}
        />,
      );
      await userEvent.click(screen.getByRole('button'));
      expect(screen.queryByRole('button', { name: /Open/ })).not.toBeInTheDocument();

      rerender(
        <ToolCard
          use={{ kind: 'tool_use', id: 'w4', name: 'Write', input: { file_path: '/x/y/known.txt' } }}
          runSucceeded
          onRequestOpenFile={onRequestOpenFile}
          projectFileNames={new Set(['known.txt'])}
        />,
      );
      const openButton = screen.getByRole('button', { name: 'Open' });
      await userEvent.click(openButton);
      expect(onRequestOpenFile).toHaveBeenCalledWith('known.txt');
    });

    it('omits the open-in-tab button when onRequestOpenFile is not provided, path is (unnamed), or basename is empty', async () => {
      const { rerender } = render(<ToolCard use={{ kind: 'tool_use', id: 'w5', name: 'Write', input: { file_path: '/a/b.txt' } }} runSucceeded />);
      await userEvent.click(screen.getByRole('button'));
      expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();

      const onRequestOpenFile = vi.fn();
      rerender(<ToolCard use={{ kind: 'tool_use', id: 'w5', name: 'Write', input: {} }} runSucceeded onRequestOpenFile={onRequestOpenFile} />);
      expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();

      rerender(<ToolCard use={{ kind: 'tool_use', id: 'w5', name: 'Write', input: { file_path: '/a/' } }} runSucceeded onRequestOpenFile={onRequestOpenFile} />);
      expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    });

    it('shows the error detail block when the write result is an error with content', () => {
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'w6', name: 'Write', input: { file_path: '/a.txt' } }}
          result={{ kind: 'tool_result', toolUseId: 'w6', content: 'disk full', isError: true }}
        />,
      );
      expect(document.querySelector('.op-output')?.textContent).toBe('disk full');
    });

    it('defaults to an empty input object when input is null/undefined', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'w7', name: 'Write', input: null }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('(unnamed)');
    });

    it('falls back through the path field when file_path/filePath are absent', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'w8', name: 'Write', input: { path: '/z/only-path.txt' } }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('only-path.txt');
    });

    it('hides the open-in-tab button when file_path is an explicit empty string', () => {
      const onRequestOpenFile = vi.fn();
      render(<ToolCard use={{ kind: 'tool_use', id: 'w9', name: 'Write', input: { file_path: '' } }} runSucceeded onRequestOpenFile={onRequestOpenFile} />);
      expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    });
  });

  describe('FileEditCard', () => {
    it('renders singular "change" for one edit and pluralizes for many, using path fallback', async () => {
      const { rerender } = render(
        <ToolCard use={{ kind: 'tool_use', id: 'e1', name: 'Edit', input: { path: '/f/g.txt', edits: [{ old_string: 'a', new_string: 'b' }] } }} runSucceeded />,
      );
      expect(screen.getByText(/1 change$/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button'));
      expect(screen.getByText('/f/g.txt')).toBeInTheDocument();

      rerender(
        <ToolCard
          use={{
            kind: 'tool_use',
            id: 'e1',
            name: 'str_replace_edit',
            input: { path: '/f/g.txt', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] },
          }}
          runSucceeded
        />,
      );
      expect(screen.getByText(/2 changes$/)).toBeInTheDocument();
    });

    it('defaults edit count to 1 when edits is not an array', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'e2', name: 'Edit', input: { file_path: '/h.txt' } }} runStreaming />);
      expect(screen.getByText(/1 change$/)).toBeInTheDocument();
      expect(document.querySelector('.shimmer-text')).not.toBeNull();
    });

    it('defaults to an empty input object when input is null/undefined', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'e3', name: 'Edit', input: undefined }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('(unnamed) · 1 change');
    });

    it('falls back through filePath when file_path/path are absent', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'e4', name: 'Edit', input: { filePath: '/only/filePath.txt' } }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('filePath.txt · 1 change');
    });
  });

  describe('FileReadCard', () => {
    it('renders the read file basename and opens to show the full path', async () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/p/q/file.md' } }} result={{ kind: 'tool_result', toolUseId: 'r1', content: 'text', isError: false }} />);
      expect(screen.getByText('file.md')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button'));
      expect(screen.getByText('/p/q/file.md')).toBeInTheDocument();
    });

    it('supports the read_file alias and the (unnamed) fallback', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'r2', name: 'read_file', input: {} }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('(unnamed)');
    });

    it('defaults to an empty input object when input is null, and falls back through filePath', () => {
      const { rerender } = render(<ToolCard use={{ kind: 'tool_use', id: 'r3', name: 'Read', input: null }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('(unnamed)');

      rerender(<ToolCard use={{ kind: 'tool_use', id: 'r3', name: 'Read', input: { filePath: '/only/filePath.md' } }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('filePath.md');
    });

    it('shows the shimmer title while streaming with no result yet', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'r4', name: 'Read', input: { file_path: '/a.txt' } }} runStreaming />);
      expect(document.querySelector('.shimmer-text')).not.toBeNull();
    });
  });

  describe('BashCard', () => {
    it('defaults to an empty command and hides the description when absent', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'b1', name: 'Bash', input: undefined }} runSucceeded />);
      expect(screen.getByText('Bash')).toBeInTheDocument();
      expect(document.querySelector('.op-desc')).toBeNull();
    });

    it('shows the description when provided', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'ls', description: 'list files' } }} runSucceeded />);
      expect(screen.getByText('list files')).toBeInTheDocument();
    });

    it('truncates a very long command and output', async () => {
      const longCommand = 'x'.repeat(500);
      const longOutput = 'y'.repeat(5000);
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'b3', name: 'Bash', input: { command: longCommand } }}
          result={{ kind: 'tool_result', toolUseId: 'b3', content: longOutput, isError: false }}
        />,
      );
      await userEvent.click(screen.getByRole('button'));
      const commandEl = document.querySelector('.op-command');
      const outputEl = document.querySelector('.op-output');
      expect(commandEl?.textContent).toHaveLength(400);
      expect(commandEl?.textContent?.endsWith('…')).toBe(true);
      expect(outputEl?.textContent).toHaveLength(4000);
    });

    it('omits the output block when the result has no content', async () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'b4', name: 'Bash', input: { command: 'ls' } }} result={{ kind: 'tool_result', toolUseId: 'b4', content: '', isError: false }} />);
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.op-output')).toBeNull();
    });

    it('shows the shimmer title while streaming with no result yet', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'b5', name: 'Bash', input: { command: 'ls' } }} runStreaming />);
      expect(document.querySelector('.shimmer-text')).not.toBeNull();
    });
  });

  describe('GlobCard', () => {
    it('defaults the pattern to "*" and omits the path suffix when absent', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'g1', name: 'Glob', input: {} }} runSucceeded />);
      expect(screen.getByText('Search files')).toBeInTheDocument();
      expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('renders the given pattern and path via the list_files alias', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'g2', name: 'list_files', input: { pattern: '*.ts', path: 'src' } }} runSucceeded />);
      expect(screen.getByText('*.ts in src')).toBeInTheDocument();
    });

    it('defaults to an empty input object when input is null', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'g3', name: 'Glob', input: null }} runSucceeded />);
      expect(screen.getByText('*')).toBeInTheDocument();
    });
  });

  describe('GrepCard', () => {
    it('defaults the pattern to empty and omits the path suffix when absent', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'gr1', name: 'Grep', input: {} }} runSucceeded />);
      expect(screen.getByText('Search content')).toBeInTheDocument();
    });

    it('renders the given pattern and path', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'gr2', name: 'Grep', input: { pattern: 'TODO', path: 'src' } }} runSucceeded />);
      expect(screen.getByText('TODO in src')).toBeInTheDocument();
    });

    it('defaults to an empty input object when input is undefined', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'gr3', name: 'Grep', input: undefined }} runSucceeded />);
      expect(screen.getByText('Search content')).toBeInTheDocument();
    });
  });

  describe('WebFetchCard', () => {
    it('defaults url to empty', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'wf1', name: 'WebFetch', input: {} }} runSucceeded />);
      expect(screen.getByText('Fetch')).toBeInTheDocument();
    });

    it('renders the given url via the web_fetch alias', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'wf2', name: 'web_fetch', input: { url: 'https://example.test' } }} runSucceeded />);
      expect(screen.getByText('https://example.test')).toBeInTheDocument();
    });

    it('defaults to an empty input object when input is null', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'wf3', name: 'WebFetch', input: null }} runSucceeded />);
      expect(screen.getByText('Fetch')).toBeInTheDocument();
    });
  });

  describe('WebSearchCard', () => {
    it('defaults query to empty', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'ws1', name: 'WebSearch', input: {} }} runSucceeded />);
      expect(screen.getByText('Search')).toBeInTheDocument();
    });

    it('renders the given query via the web_search alias', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'ws2', name: 'web_search', input: { query: 'hello world' } }} runSucceeded />);
      expect(screen.getByText('hello world')).toBeInTheDocument();
    });

    it('defaults to an empty input object when input is null', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'ws3', name: 'WebSearch', input: null }} runSucceeded />);
      expect(screen.getByText('Search')).toBeInTheDocument();
    });
  });

  describe('GenericCard / describeInput / truncate', () => {
    it('renders nothing extra when input is null/undefined', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'gen1', name: 'Mystery', input: null }} runSucceeded />);
      expect(screen.getByText('Mystery')).toBeInTheDocument();
      expect(document.querySelector('.op-meta')).toBeNull();
    });

    it('uses a plain string input verbatim', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'gen1b', name: 'Mystery', input: 'raw string input' }} runSucceeded />);
      expect(screen.getByText('raw string input')).toBeInTheDocument();
    });

    it('stringifies a non-object, non-string input', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'gen2', name: 'Mystery', input: 42 }} runSucceeded />);
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('falls back to JSON.stringify when no known key matches', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'gen3', name: 'Mystery', input: { foo: 'bar' } }} runSucceeded />);
      expect(screen.getByText('{"foo":"bar"}')).toBeInTheDocument();
    });

    it('returns an empty description when JSON.stringify throws on a circular object', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      render(<ToolCard use={{ kind: 'tool_use', id: 'gen4', name: 'Mystery', input: circular }} runSucceeded />);
      expect(screen.getByText('Mystery')).toBeInTheDocument();
      expect(document.querySelector('.op-meta')).toBeNull();
    });

    it('truncates a long generic summary to 200 chars', () => {
      const longQuery = 'z'.repeat(250);
      render(<ToolCard use={{ kind: 'tool_use', id: 'gen5', name: 'Mystery', input: { query: longQuery } }} runSucceeded />);
      const meta = document.querySelector('.op-meta');
      expect(meta?.textContent).toHaveLength(200);
      expect(meta?.textContent?.endsWith('…')).toBe(true);
    });
  });

  describe('ResultBadge', () => {
    it('shows an error badge when there is no result and the run did not succeed', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'rb1', name: 'CustomTool', input: {} }} />);
      expect(screen.getByTitle('Error')).toBeInTheDocument();
    });

    it('shows an error badge with the result content as the title when the result errored', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'rb2', name: 'CustomTool', input: {} }} result={{ kind: 'tool_result', toolUseId: 'rb2', content: 'bad things happened', isError: true }} />);
      expect(screen.getByTitle('bad things happened')).toBeInTheDocument();
    });

    it('falls back to the generic error title when an error result has empty content', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'rb3', name: 'CustomTool', input: {} }} result={{ kind: 'tool_result', toolUseId: 'rb3', content: '', isError: true }} />);
      expect(screen.getByTitle('Error')).toBeInTheDocument();
    });

    it('shows a done badge for a successful non-error result', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'rb4', name: 'CustomTool', input: {} }} result={{ kind: 'tool_result', toolUseId: 'rb4', content: 'ok', isError: false }} runSucceeded />);
      expect(screen.getByTitle('Done')).toBeInTheDocument();
    });
  });

  describe('FileErrorDetail', () => {
    it('renders nothing when the error result content is whitespace-only', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'fe1', name: 'Write', input: { file_path: '/a.txt' } }} result={{ kind: 'tool_result', toolUseId: 'fe1', content: '   ', isError: true }} />);
      expect(document.querySelector('.op-output')).toBeNull();
    });
  });

  describe('DelegatedToolCard (canonical Jini tool ids and the execute_delegated_tool wrapper)', () => {
    it('renders a canonical page.fill event as "Tool call · Page Fill" with the element as the target', async () => {
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'd1', name: 'page.fill', input: { element: 'signup-name-input', text: 'Ada Lovelace' } }}
          result={{ kind: 'tool_result', toolUseId: 'd1', content: '{"filled":"signup-name-input"}', isError: false }}
        />,
      );
      expect(screen.getByText(/Tool call/)).toBeInTheDocument();
      expect(screen.getByText('Page Fill', { exact: false })).toBeInTheDocument();
      expect(document.querySelector('.op-meta')?.textContent).toBe('signup-name-input');
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.op-command')?.textContent).toContain('signup-name-input');
    });

    it('humanizes a multi-segment tool id: daemon.db.vacuum -> Daemon Db Vacuum', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'd2', name: 'daemon.db.vacuum', input: {} }} runSucceeded />);
      expect(screen.getByText('Daemon Db Vacuum', { exact: false })).toBeInTheDocument();
    });

    it('suppresses the raw execute_delegated_tool wrapper row when it succeeded — the canonical page.fill row already exists', () => {
      const { container } = render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'w1', name: 'execute_delegated_tool', input: { toolId: 'page.fill', input: { element: 'x', text: 'y' } } }}
          result={{ kind: 'tool_result', toolUseId: 'w1', content: 'ok', isError: false }}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('also suppresses the mcp__jini__-prefixed wrapper name on success', () => {
      const { container } = render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'w1b', name: 'mcp__jini__execute_delegated_tool', input: { toolId: 'page.click', input: { element: 'x' } } }}
          result={{ kind: 'tool_result', toolUseId: 'w1b', content: 'ok', isError: false }}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('does NOT suppress a failed wrapper call — it has no canonical row to fall back on, so hiding it would hide a real error', () => {
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'w2', name: 'execute_delegated_tool', input: { toolId: 'page.fill', input: { element: 'x', text: 'y' } } }}
          result={{ kind: 'tool_result', toolUseId: 'w2', content: 'ToolExecutor: unknown tool "page.fill"', isError: true }}
        />,
      );
      expect(screen.getByText(/Tool call/)).toBeInTheDocument();
      expect(screen.getByText('Page Fill', { exact: false })).toBeInTheDocument();
    });

    it('does NOT suppress a still-pending wrapper call (no result yet)', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'w3', name: 'execute_delegated_tool', input: { toolId: 'page.navigate', input: { page: 'signup-form' } } }} runStreaming />);
      expect(screen.getByText(/Tool call/)).toBeInTheDocument();
      expect(screen.getByText('Page Navigate', { exact: false })).toBeInTheDocument();
    });

    it('recovers the real tool id and args from an unsuppressed (failed) wrapper, not the wrapper name itself', async () => {
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'w4', name: 'execute_delegated_tool', input: { toolId: 'daemon.db.vacuum', input: {} } }}
          result={{ kind: 'tool_result', toolUseId: 'w4', content: 'denied', isError: true }}
        />,
      );
      expect(screen.getByText('Daemon Db Vacuum', { exact: false })).toBeInTheDocument();
      expect(screen.queryByText('Execute Delegated Tool', { exact: false })).not.toBeInTheDocument();
    });

    it('does not treat an ordinary vendor tool name (e.g. Bash) as a Jini tool id', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'v1', name: 'Bash', input: { command: 'ls' } }} runSucceeded />);
      expect(screen.queryByText(/Tool call/)).not.toBeInTheDocument();
    });

    it('keeps the wrapper name as the title when a failed wrapper carries no toolId to recover', () => {
      // A transport-level failure can arrive before the wrapper's own arguments were understood, so
      // there is no real tool id to show. Falling back to the wrapper name beats an empty title.
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'w5', name: 'execute_delegated_tool', input: {} }}
          result={{ kind: 'tool_result', toolUseId: 'w5', content: 'malformed request', isError: true }}
        />,
      );
      expect(screen.getByText('Execute Delegated Tool', { exact: false })).toBeInTheDocument();
    });

    it('renders a canonical tool call with no input at all, showing an empty argument object', async () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'd3', name: 'page.reload', input: null }} runSucceeded />);
      expect(screen.getByText('Page Reload', { exact: false })).toBeInTheDocument();
      expect(document.querySelector('.op-meta')).toBeNull();
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.op-command')?.textContent).toBe('{}');
    });

    it('shows no target for a non-object input, rather than stringifying it into the summary', () => {
      // `primaryTarget` only ever surfaces a *named* argument; a bare scalar has no name to show.
      render(<ToolCard use={{ kind: 'tool_use', id: 'd4', name: 'page.snapshot', input: 'agent-lab' }} runSucceeded />);
      expect(document.querySelector('.op-meta')).toBeNull();
    });

    it('falls back to the first string-valued argument as the target when no conventional key is present', () => {
      // `page.*` tools name their target `element`/`page`/`handle`, but a host-registered tool need
      // not — showing *something* identifying beats a bare "Tool call" row.
      render(<ToolCard use={{ kind: 'tool_use', id: 'd5', name: 'forms.submit', input: { attempts: 2, form_name: 'signup' } }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('signup');
    });

    it('humanizes a tool id containing a doubled underscore without crashing on the empty word', () => {
      // `page.fill__legacy` is a legal Jini tool id, and splitting on `_` yields an empty segment
      // between the two underscores — capitalizing that would read index 0 of an empty string.
      render(<ToolCard use={{ kind: 'tool_use', id: 'd6', name: 'page.fill__legacy', input: {} }} runSucceeded />);
      // The empty word between the two underscores contributes nothing, leaving a doubled space
      // that testing-library normalizes away — the point is that the row renders at all.
      expect(document.querySelector('.op-title')?.textContent).toContain('Page Fill  Legacy');
    });
  });

  describe('SearchToolsCard / DescribeToolCard', () => {
    it('renders search_tools with the query as the collapsed summary', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 's1', name: 'search_tools', input: { query: 'page fill form field' } }} runSucceeded />);
      expect(screen.getByText('Search tools')).toBeInTheDocument();
      expect(screen.getByText('page fill form field')).toBeInTheDocument();
    });

    it('renders the mcp__jini__-prefixed search_tools name too', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 's2', name: 'mcp__jini__search_tools', input: { query: 'navigate' } }} runSucceeded />);
      expect(screen.getByText('Search tools')).toBeInTheDocument();
    });

    it('renders the mcp__jini__-prefixed describe_tool name too', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 's3b', name: 'mcp__jini__describe_tool', input: { id: 'page.click' } }} runSucceeded />);
      expect(screen.getByText('Describe tool')).toBeInTheDocument();
      expect(screen.getByText('page.click')).toBeInTheDocument();
    });

    it('renders describe_tool with the tool id as the collapsed summary', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 's3', name: 'describe_tool', input: { id: 'page.fill' } }} runSucceeded />);
      expect(screen.getByText('Describe tool')).toBeInTheDocument();
      expect(screen.getByText('page.fill')).toBeInTheDocument();
    });

    it('opens the search_tools accordion to reveal the matched-tool listing the agent received', async () => {
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 's4', name: 'search_tools', input: { query: 'fill', limit: 5 } }}
          result={{ kind: 'tool_result', toolUseId: 's4', content: 'page.fill — Type text into a field', isError: false }}
        />,
      );
      // Collapsed by default: the output exists in the DOM but the accordion is closed.
      expect(document.querySelector('.accordion-collapsible.open')).toBeNull();
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.accordion-collapsible.open')).not.toBeNull();
      expect(document.querySelector('.op-output')?.textContent).toBe('page.fill — Type text into a field');
    });

    it('omits the search_tools output block entirely when the result carried no content', () => {
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 's5', name: 'search_tools', input: { query: 'nothing matches' } }}
          result={{ kind: 'tool_result', toolUseId: 's5', content: '', isError: false }}
        />,
      );
      expect(document.querySelector('.op-output')).toBeNull();
    });

    it('shows the search_tools shimmer title while the catalog query is still running', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 's6', name: 'search_tools', input: { query: 'fill' } }} runStreaming />);
      expect(document.querySelector('.op-title.shimmer-text')).not.toBeNull();
    });

    it('renders search_tools with no query and no input object at all', () => {
      // The catalog tool has a required `query`, but a malformed agent call can omit it — the card
      // must still render a titled row rather than crash or show an empty meta chip.
      render(<ToolCard use={{ kind: 'tool_use', id: 's7', name: 'search_tools', input: null }} runSucceeded />);
      expect(screen.getByText('Search tools')).toBeInTheDocument();
      expect(document.querySelector('.op-meta')).toBeNull();
    });

    it('opens the describe_tool accordion to reveal the returned tool schema', async () => {
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 's8', name: 'describe_tool', input: { id: 'page.fill' } }}
          result={{ kind: 'tool_result', toolUseId: 's8', content: '{"inputSchema":{"type":"object"}}', isError: false }}
        />,
      );
      expect(document.querySelector('.accordion-collapsible.open')).toBeNull();
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.accordion-collapsible.open')).not.toBeNull();
      expect(document.querySelector('.op-output')?.textContent).toBe('{"inputSchema":{"type":"object"}}');
    });

    it('omits the describe_tool output block entirely when the result carried no content', () => {
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 's9', name: 'describe_tool', input: { id: 'page.fill' } }}
          result={{ kind: 'tool_result', toolUseId: 's9', content: '', isError: false }}
        />,
      );
      expect(document.querySelector('.op-output')).toBeNull();
    });

    it('shows the describe_tool shimmer title while the lookup is still running', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 's10', name: 'describe_tool', input: { id: 'page.fill' } }} runStreaming />);
      expect(document.querySelector('.op-title.shimmer-text')).not.toBeNull();
    });

    it('renders describe_tool with no id and no input object at all', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 's11', name: 'describe_tool', input: null }} runSucceeded />);
      expect(screen.getByText('Describe tool')).toBeInTheDocument();
      expect(document.querySelector('.op-meta')).toBeNull();
    });

    it('surfaces a describe_tool error result as an error detail block, not a silent failure', () => {
      // The §29.4 schema-on-error path: an agent that asked about an unknown id must see why.
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 's12', name: 'describe_tool', input: { id: 'page.nope' } }}
          result={{ kind: 'tool_result', toolUseId: 's12', content: 'unknown tool "page.nope"', isError: true }}
        />,
      );
      // Two blocks carry it: the always-mounted (collapsed) accordion output, plus the
      // FileErrorDetail block that is visible without expanding anything.
      expect(document.querySelectorAll('.op-output')).toHaveLength(2);
      expect(document.querySelector('.op-card')?.lastElementChild?.textContent).toBe('unknown tool "page.nope"');
    });
  });
});
