import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from '../Markdown.js';
import { CHAT_PANE_STYLES } from '../../features/chat-pane/styles.js';

/**
 * @file jsdom implements no real layout engine — `scrollWidth`/`clientWidth`/`ResizeObserver` are
 * either always 0 or entirely absent — so the wide-table pop-out tests below fake `ResizeObserver`
 * and stub the measured element's box metrics directly, the same "control the inputs, assert the
 * derived state" approach a downstream admin host's own overflow-detection hook test uses for the
 * identical jsdom gap (this package cannot import that test helper — it lives downstream — so the
 * technique is duplicated here, not the code under test).
 */
type ResizeCallback = () => void;

function installFakeResizeObserver(): { trigger: () => void } {
  let callback: ResizeCallback = () => {};
  class FakeResizeObserver {
    constructor(cb: ResizeCallback) {
      callback = cb;
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return { trigger: () => callback() };
}

function stubBoxWidth(el: Element, metrics: { scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(el, 'scrollWidth', { value: metrics.scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: metrics.clientWidth, configurable: true });
}

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

  describe('GFM pipe tables', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('renders a pipe table as a real <table> with header and body cells, not literal pipe text', () => {
      const { container } = render(
        <Markdown>{'| Var | Why |\n| --- | --- |\n| FOO | because |\n| BAR | also |'}</Markdown>,
      );
      // Regression: before table support, this rendered as one paragraph containing the literal
      // `|` characters — asserting the real DOM shape (not just text content) catches that.
      const table = container.querySelector('table');
      expect(table).toBeInTheDocument();
      expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Var', 'Why']);
      const rows = screen.getAllByRole('row');
      expect(rows).toHaveLength(3); // header + 2 body rows
      expect(container.textContent).not.toContain('|');
    });

    it('applies GFM column alignment from the separator row', () => {
      const { container } = render(<Markdown>{'| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |'}</Markdown>);
      const headers = container.querySelectorAll('th');
      expect(headers[0]).toHaveStyle({ textAlign: 'left' });
      expect(headers[1]).toHaveStyle({ textAlign: 'center' });
      expect(headers[2]).toHaveStyle({ textAlign: 'right' });
    });

    it('renders inline markup (bold) inside a table cell as real markup, not literal asterisks or a literal tag', () => {
      // Regression: the owner's screenshot showed `**Var**` inside a cell rendering as literal
      // text once the pipes themselves were fixed — cells must go through the same `renderInline`
      // pass every other block uses.
      render(<Markdown>{'| Var | Why |\n| --- | --- |\n| **FOO** | plain |'}</Markdown>);
      expect(screen.getByText('FOO', { selector: 'strong' })).toBeInTheDocument();
      expect(screen.queryByText('**FOO**')).not.toBeInTheDocument();
    });

    it('ends a preceding paragraph early when a table starts on the very next line with no blank-line separator', () => {
      render(<Markdown>{'a paragraph line\n| A | B |\n| --- | --- |\n| 1 | 2 |'}</Markdown>);
      expect(screen.getByText('a paragraph line')).toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('shows no "Expand table" affordance when the table fits its own box', () => {
      installFakeResizeObserver();
      render(<Markdown>{'| A | B |\n| --- | --- |\n| 1 | 2 |'}</Markdown>);
      expect(screen.queryByRole('button', { name: 'Expand table' })).not.toBeInTheDocument();
    });

    it('shows an "Expand table" button once the table overflows its own box, and opens/closes a full-size copy in a dialog', () => {
      const { trigger } = installFakeResizeObserver();
      const { container } = render(<Markdown>{'| A | B |\n| --- | --- |\n| 1 | 2 |'}</Markdown>);

      const wrap = container.querySelector('.jini-md-table-wrap')!;
      stubBoxWidth(wrap, { scrollWidth: 1600, clientWidth: 379 });
      act(() => trigger());

      const expandButton = screen.getByRole('button', { name: 'Expand table' });
      fireEvent.click(expandButton);

      const dialog = container.querySelector('dialog.jini-md-table-modal')!;
      expect(dialog.hasAttribute('open')).toBe(true);
      // Two live <table> copies while open: the (scroll-clipped) inline one plus the modal's.
      expect(container.querySelectorAll('table')).toHaveLength(2);

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(container.querySelectorAll('table')).toHaveLength(1);
    });

    it('gives every table cell a floor width so content overflows its wrap instead of being crushed into vertical wrapping', () => {
      // Regression: '.jini-md-table' previously had no 'min-width' anywhere (table or cells), so
      // an auto-layout table always sized itself to fit '.jini-md-table-wrap' exactly — cell text
      // wrapped into an ever-taller column instead of the table ever exceeding its box, which is
      // why 'scrollWidth > clientWidth' (the check the tests above stub directly) could never
      // become true from real content: this asserts the actual stylesheet rule that makes it true.
      // jsdom has no layout engine (no real 'scrollWidth'/'clientWidth' from CSS), so this can only
      // assert the rule exists, not the resulting pixel geometry — that was verified separately in
      // a real browser (see this rule's own inline comment in styles.ts for the measured numbers).
      const cellRule = CHAT_PANE_STYLES.match(
        /\.jini-md-table th,\s*\n\.jini-md-table td \{([^}]*)\}/,
      )?.[1] ?? '';
      expect(cellRule).toMatch(/min-width:\s*\d+px/);
    });
  });

  describe('fenced code block copy button', () => {
    // jsdom does not implement the Clipboard API, so each test that exercises the primary
    // (secure-context) path installs its own `navigator.clipboard` stub and removes it afterward —
    // same convention MessageRow.test.tsx's own per-message copy tests use for the identical gap.
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'clipboard');
      vi.restoreAllMocks();
    });

    it('renders a "Copy code" button on a fenced block', () => {
      render(<Markdown>{'```ts\nconst x = 1;\n```'}</Markdown>);
      expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    });

    it('copies the fenced block’s exact raw source, not a DOM/innerText read', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      // Leading whitespace on the second line is the load-bearing part of this fixture: a
      // DOM/innerText-based copy is exactly the kind of thing that can silently collapse or
      // normalize that whitespace, where reading the parsed block body verbatim cannot.
      const source = 'function f() {\n  return 1;\n}';
      render(<Markdown>{'```js\n' + source + '\n```'}</Markdown>);

      await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));
      expect(writeText).toHaveBeenCalledWith(source);
    });

    it('announces the copied state via icon swap and a polite live region, same pattern as the per-message copy button', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      render(<Markdown>{'```\nplain\n```'}</Markdown>);

      await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
      expect(screen.getByText('Copied to clipboard')).toBeInTheDocument();
    });

    it('does not render a copy button for inline code spans, only fenced blocks', () => {
      render(<Markdown>{'run `npm test` to check'}</Markdown>);
      expect(screen.queryByRole('button', { name: 'Copy code' })).not.toBeInTheDocument();
    });
  });
});
