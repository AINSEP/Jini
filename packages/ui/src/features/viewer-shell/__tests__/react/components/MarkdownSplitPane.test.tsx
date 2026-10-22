import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { MarkdownSplitPane } from '../../../react/components/MarkdownSplitPane.js';

describe('MarkdownSplitPane', () => {
  it('shows a loading state while previewHtml is null', () => {
    render(
      <MarkdownSplitPane mode="split" onModeChange={() => {}} sourceText="# Hi" onSourceChange={() => {}} previewHtml={null} />,
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders both panes in split mode', () => {
    render(
      <MarkdownSplitPane
        mode="split"
        onModeChange={() => {}}
        sourceText="# Hi"
        onSourceChange={() => {}}
        previewHtml="<h1>Hi</h1>"
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Markdown editor' })).toBeInTheDocument();
    expect(screen.getByLabelText('Markdown preview')).toBeInTheDocument();
  });

  it('renders only the editor pane in source mode', () => {
    render(
      <MarkdownSplitPane mode="source" onModeChange={() => {}} sourceText="# Hi" onSourceChange={() => {}} previewHtml="<h1>Hi</h1>" />,
    );
    expect(screen.getByRole('textbox', { name: 'Markdown editor' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Markdown preview')).toBeNull();
  });

  it('renders only the preview pane in preview mode', () => {
    render(
      <MarkdownSplitPane mode="preview" onModeChange={() => {}} sourceText="# Hi" onSourceChange={() => {}} previewHtml="<h1>Hi</h1>" />,
    );
    expect(screen.queryByRole('textbox', { name: 'Markdown editor' })).toBeNull();
    expect(screen.getByLabelText('Markdown preview')).toBeInTheDocument();
  });

  it('renders the given HTML into the preview pane', () => {
    render(
      <MarkdownSplitPane mode="preview" onModeChange={() => {}} sourceText="# Hi" onSourceChange={() => {}} previewHtml="<h1>Hi</h1>" />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Hi' })).toBeInTheDocument();
  });

  it('calls onModeChange when a mode tab is clicked', async () => {
    const onModeChange = vi.fn();
    render(
      <MarkdownSplitPane mode="split" onModeChange={onModeChange} sourceText="# Hi" onSourceChange={() => {}} previewHtml="<h1>Hi</h1>" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onModeChange).toHaveBeenCalledWith('preview');
  });

  it('calls onSourceChange as the editor is typed into', async () => {
    const onSourceChange = vi.fn();
    render(
      <MarkdownSplitPane mode="source" onModeChange={() => {}} sourceText="hi" onSourceChange={onSourceChange} previewHtml="<p>hi</p>" />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Markdown editor' }), '!');
    expect(onSourceChange).toHaveBeenCalled();
  });

  it('renders host-supplied toolbar extras', () => {
    render(
      <MarkdownSplitPane
        mode="split"
        onModeChange={() => {}}
        sourceText="hi"
        onSourceChange={() => {}}
        previewHtml="<p>hi</p>"
        toolbarLeftExtra={<span>Streaming</span>}
        toolbarActions={<button>Copy</button>}
      />,
    );
    expect(screen.getByText('Streaming')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('marks the preview pane as the active scroll-sync pane on pointerdown/wheel/touchstart/keydown/focus', () => {
    render(
      <MarkdownSplitPane mode="split" onModeChange={() => {}} sourceText="# Hi" onSourceChange={() => {}} previewHtml="<h1>Hi</h1>" />,
    );
    const preview = screen.getByLabelText('Markdown preview');
    expect(() => {
      fireEvent.pointerDown(preview);
      fireEvent.wheel(preview);
      fireEvent.touchStart(preview);
      fireEvent.keyDown(preview, { key: 'ArrowDown' });
      fireEvent.focus(preview);
    }).not.toThrow();
  });

  it('routes preview clicks through onPreviewClick', async () => {
    const onPreviewClick = vi.fn();
    render(
      <MarkdownSplitPane
        mode="preview"
        onModeChange={() => {}}
        sourceText="# Hi"
        onSourceChange={() => {}}
        previewHtml="<h1>Hi</h1>"
        onPreviewClick={onPreviewClick}
      />,
    );
    await userEvent.click(screen.getByRole('heading', { level: 1, name: 'Hi' }));
    expect(onPreviewClick).toHaveBeenCalled();
  });

  it('spreads extra editor textarea props (e.g. a host paste handler)', () => {
    const onPaste = vi.fn();
    render(
      <MarkdownSplitPane
        mode="source"
        onModeChange={() => {}}
        sourceText="hi"
        onSourceChange={() => {}}
        previewHtml="<p>hi</p>"
        editorTextareaProps={{ onPaste }}
      />,
    );
    fireEvent.paste(screen.getByRole('textbox', { name: 'Markdown editor' }));
    expect(onPaste).toHaveBeenCalled();
  });

  it('translates its mode-tab labels through I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Source: 'Source (fr)', Split: 'Partagé', Preview: 'Aperçu' } }} initialLocale="fr">
        <MarkdownSplitPane mode="split" onModeChange={() => {}} sourceText="hi" onSourceChange={() => {}} previewHtml="<p>hi</p>" />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Partagé' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aperçu' })).toBeInTheDocument();
  });
  it('shows the host loading label while loading even when previewHtml is present', () => {
    render(
      <MarkdownSplitPane
        mode="split"
        onModeChange={() => {}}
        sourceText="# Hi"
        onSourceChange={() => {}}
        previewHtml="<h1>Hi</h1>"
        loading
        loadingLabel="Fetching"
      />,
    );
    expect(screen.getByText('Fetching')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('uses host-supplied tab and aria labels instead of the defaults', () => {
    render(
      <MarkdownSplitPane
        mode="split"
        onModeChange={() => {}}
        sourceText="# Hi"
        onSourceChange={() => {}}
        previewHtml="<h1>Hi</h1>"
        sourceLabel="Src"
        splitLabel="Both"
        previewLabel="View"
        editorAriaLabel="Editor X"
        previewAriaLabel="Preview X"
        modeAriaLabel="Mode X"
      />,
    );
    const modeGroup = screen.getByLabelText('Mode X');
    expect(modeGroup.textContent).toBe('SrcBothView');
    expect(screen.getByRole('textbox', { name: 'Editor X' })).toBeInTheDocument();
    expect(screen.getByLabelText('Preview X')).toHaveClass('markdown-preview-pane');
  });
});
