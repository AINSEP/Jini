import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { newTabLinkHref, useChatPaneNewTabLinks } from '../../hooks/useChatPaneNewTabLinks.hooks.js';

function Pane({ open, children }: { open: (url: string) => void; children: React.ReactNode }) {
  const onClickCapture = useChatPaneNewTabLinks({}, { openInNewTab: open });
  return (
    <section data-testid="pane" onClickCapture={onClickCapture}>
      {children}
    </section>
  );
}

function renderPane(children: React.ReactNode) {
  const open = vi.fn();
  // The outer bubble-phase cancel runs after the guard, so it changes nothing under test; it only
  // stops jsdom attempting (and logging) the default navigation of links the guard leaves alone.
  render(
    <div onClick={(event) => event.preventDefault()}>
      <Pane open={open}>{children}</Pane>
    </div>,
  );
  return open;
}

describe('useChatPaneNewTabLinks', () => {
  it('opens a same-origin link in a new tab instead of navigating the admin tab', () => {
    const open = renderPane(<a href="/admin/pages/x">edit</a>);
    const notCancelled = fireEvent.click(screen.getByText('edit'));
    expect(open).toHaveBeenCalledWith(`${window.location.origin}/admin/pages/x`);
    expect(notCancelled).toBe(false);
  });

  it('opens a link nested inside a card (click on a child of the anchor) in a new tab', () => {
    const open = renderPane(
      <div className="tool-card">
        <a href="https://example.com/doc"><span>docs</span></a>
      </div>,
    );
    fireEvent.click(screen.getByText('docs'));
    expect(open).toHaveBeenCalledWith('https://example.com/doc');
  });

  it('cancels the click so a router link handler (which honors defaultPrevented) does not also navigate', () => {
    const routerNavigate = vi.fn();
    const open = renderPane(
      <a
        href="/admin/posts"
        onClick={(event) => {
          if (!event.defaultPrevented) routerNavigate();
        }}
      >
        posts
      </a>,
    );
    fireEvent.click(screen.getByText('posts'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(routerNavigate).not.toHaveBeenCalled();
  });

  it('leaves hash anchors, downloads, role=button anchors, existing _blank links and non-web schemes to the browser', () => {
    const open = renderPane(
      <>
        <a href="#section">hash</a>
        <a href="/file.csv" download>download</a>
        <a href="/admin/x" role="button">action</a>
        <a href="https://example.com" target="_blank" rel="noopener noreferrer">already</a>
        <a href="mailto:a@example.com">mail</a>
        <button type="button">plain button</button>
      </>,
    );
    for (const label of ['hash', 'download', 'action', 'already', 'mail', 'plain button']) {
      fireEvent.click(screen.getByText(label));
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('leaves modified and non-primary clicks to the browser', () => {
    const open = renderPane(<a href="/admin/x">link</a>);
    fireEvent.click(screen.getByText('link'), { metaKey: true });
    fireEvent.click(screen.getByText('link'), { ctrlKey: true });
    fireEvent.click(screen.getByText('link'), { shiftKey: true });
    fireEvent.click(screen.getByText('link'), { button: 1 });
    expect(open).not.toHaveBeenCalled();
  });
});

describe('newTabLinkHref', () => {
  it('ignores an anchor that wraps the pane rather than sitting inside it', () => {
    const outer = document.createElement('a');
    outer.href = '/outside';
    const root = document.createElement('section');
    const inner = document.createElement('span');
    root.appendChild(inner);
    outer.appendChild(root);
    const event = new MouseEvent('click', { bubbles: true, button: 0 });
    Object.defineProperty(event, 'target', { value: inner });
    expect(newTabLinkHref({ event, root })).toBeNull();
  });

  it('ignores a click whose target is not an element, and one already cancelled', () => {
    const root = document.createElement('section');
    const text = document.createTextNode('t');
    root.appendChild(text);
    const textEvent = new MouseEvent('click', { button: 0 });
    Object.defineProperty(textEvent, 'target', { value: text });
    expect(newTabLinkHref({ event: textEvent, root })).toBeNull();

    const link = document.createElement('a');
    link.href = '/admin/x';
    root.appendChild(link);
    const cancelled = new MouseEvent('click', { button: 0, cancelable: true });
    cancelled.preventDefault();
    Object.defineProperty(cancelled, 'target', { value: link });
    expect(newTabLinkHref({ event: cancelled, root })).toBeNull();
  });
});
