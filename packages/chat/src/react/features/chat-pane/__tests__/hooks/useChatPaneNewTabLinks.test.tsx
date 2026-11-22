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
  // Owner 2026-11-21 (reverses 2026-10-08): the owner's own site/admin navigates this tab from the
  // link text (the admin's own link handler keeps the SPA and the chat dock in place), so the guard
  // must not pull it into a new tab. The markdown renderer draws a separate icon for a new tab.
  it('leaves a same-origin link to the browser so the admin navigates in place', () => {
    const open = renderPane(<a href="/admin/pages/x">edit</a>);
    fireEvent.click(screen.getByText('edit'));
    expect(open).not.toHaveBeenCalled();
  });

  it('leaves an absolute same-origin link to the browser too', () => {
    const open = renderPane(<a href={`${window.location.origin}/blog/hello`}>post</a>);
    fireEvent.click(screen.getByText('post'));
    expect(open).not.toHaveBeenCalled();
  });

  it('still opens another website in a new tab', () => {
    const open = renderPane(<a href="https://example.com/page">other</a>);
    fireEvent.click(screen.getByText('other'));
    expect(open).toHaveBeenCalledWith('https://example.com/page');
  });

  it('treats another port on this host as another website', () => {
    const open = renderPane(<a href="http://localhost:9/x">port</a>);
    fireEvent.click(screen.getByText('port'));
    expect(open).toHaveBeenCalledWith('http://localhost:9/x');
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
        href="https://example.com/posts"
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
    const open = renderPane(<a href="https://example.com/x">link</a>);
    fireEvent.click(screen.getByText('link'), { metaKey: true });
    fireEvent.click(screen.getByText('link'), { ctrlKey: true });
    fireEvent.click(screen.getByText('link'), { shiftKey: true });
    fireEvent.click(screen.getByText('link'), { button: 1 });
    expect(open).not.toHaveBeenCalled();
  });

  it('leaves an alt-click to the browser', () => {
    const open = renderPane(<a href="https://example.com/x">alt link</a>);
    fireEvent.click(screen.getByText('alt link'), { altKey: true });
    expect(open).not.toHaveBeenCalled();
  });

  it('opens an http: link in a new tab, not only https:', () => {
    const open = renderPane(<a href="http://example.com/plain">plain http</a>);
    fireEvent.click(screen.getByText('plain http'));
    expect(open).toHaveBeenCalledWith('http://example.com/plain');
  });

  it('defaults the opener to window.open with a new tab and no opener or referrer', () => {
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    function DefaultPane() {
      const onClickCapture = useChatPaneNewTabLinks();
      return (
        <section onClickCapture={onClickCapture}>
          <a href="https://example.com/default">default opener</a>
        </section>
      );
    }
    render(<DefaultPane />);
    fireEvent.click(screen.getByText('default opener'));
    expect(windowOpen).toHaveBeenCalledWith('https://example.com/default', '_blank', 'noopener,noreferrer');
    windowOpen.mockRestore();
  });
});

describe('newTabLinkHref', () => {
  it('ignores an anchor that wraps the pane rather than sitting inside it', () => {
    const outer = document.createElement('a');
    outer.href = 'https://example.com/outside';
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
    link.href = 'https://example.com/x';
    root.appendChild(link);
    const cancelled = new MouseEvent('click', { button: 0, cancelable: true });
    cancelled.preventDefault();
    Object.defineProperty(cancelled, 'target', { value: link });
    expect(newTabLinkHref({ event: cancelled, root })).toBeNull();
  });
});
