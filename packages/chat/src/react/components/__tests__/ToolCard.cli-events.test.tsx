import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolCard } from '../ToolCard.js';
import { AGY_READ, AGY_OUTPUT_READ, AGY_SEARCH, AGY_DESCRIBE, AGY_CHECK, AGY_GATEWAY, CODEX_BATCH, CLAUDE_DIRECT } from '../../../core/__tests__/fixtures/cli-tool-events.js';

describe('saved CLI tool receipts', () => {
  it.each([
    [AGY_READ, 'search_tools.json'],
    [AGY_OUTPUT_READ, 'output.txt'],
  ] as const)('names Antigravity read $id by its file', (use, file) => {
    render(<ToolCard use={use} runSucceeded />);
    expect(screen.getByRole('button', { name: `Read ${file}` })).toBeInTheDocument();
    expect(screen.queryByText('(unnamed)')).not.toBeInTheDocument();
  });

  it.each([
    [AGY_SEARCH, /^Search tools .*create a new blog post/],
    [AGY_DESCRIBE, /^Describe tool content_post_create$/],
    [AGY_CHECK, /^Tool call · Check Messages$/],
  ] as const)('names unbridged Antigravity wrapper $id by the inner tool', (use, name) => {
    render(<ToolCard use={use} runSucceeded />);
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.queryByText('Call Mcp Tool')).not.toBeInTheDocument();
  });

  it('keeps a successful unbridged gateway visible under the actual inner tool name', () => {
    render(<ToolCard use={AGY_GATEWAY} result={{ kind: 'tool_result', toolUseId: AGY_GATEWAY.id, content: '', isError: false }} />);
    expect(screen.getByRole('button', { name: 'Tool call · Content Post Create qa check gemini' })).toBeInTheDocument();
  });

  it('names the file inside a saved Codex batch', () => {
    render(<ToolCard use={CODEX_BATCH} runSucceeded />);
    expect(screen.getByRole('button', { name: 'Tool call · Theme Read File render/pages/index.html' })).toBeInTheDocument();
  });

  it.each(['mcp__jini__theme_list_files', 'theme_list_files'])('announces Tool call exactly once for Claude %s', name => {
    render(<ToolCard use={{ ...CLAUDE_DIRECT, name }} runSucceeded />);
    expect(screen.getByRole('button', { name: 'Tool call · Theme List Files' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tool call.*Tool call/ })).not.toBeInTheDocument();
  });

  // Some accessibility trees (Claude in Chrome's, which chat-qa-1 read on 11-01) name a child span by
  // its `title` before its text; a title repeating the visually hidden prefix then announces
  // "Tool call · Tool call · …". Model that reading: each head child by title, else text.
  it.each(['mcp__jini__fs_list_files', 'fs_list_files'])('says Tool call once even when a child title replaces its text: %s', name => {
    render(<ToolCard use={{ kind: 'tool_use', id: name, name, input: { root: 'site' } }} runSucceeded />);
    const head = screen.getByRole('button', { name: /Fs List Files/ });
    const titleFirst = [...head.children].map(child => child.getAttribute('title') ?? child.textContent ?? '').join(' ');
    expect(titleFirst.match(/Tool call/g)).toHaveLength(1);
  });
});
