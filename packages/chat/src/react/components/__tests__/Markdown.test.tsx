import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../Markdown.js';

describe('Markdown', () => {
  it('renders headings, paragraphs, and inline emphasis', () => {
    render(<Markdown>{'# Title\n\nSome **bold** and *italic* text.'}</Markdown>);
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('bold', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('italic', { selector: 'em' })).toBeInTheDocument();
  });

  it('renders fenced code blocks verbatim without inline-parsing their contents', () => {
    render(<Markdown>{'```ts\nconst x = 1;\n```'}</Markdown>);
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('renders unordered and ordered lists', () => {
    render(<Markdown>{'- first\n- second\n\n1. one\n2. two'}</Markdown>);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('renders bare autolinks as anchors', () => {
    render(<Markdown>{'see https://example.com/docs for more'}</Markdown>);
    const link = screen.getByRole('link', { name: 'https://example.com/docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
  });

  it('renders a blockquote and a horizontal rule', () => {
    const { container } = render(<Markdown>{'> quoted line\n\n---\n\nafter'}</Markdown>);
    expect(container.querySelector('blockquote')).toHaveTextContent('quoted line');
    expect(container.querySelector('hr')).toBeInTheDocument();
  });

  it('renders an unlabeled fenced code block with no data-lang', () => {
    const { container } = render(<Markdown>{'```\nplain\n```'}</Markdown>);
    const code = container.querySelector('code');
    expect(code).not.toHaveAttribute('data-lang');
    expect(code).toHaveTextContent('plain');
  });

  it('renders an unterminated fenced code block (no closing fence) verbatim to end of input', () => {
    render(<Markdown>{'```ts\nconst x = 1;'}</Markdown>);
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('renders a blockquote that runs to the very end of input with no trailing block', () => {
    const { container } = render(<Markdown>{'> only a quote'}</Markdown>);
    expect(container.querySelector('blockquote')).toHaveTextContent('only a quote');
  });

  it('renders an unordered list that runs to the very end of input with no trailing block', () => {
    render(<Markdown>{'- solo item'}</Markdown>);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('renders an ordered list followed by more content (list ends via a non-matching line, not end-of-input)', () => {
    render(<Markdown>{'1. one\n2. two\n\nafter the list'}</Markdown>);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('after the list')).toBeInTheDocument();
  });

  it('ends a paragraph early when a new block starts on the very next line with no blank-line separator', () => {
    render(<Markdown>{'a paragraph line\n# Heading right after'}</Markdown>);
    expect(screen.getByRole('heading', { level: 1, name: 'Heading right after' })).toBeInTheDocument();
    expect(screen.getByText('a paragraph line')).toBeInTheDocument();
  });

  it('renders inline code spans inside a paragraph', () => {
    render(<Markdown>{'run `npm test` to check'}</Markdown>);
    expect(screen.getByText('npm test', { selector: 'code' })).toBeInTheDocument();
  });
});
