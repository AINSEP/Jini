import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolCard } from '../ToolCard.js';

describe('tool targets for batches across CLIs', () => {
  it.each(['theme_read_file', 'content_post_create', 'custom_batch'])('summarizes %s by the first target and remaining count', name => {
    render(<ToolCard use={{ kind: 'tool_use', id: name, name,
      input: { items: [{ path: 'index.html' }, { path: 'about.html' }, { path: 'contact.html' }] } }} runSucceeded />);
    expect(screen.getByRole('button', { name: /index.html \+2$/ })).toBeInTheDocument();
  });

  it.each([
    { records: [{ title: 'First' }, { title: 'Second' }] },
    [{ title: 'First' }, { title: 'Second' }],
  ])('supports named arrays and direct arrays: %j', input => {
    render(<ToolCard use={{ kind: 'tool_use', id: 'batch', name: 'batch', input }} runSucceeded />);
    expect(screen.getByRole('button', { name: /First \+1$/ })).toBeInTheDocument();
  });

  it('shows a count when no batch member carries a readable target', () => {
    render(<ToolCard use={{ kind: 'tool_use', id: 'batch', name: 'batch', input: { items: [{}, {}, {}] } }} runSucceeded />);
    expect(screen.getByRole('button', { name: /3 items$/ })).toBeInTheDocument();
  });

  it('keeps empty batches and normal calls readable without descending into document bodies', () => {
    render(<ToolCard use={{ kind: 'tool_use', id: 'normal', name: 'custom_batch',
      input: { title: 'Normal', items: [], body: { content: [{ title: 'nested' }] } } }} runSucceeded />);
    expect(screen.getByRole('button', { name: /Normal$/ })).toBeInTheDocument();
  });

  it('lets the record name a single-record result returned win over an incidental array argument', () => {
    render(<ToolCard use={{ kind: 'tool_use', id: 'tagged', name: 'content_post_update',
      input: { id: '30127d31-0000-4000-8000-000000000000', tags: ['hero', 'dark'] } }}
      result={{ kind: 'tool_result', toolUseId: 'tagged', content: '{"post":{"title":"Spring Menu"}}', isError: false }} runSucceeded />);
    expect(screen.getByRole('button', { name: /Spring Menu$/ })).toBeInTheDocument();
  });
});


it.each([0, 10, 65536])('distinguishes collapsed file reads at offset %s', offset => {
  render(<ToolCard use={{ kind: 'tool_use', id: `read-${offset}`, name: 'Read', input: { file_path: '/site/index.html', offset } }} runSucceeded />);
  expect(screen.getByRole('button').textContent).toContain(`index.html (offset ${offset})`);
});

it('distinguishes generic theme reads with the full path and offset', () => {
  render(<ToolCard use={{ kind: 'tool_use', id: 'theme-read', name: 'theme_read_file', input: { path: 'templates/index.html', offset: 42 } }} runSucceeded />);
  expect(screen.getByRole('button').textContent).toContain('templates/index.html (offset 42)');
});


it('keeps an opaque-looking file basename visible in specialized read cards', () => {
  render(<ToolCard use={{ kind: 'tool_use', id: 'hash-file', name: 'Read', input: { file_path: '/site/0123456789abcdef', offset: 10 } }} runSucceeded />);
  expect(screen.getByRole('button').textContent).toContain('0123456789abcdef (offset 10)');
});


it.each([NaN, -1, 1.5, Infinity, '10', null])('ignores invalid read offset %s in the collapsed target', offset => {
  render(<ToolCard use={{ kind: 'tool_use', id: 'invalid-offset', name: 'Read', input: { file_path: '/site/index.html', offset } }} runSucceeded />);
  expect(screen.getByRole('button').textContent).toBe('Readindex.html');
});
