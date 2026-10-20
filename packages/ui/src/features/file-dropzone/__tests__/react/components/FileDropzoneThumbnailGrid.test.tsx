// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileDropzoneThumbnailGrid } from './FileDropzoneThumbnailGrid.js';
import { I18nProvider } from '../../../i18n/index.js';
import type { FileDropzonePreviewState } from '../../types.js';

function file(name: string, type = ''): File {
  return new File(['x'], name, { type });
}

const EMPTY_PREVIEWS: FileDropzonePreviewState = {
  previewUrls: new Map(),
  fontFamilies: new Map(),
  textSnippets: new Map(),
};

describe('FileDropzoneThumbnailGrid', () => {
  it('renders nothing for an empty file list', () => {
    const { container } = render(
      <FileDropzoneThumbnailGrid files={[]} previews={EMPTY_PREVIEWS} onSelect={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an image thumbnail when a preview URL exists', () => {
    const f = file('a.png', 'image/png');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, previewUrls: new Map([[f, 'blob:1']]) };
    const { container } = render(<FileDropzoneThumbnailGrid files={[f]} previews={previews} onSelect={vi.fn()} />);
    // The thumbnail is decorative (`alt=""`), which gives it an implicit
    // "presentation" role rather than "img" — queried by tag, not role.
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:1');
  });

  it('falls back to the glyph for an image with no resolved preview URL yet', () => {
    const f = file('a.png', 'image/png');
    render(<FileDropzoneThumbnailGrid files={[f]} previews={EMPTY_PREVIEWS} onSelect={vi.fn()} />);
    expect(screen.getByText('PNG')).toBeInTheDocument();
  });

  it('renders a video thumbnail when a preview URL exists', () => {
    const f = file('a.mp4', 'video/mp4');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, previewUrls: new Map([[f, 'blob:vid']]) };
    const { container } = render(<FileDropzoneThumbnailGrid files={[f]} previews={previews} onSelect={vi.fn()} />);
    expect(container.querySelector('video')).toHaveAttribute('src', 'blob:vid');
  });

  it('renders a font specimen when a family name has loaded', () => {
    const f = file('brand.woff2', 'font/woff2');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, fontFamilies: new Map([[f, 'my-family']]) };
    render(<FileDropzoneThumbnailGrid files={[f]} previews={previews} onSelect={vi.fn()} />);
    expect(screen.getByText('Ag')).toHaveStyle({ fontFamily: "'my-family'" });
  });

  it('falls back to the glyph for a font with no loaded family yet (extension label capped at 4 chars)', () => {
    const f = file('brand.woff2', 'font/woff2');
    render(<FileDropzoneThumbnailGrid files={[f]} previews={EMPTY_PREVIEWS} onSelect={vi.fn()} />);
    expect(screen.getByText('WOFF')).toBeInTheDocument();
  });

  it('renders an HTML mini-render iframe when a preview URL exists', () => {
    const f = file('a.html', 'text/html');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, previewUrls: new Map([[f, 'blob:html']]) };
    const { container } = render(<FileDropzoneThumbnailGrid files={[f]} previews={previews} onSelect={vi.fn()} />);
    expect(container.querySelector('iframe')).toHaveAttribute('src', 'blob:html');
  });

  it('renders a text snippet when one has loaded', () => {
    const f = file('notes.txt', 'text/plain');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, textSnippets: new Map([[f, 'hello there']]) };
    render(<FileDropzoneThumbnailGrid files={[f]} previews={previews} onSelect={vi.fn()} />);
    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  it('falls back to the glyph when the text snippet is empty/whitespace-only', () => {
    const f = file('notes.txt', 'text/plain');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, textSnippets: new Map([[f, '   ']]) };
    render(<FileDropzoneThumbnailGrid files={[f]} previews={previews} onSelect={vi.fn()} />);
    expect(screen.getByText('TXT')).toBeInTheDocument();
  });

  it('falls back to the glyph for a kind with no renderable preview at all (pdf/audio/slides/other)', () => {
    const pdf = file('a.pdf', 'application/pdf');
    render(<FileDropzoneThumbnailGrid files={[pdf]} previews={EMPTY_PREVIEWS} onSelect={vi.fn()} />);
    expect(screen.getByText('PDF')).toBeInTheDocument();
  });

  it('truncates the extension glyph label to 4 uppercase characters, falling back to FILE with no extension', () => {
    const noExt = file('README', '');
    render(<FileDropzoneThumbnailGrid files={[noExt]} previews={EMPTY_PREVIEWS} onSelect={vi.fn()} />);
    expect(screen.getByText('FILE')).toBeInTheDocument();
  });

  it('clicking a tile calls onSelect with that file', async () => {
    const onSelect = vi.fn();
    const f = file('a.pdf', 'application/pdf');
    const { container } = render(<FileDropzoneThumbnailGrid files={[f]} previews={EMPTY_PREVIEWS} onSelect={onSelect} />);
    await userEvent.click(container.querySelector('.jini-file-dropzone__tile-main')!);
    expect(onSelect).toHaveBeenCalledWith(f);
  });

  it('omits the remove button entirely when onRemove is not supplied', () => {
    const f = file('a.pdf', 'application/pdf');
    render(<FileDropzoneThumbnailGrid files={[f]} previews={EMPTY_PREVIEWS} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('clicking the remove button calls onRemove with that file, not onSelect', async () => {
    const onRemove = vi.fn();
    const onSelect = vi.fn();
    const f = file('a.pdf', 'application/pdf');
    render(<FileDropzoneThumbnailGrid files={[f]} previews={EMPTY_PREVIEWS} onSelect={onSelect} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove a.pdf' }));
    expect(onRemove).toHaveBeenCalledWith(f);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders every staged file\'s caption', () => {
    const a = file('a.pdf', 'application/pdf');
    const b = file('b.png', 'image/png');
    render(<FileDropzoneThumbnailGrid files={[a, b]} previews={EMPTY_PREVIEWS} onSelect={vi.fn()} />);
    expect(screen.getByText('a.pdf')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
  });

  it('translates the grid aria-label and remove-button label end-to-end under I18nProvider', () => {
    const f = file('a.pdf', 'application/pdf');
    render(
      <I18nProvider dictionaries={{ fr: { 'Staged files': 'Fichiers en cours', 'Remove {name}': 'Retirer {name}' } }} initialLocale="fr">
        <FileDropzoneThumbnailGrid files={[f]} previews={EMPTY_PREVIEWS} onSelect={vi.fn()} onRemove={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('list', { name: 'Fichiers en cours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retirer a.pdf' })).toBeInTheDocument();
  });
});
