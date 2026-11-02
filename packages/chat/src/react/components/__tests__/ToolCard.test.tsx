import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { ToolCard } from '../ToolCard.js';
import { registerToolRenderer, clearToolRenderers } from '../../tool-renderer-registry.js';
import { formatToolOutputForDisplay } from '../../../core/tool-output.js';

vi.mock('../../../core/tool-output.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/tool-output.js')>();
  return { ...actual, formatToolOutputForDisplay: vi.fn(actual.formatToolOutputForDisplay) };
});

afterEach(() => clearToolRenderers({}));

describe('ToolCard', () => {
  it.each([
    ['null prototype', Object.create(null) as unknown],
    ['throwing coercion', { toString() { throw new Error('coercion failed'); } }],
  ])('renders the built-in tool card after a %s custom renderer throw', (_label, failure) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      registerToolRenderer({ name: 'Bash', renderer: () => { throw failure; } });
      const { container } = render(<ToolCard use={{ kind: 'tool_use', id: 'hostile', name: 'Bash', input: { command: 'echo survived' } }} runSucceeded />);
      expect(screen.getByText('Bash')).toBeInTheDocument();
      expect(container.textContent).toContain('echo survived');
    } finally { spy.mockRestore(); }
  });

  it('formats collapsed output once across new result envelopes and run states, then refreshes changed content', () => {
    const format = vi.mocked(formatToolOutputForDisplay).mockClear();
    const use = { kind: 'tool_use' as const, id: 'cached', name: 'CustomTool', input: {} };
    const result = { kind: 'tool_result' as const, toolUseId: use.id, content: '{"value":1}', isError: false };
    const { container, rerender } = render(<ToolCard use={use} result={result} runStreaming />);
    expect(format).toHaveBeenCalledTimes(1);
    rerender(<ToolCard use={{ ...use }} result={{ ...result }} runStreaming />);
    rerender(<ToolCard use={use} result={{ ...result }} runSucceeded />);
    expect(format).toHaveBeenCalledTimes(1);
    rerender(<ToolCard use={use} result={{ ...result, content: '{"value":2}' }} runSucceeded />);
    expect(format).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.op-card-reader-text')?.textContent).toContain('"value": 2');
  });

  it('refreshes the collapsed reader when input, empty-result error state, or missing-result run state changes', () => {
    const use = { kind: 'tool_use' as const, id: 'reader-state', name: 'CustomTool', input: { value: 1 } };
    const result = { kind: 'tool_result' as const, toolUseId: use.id, content: '', isError: false };
    const { container, rerender } = render(<ToolCard use={use} result={result} />);
    const reader = () => container.querySelector('.op-card-reader-text')?.textContent;
    expect(reader()).toContain('Finished with no output.');
    rerender(<ToolCard use={use} result={{ ...result, isError: true }} />);
    expect(reader()).toContain('Failed without an error message.');
    rerender(<ToolCard use={{ ...use, input: { value: 2 } }} result={{ ...result, isError: true }} />);
    expect(reader()).toContain('"value": 2');
    rerender(<ToolCard use={use} runStreaming />);
    expect(reader()).toContain('Waiting for the result or answer…');
    rerender(<ToolCard use={use} />);
    expect(reader()).toContain('The run ended before this call returned a result.');
    rerender(<ToolCard use={use} runSucceeded />);
    expect(reader()).toContain('No result was recorded for this call.');
  });

  it('renders a Bash card with the command and output', async () => {
    render(<ToolCard use={{ kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la' } }} result={{ kind: 'tool_result', toolUseId: 't1', content: 'a.txt\nb.txt', isError: false }} runSucceeded />);
    expect(screen.getByText('Bash')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('ls -la')).toBeInTheDocument();
    expect(document.querySelector('.op-output')?.textContent).toBe('a.txt\nb.txt');
  });

  it('tags every tool call for agent inspection with a handle unique to that call, regardless of which card variant renders', () => {
    const { container: bashContainer } = render(<ToolCard use={{ kind: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'ls' } }} runSucceeded />);
    const bashEl = bashContainer.querySelector('[data-agent-element="tool-call-call-1"]');
    expect(bashEl).toHaveAttribute('data-agent-role', 'region');
    expect(bashEl).toHaveAttribute('data-agent-label', 'A Bash tool call the AI made');
    // A collapsed row keeps its call's capped gist inside this same tagged element (the full panel
    // mounts only when opened) — `textContent` (what a `page.*` DOM reader actually uses) sees it
    // whether or not a human has clicked to expand the accordion.
    expect(bashEl?.textContent).toContain('ls');

    const { container: genericContainer } = render(<ToolCard use={{ kind: 'tool_use', id: 'call-2', name: 'CustomTool', input: {} }} runSucceeded />);
    const genericEl = genericContainer.querySelector('[data-agent-element="tool-call-call-2"]');
    expect(genericEl).toHaveAttribute('data-agent-role', 'region');
  });

  it('registers no wrapper element for a suppressed successful execute_delegated_tool wrapper call', () => {
    const { container } = render(
      <ToolCard use={{ kind: 'tool_use', id: 'call-3', name: 'execute_delegated_tool', input: { toolId: 'page.fill', input: {} } }} result={{ kind: 'tool_result', toolUseId: 'call-3', content: 'ok', isError: false }} runSucceeded />,
    );
    expect(container.querySelector('[data-agent-element="tool-call-call-3"]')).not.toBeInTheDocument();
  });

  // Owner bug 11-01: rows read "Content Post Update 30127d31-…" — a raw UUID where the post's name
  // should be. A row names its target by title/slug from the args or the result, else by its kind.
  describe('tool row target', () => {
    const UUID = '30127d31-4c2b-4e0a-9d1f-6b2a7c9e1f00';
    const row = (input: unknown, content = '') => render(
      <ToolCard use={{ kind: 'tool_use', id: 'tr', name: 'content_post_update', input }} result={content ? { kind: 'tool_result', toolUseId: 'tr', content, isError: false } : undefined} runSucceeded />,
    );

    it('prefers a human field from the args over an opaque id', () => {
      row({ id: UUID, kind: 'post', title: 'Spring menu' });
      expect(document.querySelector('.op-meta')?.textContent).toBe('Spring menu');
    });

    it('takes the title from the result when the args carry only an id', () => {
      row({ id: UUID, kind: 'post', status: 'published' }, JSON.stringify({ post: { id: UUID, title: 'Spring menu', slug: 'spring-menu' } }));
      expect(document.querySelector('.op-meta')?.textContent).toBe('Spring menu');
    });

    it.each([
      { error: { name: 'NotFoundError' } },
      { error: 'not found', title: 'Failure title' },
      { error: { name: 'NotFoundError' }, post: { title: 'Stale post' } },
      { isError: true, name: 'NotFoundError' },
      { status: 'failed', post: { title: 'Stale post' } },
      { success: false, name: 'NotFoundError' },
      // resultName also reads one object level down, so an error envelope nested there is the same class.
      { result: { error: 'not found', name: 'NotFoundError' } },
      { data: { isError: true, title: 'Failure title' } },
      { response: { status: 'error', name: 'NotFoundError' } },
    ])('never takes a target from an error-shaped result: %j', (content) => {
      row({ id: UUID, kind: 'post' }, JSON.stringify(content));
      expect(document.querySelector('.op-target')?.textContent).toBe('post');
    });

    it('ignores names in results marked as errors by the event envelope', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'tr', name: 'content_post_update', input: { id: UUID, kind: 'post' } }} result={{ kind: 'tool_result', toolUseId: 'tr', content: '{"name":"NotFoundError"}', isError: true }} runSucceeded />);
      expect(document.querySelector('.op-target')?.textContent).toBe('post');
    });

    it('parses a result once across streaming rerenders, and refreshes when content or input changes', () => {
      const content = JSON.stringify({ post: { title: 'Spring menu' } });
      const use = { kind: 'tool_use' as const, id: 'tr', name: 'content_post_update', input: { id: UUID, kind: 'post' } };
      const result = { kind: 'tool_result' as const, toolUseId: 'tr', content, isError: false };
      const parse = vi.spyOn(JSON, 'parse');
      try {
        // The hidden reader also formats JSON. A row with an explicit argument title bypasses
        // target parsing, giving a real rendered control for that independent formatter's cost.
        // Keep both inputs stable so the control does not invalidate only its reader memo.
        const controlUse = { ...use, id: 'control', input: { ...use.input, title: 'Control' } };
        const control = render(<ToolCard use={controlUse} result={{ ...result, toolUseId: 'control' }} runStreaming />);
        const parsesOf = (text: string) => parse.mock.calls.filter(([value]) => value === text).length;
        const controlParses = parsesOf(content);
        const { rerender } = render(<ToolCard use={use} result={result} runStreaming />);
        expect(parsesOf(content) - controlParses).toBe(controlParses + 1);
        for (let delta = 0; delta < 3; delta++) {
          const before = parsesOf(content);
          rerender(<ToolCard use={{ ...use }} result={{ ...result }} runStreaming={delta < 2} />);
          const rowParses = parsesOf(content) - before;
          const beforeControl = parsesOf(content);
          control.rerender(<ToolCard use={{ ...controlUse }} result={{ ...result, toolUseId: 'control' }} runStreaming={delta < 2} />);
          expect(rowParses).toBe(parsesOf(content) - beforeControl);
        }
        control.unmount();
        expect(document.querySelector('.op-target')?.textContent).toBe('Spring menu');
        const updated = JSON.stringify({ post: { title: 'Summer menu' } });
        rerender(<ToolCard use={use} result={{ ...result, content: updated }} runSucceeded />);
        expect(parsesOf(updated)).toBe(controlParses + 1);
        expect(document.querySelector('.op-target')?.textContent).toBe('Summer menu');
        rerender(<ToolCard use={{ ...use, input: { ...use.input, title: 'Argument title' } }} result={{ ...result, content: updated }} runSucceeded />);
        expect(document.querySelector('.op-target')?.textContent).toBe('Argument title');
        rerender(<ToolCard use={use} result={{ ...result, content: updated, isError: true }} runSucceeded />);
        expect(document.querySelector('.op-target')?.textContent).toBe('post');
      } finally {
        parse.mockRestore();
      }
    });

    it('falls back to the kind, never a bare UUID', () => {
      row({ id: UUID, kind: 'post' }, 'Updated.');
      expect(document.querySelector('.op-meta')?.textContent).toBe('post');
      row({ id: UUID });
      const heads = Array.from(document.querySelectorAll('.op-card-head'), (head) => head.textContent).join(' ');
      expect(heads).not.toContain(UUID.slice(0, 8));
    });

    it('puts the full name and target in tooltips', () => {
      row({ id: UUID, title: 'Spring menu' });
      expect(document.querySelector('.op-title')).toHaveAttribute('title', 'Content Post Update');
      expect(document.querySelector('.op-meta')).toHaveAttribute('title', 'Spring menu');
    });

    // Owner bug 11-01 (ui-look-4): the visible "Tool call · " prefix took half a ~333px dock row, so
    // names read "Tool call · Cont…". The row shows only the name; screen readers still hear the prefix.
    it('shows the bare name but still announces "Tool call" in the row\'s accessible name', () => {
      row({ id: UUID, title: 'Spring menu' });
      expect(document.querySelector('.op-title')?.textContent).toBe('Content Post Update');
      expect(screen.getByRole('button', { name: /^Tool call · Content Post Update/ })).toBeInTheDocument();
    });
  });

  it('falls back to GenericCard for an unrecognized tool', () => {
    render(<ToolCard use={{ kind: 'tool_use', id: 't2', name: 'CustomTool', input: { query: 'hello' } }} runSucceeded />);
    expect(document.querySelector('.op-title')?.textContent).toBe('CustomTool');
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  // A real, verified 1x1 red PNG (not a placeholder string like "AAAA") — generated the same way
  // a minimal hand-rolled encoder would (signature + IHDR + zlib-deflated IDAT + IEND, real CRC-32) and
  // independently confirmed to inflate back to the exact `[filter=0, R=255, G=0, B=0]` bytes it
  // encodes. jsdom does not decode image pixels at all (an `<img>`'s `naturalWidth`/`onload` never
  // fire here, real or not), so the strongest proof available IN THIS SUITE is that the exact string
  // `ToolResultMedia` puts in `src` is a byte-exact, independently-decodable image — not merely that
  // some string landed in the attribute. This exact `src` string was ALSO confirmed, separately, in
  // a real Chromium tab via Playwright (`data:image/png;base64,<this constant>` in a plain `<img>`,
  // no jsdom): `complete:true, naturalWidth:1, naturalHeight:1` — a genuine decode, not merely an
  // attribute check. That one-time verification isn't itself a committed test (it needs a real
  // browser, which this suite's jsdom environment isn't); this fixture and its structural checks are
  // the permanent regression coverage for the same claim.
  const REAL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  /** Decodes a `data:` URI's base64 payload back to bytes via the same platform primitive a real
   *  browser uses to decode an `<img src>` (`atob`), and confirms it starts with the real PNG magic
   *  bytes — proof the string is a genuinely valid image, not merely well-formed base64. */
  function decodedBytesFromDataUri(src: string): number[] {
    const match = src.match(/^data:([^;]+);base64,(.+)$/);
    expect(match, `"${src}" must be a well-formed data URI (mimeType + ";base64," + payload)`).toBeTruthy();
    const [, , base64] = match!;
    const binary = atob(base64!);
    return Array.from(binary, (ch) => ch.charCodeAt(0));
  }

  it('renders an image block from a tool_result.media as a genuinely decodable <img> on the GenericCard fallback', () => {
    const { container } = render(
      <ToolCard
        use={{ kind: 'tool_use', id: 't2b', name: 'assistant_demo_image', input: {} }}
        result={{ kind: 'tool_result', toolUseId: 't2b', content: '{"ok":true}', isError: false, media: [{ type: 'image', mimeType: 'image/png', data: REAL_PNG_BASE64 }] }}
        runSucceeded
      />,
    );
    const img = container.querySelector('.op-media-image');
    expect(img).toBeInTheDocument();
    const src = img!.getAttribute('src')!;
    expect(src).toBe(`data:image/png;base64,${REAL_PNG_BASE64}`);

    const bytes = decodedBytesFromDataUri(src);
    expect(bytes.slice(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it('renders an image block on the DelegatedToolCard path (a dotted Jini tool id) too, mimeType and data in the right positions', async () => {
    const { container } = render(
      <ToolCard
        use={{ kind: 'tool_use', id: 't2c', name: 'demo.image', input: {} }}
        result={{ kind: 'tool_result', toolUseId: 't2c', content: 'ok', isError: false, media: [{ type: 'image', mimeType: 'image/png', data: REAL_PNG_BASE64 }] }}
        runSucceeded
      />,
    );
    // This card's media sits inside its panel, which mounts only while the row is open.
    await userEvent.click(screen.getByRole('button'));
    const img = container.querySelector('.op-media-image');
    expect(img).toBeInTheDocument();
    const src = img!.getAttribute('src')!;

    // Distinct, unambiguous positions: this fails if `mimeType`/`data` were ever transposed (a
    // template-literal argument swap compiles fine and would still "have a src attribute" —
    // exactly the class of bug a looser assertion would miss).
    expect(src.startsWith('data:image/png;base64,')).toBe(true);
    expect(src.endsWith(REAL_PNG_BASE64)).toBe(true);
    expect(decodedBytesFromDataUri(src).slice(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it('an empty mimeType produces a non-standard data URI, but the image still renders — verified against a real browser, not assumed', async () => {
    const { container } = render(
      <ToolCard
        use={{ kind: 'tool_use', id: 't2e', name: 'demo.image', input: {} }}
        result={{ kind: 'tool_result', toolUseId: 't2e', content: 'ok', isError: false, media: [{ type: 'image', mimeType: '', data: REAL_PNG_BASE64 }] }}
        runSucceeded
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    const img = container.querySelector('.op-media-image');
    const src = img!.getAttribute('src')!;
    // `ToolResultMedia` does not validate `mimeType` — it trusts the daemon's extraction, which only
    // requires a STRING (`@jini-ai/daemon`'s `tool-result-media.ts`'s `asImageBlock`:
    // `typeof mimeType !== 'string'`), not a non-empty or real IANA one. An empty mimeType produces
    // `data:;base64,...`, which does NOT match `decodedBytesFromDataUri`'s well-formed-data-URI
    // regex (asserted below).
    //
    // What that does NOT mean, verified directly rather than assumed: an isolated real-browser check
    // (Chromium via Playwright, this same `data:;base64,...` string in a plain `<img>`, no jsdom
    // involved) showed `complete:true, naturalWidth:1, naturalHeight:1` — a genuine, correct decode.
    // Real image formats are self-describing enough (PNG's own magic bytes) that Chromium's decoder
    // sniffs the format regardless of a missing/empty declared MIME type; a GENUINELY non-image
    // payload at the same `src` (confirmed in the same check) correctly reports `naturalWidth:0`, so
    // this is not "the check can't tell" — it is "this specific malformation does not break
    // rendering in a real browser," a materially different, and better, finding than assumed.
    expect(src).toBe(`data:;base64,${REAL_PNG_BASE64}`);
    expect(src.match(/^data:([^;]+);base64,(.+)$/), 'an empty mimeType is not a well-formed data URI by the strict RFC shape, even though Chromium still decodes it').toBeNull();
    // The underlying bytes are untouched regardless — proven by decoding past the (non-standard)
    // `;base64,` marker directly, without going through the strict-mimeType helper above.
    const rawBase64 = src.slice(src.indexOf(';base64,') + ';base64,'.length);
    expect(Array.from(atob(rawBase64), (ch) => ch.charCodeAt(0)).slice(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it('shows a titled tool image as a captioned link to the full file, with the title as alt text', () => {
    const { container } = render(
      <ToolCard
        use={{ kind: 'tool_use', id: 't2g', name: 'media_import_from_url', input: { url: 'https://cdn.test/a.png' } }}
        result={{ kind: 'tool_result', toolUseId: 't2g', content: '{"media":{}}', isError: false, media: [{ type: 'image', mimeType: 'image/png', data: REAL_PNG_BASE64, title: 'Sunset hero', href: '/m/sunset-hero/original.png' }] }}
        runSucceeded
      />,
    );
    const link = screen.getByRole('link', { name: 'Sunset hero' });
    expect(link).toHaveAttribute('href', '/m/sunset-hero/original.png');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('img', { name: 'Sunset hero' })).toHaveAttribute('src', `data:image/png;base64,${REAL_PNG_BASE64}`);
    expect(container.querySelector('figcaption')?.textContent).toBe('Sunset hero');
  });

  it('never turns an unsafe image href into a link', () => {
    render(
      <ToolCard
        use={{ kind: 'tool_use', id: 't2h', name: 'CustomTool', input: {} }}
        result={{ kind: 'tool_result', toolUseId: 't2h', content: 'ok', isError: false, media: [{ type: 'image', mimeType: 'image/png', data: REAL_PNG_BASE64, title: 'x', href: 'javascript:alert(1)' }] }}
        runSucceeded
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'x' })).toBeInTheDocument();
  });

  it('renders no media element for a result whose media holds only text blocks', () => {
    const { container } = render(
      <ToolCard use={{ kind: 'tool_use', id: 't2f', name: 'CustomTool', input: {} }} result={{ kind: 'tool_result', toolUseId: 't2f', content: 'ok', isError: false, media: [{ type: 'text', text: 'note' }] }} runSucceeded />,
    );
    expect(container.querySelector('.op-media')).not.toBeInTheDocument();
  });

  it('renders no media element at all for a result with none — every existing card stays visually unchanged', () => {
    const { container } = render(
      <ToolCard use={{ kind: 'tool_use', id: 't2d', name: 'CustomTool', input: {} }} result={{ kind: 'tool_result', toolUseId: 't2d', content: 'ok', isError: false }} runSucceeded />,
    );
    expect(container.querySelector('.op-media')).not.toBeInTheDocument();
  });

  it('shows a spinner status while running with no result yet', () => {
    render(<ToolCard use={{ kind: 'tool_use', id: 't3', name: 'WebFetch', input: { url: 'https://x.test' } }} runStreaming />);
    expect(screen.getByTitle('Running')).toBeInTheDocument();
  });

  it('prefers a registered custom renderer over the built-in family card', () => {
    registerToolRenderer({ name: 'Bash', renderer: (props) => <div data-testid="custom">{props.name}:{props.status}</div> });
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
    registerToolRenderer({ name: 'Bash', renderer: () => {
      throw err;
    } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ToolCard use={{ kind: 'tool_use', id: 't6', name: 'Bash', input: { command: 'x' } }} runSucceeded />);
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('custom renderer for "Bash" threw'), err.stack);
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

    it('shows the complete command and output only after expansion', async () => {
      const longCommand = 'x'.repeat(500);
      const longOutput = 'y'.repeat(5000);
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'b3', name: 'Bash', input: { command: longCommand } }}
          result={{ kind: 'tool_result', toolUseId: 'b3', content: longOutput, isError: false }}
        />,
      );
      expect(document.querySelectorAll('pre')).toHaveLength(0);
      await userEvent.click(screen.getByRole('button'));
      const commandEl = document.querySelector('.op-command');
      const outputEl = document.querySelector('.op-output');
      expect(commandEl?.textContent).toBe(longCommand);
      expect(outputEl?.textContent).toBe(longOutput);
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

  describe('GenericCard / argsSummary / truncate', () => {
    it('renders nothing extra when input is null/undefined', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'gen1', name: 'Mystery', input: null }} runSucceeded />);
      expect(document.querySelector('.op-title')?.textContent).toBe('Mystery');
      expect(document.querySelector('.op-meta')).toBeNull();
    });

    it('uses a plain string input verbatim', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'gen1b', name: 'Mystery', input: 'raw string input' }} runSucceeded />);
      // Scoped to the collapsed summary: the expandable detail shows the same input again in full.
      expect(document.querySelector('.op-meta')?.textContent).toBe('raw string input');
    });

    it('stringifies a non-object, non-string input', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'gen2', name: 'Mystery', input: 42 }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('42');
    });

    it('falls back to the first string argument, never the JSON, when no known key matches', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'gen3', name: 'Mystery', input: { foo: 'bar' } }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('bar');
    });

    it('shows no summary for a circular object with no string argument', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      render(<ToolCard use={{ kind: 'tool_use', id: 'gen4', name: 'Mystery', input: circular }} runSucceeded />);
      expect(document.querySelector('.op-title')?.textContent).toBe('Mystery');
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

  describe('every tool row is humanized: label + short summary, never a raw id or JSON args', () => {
    it('a snake_case tool (content_post_update) gets "Tool call · Content Post Update" and its slug, not the JSON args', () => {
      const input = { id: '30127d31-2419-4e74-96e5-764442807909', kind: 'post', expectedVersion: 3, slug: 'ui-check-post', bodyJson: { type: 'doc' } };
      render(<ToolCard use={{ kind: 'tool_use', id: 'h1', name: 'content_post_update', input }} runSucceeded />);
      expect(document.querySelector('.op-title')?.textContent).toBe('Content Post Update');
      expect(document.querySelector('.op-meta')?.textContent).toBe('ui-check-post');
    });

    it('a question tool (assistant_ask_choice) shows its title, never {"title":…', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'h2', name: 'assistant_ask_choice', input: { title: 'No hosting key yet', options: [{ id: 'a' }] } }} runSucceeded />);
      expect(document.querySelector('.op-title')?.textContent).toBe('Assistant Ask Choice');
      expect(document.querySelector('.op-meta')?.textContent).toBe('No hosting key yet');
    });

    it('an MCP-prefixed name drops its mcp__server__ prefix in the title and the agent label', () => {
      const { container } = render(<ToolCard use={{ kind: 'tool_use', id: 'h3', name: 'mcp__tovu__theme_list_files', input: { themeId: 'basic-2' } }} runSucceeded />);
      expect(document.querySelector('.op-title')?.textContent).toBe('Theme List Files');
      expect(document.querySelector('.op-meta')?.textContent).toBe('basic-2');
      expect(container.querySelector('[data-agent-element="tool-call-h3"]')).toHaveAttribute('data-agent-label', 'A Theme List Files tool call the AI made');
    });

    it('args with no string value show no summary rather than JSON', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'h4', name: 'content_stats', input: { limit: 5, nested: { a: 'b' } } }} runSucceeded />);
      expect(document.querySelector('.op-meta')).toBeNull();
    });

    it('the full JSON args are still available in the expanded detail', async () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'h5', name: 'content_post_update', input: { id: 'p1', expectedVersion: 2 } }} runSucceeded />);
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.op-command')?.textContent).toContain('expectedVersion');
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

    it('also suppresses the read-only wrapper (execute_readonly_delegated_tool) on success', () => {
      const { container } = render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'w1c', name: 'mcp__jini__execute_readonly_delegated_tool', input: { toolId: 'content_stats', input: {} } }}
          result={{ kind: 'tool_result', toolUseId: 'w1c', content: 'ok', isError: false }}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('titles a failed read-only wrapper after its real tool id', () => {
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'w1d', name: 'execute_readonly_delegated_tool', input: { toolId: 'page.read', input: {} } }}
          result={{ kind: 'tool_result', toolUseId: 'w1d', content: 'daemon 403', isError: true }}
        />,
      );
      expect(screen.getByText('Page Read', { exact: false })).toBeInTheDocument();
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

    it('shows a bare string input as the target, the same as every other tool row', () => {
      // One summary rule for every row (`argsSummary`): a bare string argument is what the call acted on.
      render(<ToolCard use={{ kind: 'tool_use', id: 'd4', name: 'page.snapshot', input: 'agent-lab' }} runSucceeded />);
      expect(document.querySelector('.op-meta')?.textContent).toBe('agent-lab');
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
      // The run of underscores is one separator, so no empty word and no doubled space.
      expect(document.querySelector('.op-title')?.textContent).toBe('Page Fill Legacy');
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
      // Collapsed by default: the full output block is not mounted until the row opens.
      expect(document.querySelector('.accordion-collapsible.open')).toBeNull();
      expect(document.querySelector('.op-output')).toBeNull();
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
      expect(document.querySelector('.op-output')?.textContent).toBe(JSON.stringify({ inputSchema: { type: 'object' } }, null, 2));
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

    it('surfaces a describe_tool error result as an error detail block, not a silent failure', async () => {
      // The §29.4 schema-on-error path: an agent that asked about an unknown id must see why.
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 's12', name: 'describe_tool', input: { id: 'page.nope' } }}
          result={{ kind: 'tool_result', toolUseId: 's12', content: 'unknown tool "page.nope"', isError: true }}
        />,
      );
      // Collapsed, the FileErrorDetail block carries it, visible without expanding anything; opening
      // the row adds the panel's own output block.
      expect(document.querySelectorAll('.op-output')).toHaveLength(1);
      expect(document.querySelector('.op-card')?.lastElementChild?.textContent).toBe('unknown tool "page.nope"');
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelectorAll('.op-output')).toHaveLength(2);
    });
  });

  it('shows a compact JSON tool result re-indented for a person to read (the wire stays compact)', async () => {
    render(
      <ToolCard
        use={{ kind: 'tool_use', id: 'st1', name: 'mcp__jini__search_tools', input: { query: 'posts' } }}
        result={{ kind: 'tool_result', toolUseId: 'st1', content: '{"tools":[{"id":"content_post_list"}]}', isError: false }}
        runSucceeded
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(document.querySelector('.op-output')?.textContent).toBe(JSON.stringify({ tools: [{ id: 'content_post_list' }] }, null, 2));
  });

  // Owner 2026-10-08: some rows (a pending `assistant_ask_choice`, CLI built-ins like Fetch) could
  // not be opened to read the tool call. Every row now expands to its full input plus its result or
  // the reason there is none yet.
  describe('every tool row expands to its input and result', () => {
    const askInput = { title: 'Rebuild luviraconsulting.com in Tovu — what to import?', options: [{ label: 'Pages', value: 'pages' }] };

    it('expands a pending card tool (assistant_ask_choice) to its full input and a waiting note', async () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'ask1', name: 'assistant_ask_choice', input: askInput }} runStreaming />);
      const head = screen.getByRole('button');
      expect(head).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(head);
      expect(head).toHaveAttribute('aria-expanded', 'true');
      expect(document.querySelector('.accordion-collapsible.open')).not.toBeNull();
      expect(document.querySelector('.op-input')?.textContent).toBe(JSON.stringify(askInput, null, 2));
      expect(screen.getByText('Waiting for the result or answer…')).toBeInTheDocument();
    });

    it('shows the answer a card tool returned once the person answered', async () => {
      render(
        <ToolCard
          use={{ kind: 'tool_use', id: 'ask2', name: 'assistant_ask_choice', input: askInput }}
          result={{ kind: 'tool_result', toolUseId: 'ask2', content: '{"status":"submitted","selected":["pages"]}', isError: false }}
          runSucceeded
        />,
      );
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.op-output')?.textContent).toBe(JSON.stringify({ status: 'submitted', selected: ['pages'] }, null, 2));
      expect(screen.queryByText('Waiting for the result or answer…')).toBeNull();
    });

    it('opens from the keyboard', async () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'kb1', name: 'assistant_ask_choice', input: askInput }} runStreaming />);
      const head = screen.getByRole('button');
      head.focus();
      await userEvent.keyboard('{Enter}');
      expect(head).toHaveAttribute('aria-expanded', 'true');
      await userEvent.keyboard(' ');
      expect(head).toHaveAttribute('aria-expanded', 'false');
    });

    it('points the row button at the panel it controls', () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'ac1', name: 'Mystery', input: { a: 1 } }} runSucceeded />);
      const panelId = screen.getByRole('button').getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      expect(document.getElementById(panelId!)).toHaveClass('accordion-collapsible');
    });

    it.each([
      ['WebFetch', { url: 'https://www.luviraconsulting.com/' }],
      ['web_fetch', { url: 'https://example.test' }],
      ['WebSearch', { query: 'tovu cms' }],
      ['Glob', { pattern: '*.ts', path: 'src' }],
      ['Grep', { pattern: 'TODO', path: 'src' }],
    ])('expands the %s CLI built-in to its input and result', async (name, input) => {
      render(<ToolCard use={{ kind: 'tool_use', id: `cli-${name}`, name: name, input: input }} result={{ kind: 'tool_result', toolUseId: `cli-${name}`, content: 'result body', isError: false }} runSucceeded />);
      const head = screen.getByRole('button');
      await userEvent.click(head);
      expect(head).toHaveAttribute('aria-expanded', 'true');
      expect(document.querySelector('.op-input')?.textContent).toBe(JSON.stringify(input, null, 2));
      expect(document.querySelector('.op-output')?.textContent).toBe('result body');
    });

    it.each([
      ['Bash', { command: 'ls' }],
      ['Write', { file_path: '/a.txt', content: 'x' }],
      ['Edit', { file_path: '/a.txt' }],
      ['Read', { file_path: '/a.txt' }],
      ['page.fill', { element: 'name-input', value: 'x' }],
      ['search_tools', { query: 'fill' }],
      ['describe_tool', { id: 'page.fill' }],
    ])('marks the %s row button with its expanded state', async (name, input) => {
      render(<ToolCard use={{ kind: 'tool_use', id: `st-${name}`, name: name, input: input }} runSucceeded />);
      const head = screen.getByRole('button', { expanded: false });
      await userEvent.click(head);
      expect(head).toHaveAttribute('aria-expanded', 'true');
    });

    it('shows the input a search_tools / describe_tool call sent, not only what came back', async () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'dt-in', name: 'describe_tool', input: { id: 'assistant_ask_choice' } }} runSucceeded />);
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.op-input')?.textContent).toBe(JSON.stringify({ id: 'assistant_ask_choice' }, null, 2));
    });

    it.each([
      ['Write', { file_path: '/site/index.html', content: '<h1>Hi</h1>' }],
      ['Edit', { file_path: '/site/index.html', old_string: 'Hi', new_string: 'Hello' }],
      ['Read', { file_path: '/site/index.html', offset: 10 }],
    ])('shows the full %s input beside the file path', async (name, input) => {
      render(<ToolCard use={{ kind: 'tool_use', id: `fi-${name}`, name: name, input: input }} result={{ kind: 'tool_result', toolUseId: `fi-${name}`, content: 'ok', isError: false }} runSucceeded />);
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.op-input')?.textContent).toBe(JSON.stringify(input, null, 2));
      expect(document.querySelector('.op-output')?.textContent).toBe('ok');
    });

    it('pretty-prints a delegated Jini tool call input', async () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'dg-in', name: 'page.fill', input: { element: 'name-input', value: 'Ada' } }} runSucceeded />);
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.op-input')?.textContent).toBe(JSON.stringify({ element: 'name-input', value: 'Ada' }, null, 2));
    });

    it('keeps an error result readable inside the expanded row', async () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'err1', name: 'WebFetch', input: { url: 'https://x.test' } }} result={{ kind: 'tool_result', toolUseId: 'err1', content: 'fetch failed: 404', isError: true }} />);
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.op-output')?.textContent).toBe('fetch failed: 404');
    });

    it('explains a call whose run ended before it returned', async () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'int1', name: 'assistant_ask_choice', input: askInput }} />);
      await userEvent.click(screen.getByRole('button'));
      expect(screen.getByText('The run ended before this call returned a result.')).toBeInTheDocument();
    });

    it('redacts a credential in the expanded input the same way chat text is redacted', async () => {
      const key = 'sk-' + 'AbCdEf0123456789'.repeat(2);
      render(<ToolCard use={{ kind: 'tool_use', id: 'sec1', name: 'Mystery', input: { note: `use ${key}` } }} runSucceeded />);
      // The collapsed gist a page reader sees goes through the same redactor.
      expect(document.querySelector('.op-card-reader-text')?.textContent).toContain('[token removed]');
      expect(document.querySelector('.op-card-reader-text')?.textContent).not.toContain(key);
      await userEvent.click(screen.getByRole('button'));
      const shown = document.querySelector('.op-input')?.textContent ?? '';
      expect(shown).not.toContain(key);
      expect(shown).toContain('[token removed]');
    });

    it('renders no input block for an unserializable input but still expands', async () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      render(<ToolCard use={{ kind: 'tool_use', id: 'circ1', name: 'Mystery', input: circular }} runSucceeded />);
      await userEvent.click(screen.getByRole('button'));
      expect(document.querySelector('.op-input')).toBeNull();
      expect(screen.getByText('No result was recorded for this call.')).toBeInTheDocument();
    });
  });

  // 2026-10-11: a 38-message chat mounted 713 collapsed rows with 1,420 hidden <pre> (3.45 MB of
  // text). The full panel now mounts only while open; collapsed, one hidden capped node remains.
  describe('a collapsed row keeps only a capped gist mounted', () => {
    const longOutput = 'x'.repeat(20_000);

    it('mounts no detail block while collapsed, mounts it on open and drops it again on close', async () => {
      render(<ToolCard use={{ kind: 'tool_use', id: 'lz1', name: 'page.fill', input: { element: 'name-input' } }} result={{ kind: 'tool_result', toolUseId: 'lz1', content: longOutput, isError: false }} runSucceeded />);
      expect(document.querySelectorAll('pre')).toHaveLength(0);
      const head = screen.getByRole('button');
      await userEvent.click(head);
      expect(document.querySelector('.op-output')?.textContent).toBe(longOutput);
      expect(document.querySelector('.op-card-reader-text')).toBeNull();
      await userEvent.click(head);
      expect(document.querySelectorAll('pre')).toHaveLength(0);
    });

    it('keeps the input and capped output readable through the tagged region\'s textContent', () => {
      const { container } = render(<ToolCard use={{ kind: 'tool_use', id: 'lz2', name: 'page.fill', input: { element: 'name-input' } }} result={{ kind: 'tool_result', toolUseId: 'lz2', content: longOutput, isError: false }} runSucceeded />);
      const reader = container.querySelector('.op-card-reader-text');
      expect(reader).toHaveAttribute('hidden');
      expect(reader?.textContent).toBe(`${JSON.stringify({ element: 'name-input' }, null, 2)}\n${'x'.repeat(399)}…`);
      expect(container.querySelector('[data-agent-element="tool-call-lz2"]')?.textContent).toContain('name-input');
    });

    it('keeps the note explaining a missing result, and the output alone when the input has no JSON form', () => {
      const { container } = render(<ToolCard use={{ kind: 'tool_use', id: 'lz3', name: 'Mystery', input: null }} runStreaming />);
      expect(container.querySelector('.op-card-reader-text')?.textContent).toBe('Waiting for the result or answer…');
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const { container: empty } = render(<ToolCard use={{ kind: 'tool_use', id: 'lz4', name: 'Mystery', input: circular }} result={{ kind: 'tool_result', toolUseId: 'lz4', content: 'ok', isError: false }} runSucceeded />);
      expect(empty.querySelector('.op-card-reader-text')?.textContent).toBe('ok');
    });
  });
});
