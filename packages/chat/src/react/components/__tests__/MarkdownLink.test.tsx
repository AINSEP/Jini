import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownLink } from '../MarkdownLink.js';

/**
 * @file The one anchor the chat's markdown draws for a link. Owner decision 2026-11-21 (reverses
 * 2026-10-08): the owner's own site/admin navigates this tab from the link text, with a small icon
 * after it for a new tab; any other website opens a new tab; a `#` anchor stays in place.
 */
const translate = (key: string) => (key === 'Open in new tab' ? 'In neuem Tab öffnen' : key);
const useTHook = () => translate;

describe('MarkdownLink', () => {
  it('names the icon through the injected translator, not a fixed English string', () => {
    render(<MarkdownLink href="/admin/pages/x" useTHook={useTHook}>edit</MarkdownLink>);
    expect(screen.getByRole('link', { name: 'In neuem Tab öffnen' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'edit' })).not.toHaveAttribute('target');
  });

  it('gives the icon the same title so a mouse user sees what it does', () => {
    render(<MarkdownLink href="/admin/x" useTHook={useTHook}>x</MarkdownLink>);
    expect(screen.getByRole('link', { name: 'In neuem Tab öffnen' })).toHaveAttribute('title', 'In neuem Tab öffnen');
  });

  it('decides ownership against the injected origin', () => {
    render(
      <>
        <MarkdownLink href="https://mine.example.test/a" origin="https://mine.example.test" useTHook={useTHook}>mine</MarkdownLink>
        <MarkdownLink href="https://other.example.test/a" origin="https://mine.example.test" useTHook={useTHook}>other</MarkdownLink>
      </>,
    );
    expect(screen.getByRole('link', { name: 'mine' })).not.toHaveAttribute('target');
    expect(screen.getByRole('link', { name: 'other' })).toHaveAttribute('target', '_blank');
    expect(screen.getAllByRole('link', { name: 'In neuem Tab öffnen' })).toHaveLength(1);
  });
});
