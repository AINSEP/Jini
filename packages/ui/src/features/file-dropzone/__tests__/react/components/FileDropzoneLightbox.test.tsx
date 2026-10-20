// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileDropzoneLightbox } from './FileDropzoneLightbox.js';
import { I18nProvider } from '../../../i18n/index.js';
import type { FileDropzonePreviewState } from '../../types.js';

function file(name: string, type = '', size = 0): File {
  return new File([new Uint8Array(size)], name, { type });
}

const EMPTY_PREVIEWS: FileDropzonePreviewState = {
  previewUrls: new Map(),
  fontFamilies: new Map(),
  textSnippets: new Map(),
};

// FileDropzoneLightbox always portals to document.body, so every query
// below goes through `document`/`screen` (which searches the whole
// document by default) rather than RTL's `render()` container div, which
// the portal content lives outside of.

describe('FileDropzoneLightbox', () => {
  it('renders an image stage', () => {
    const f = file('a.png', 'image/png');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, previewUrls: new Map([[f, 'blob:img']]) };
    render(<FileDropzoneLightbox file={f} previews={previews} onClose={vi.fn()} />);
    expect(document.querySelector('img.jini-file-dropzone__lightbox-img')).toHaveAttribute('src', 'blob:img');
  });

  it('renders a video stage with controls', () => {
    const f = file('a.mp4', 'video/mp4');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, previewUrls: new Map([[f, 'blob:vid']]) };
    render(<FileDropzoneLightbox file={f} previews={previews} onClose={vi.fn()} />);
    expect(document.querySelector('video')).toHaveAttribute('src', 'blob:vid');
  });

  it('renders an audio stage with a volume icon', () => {
    const f = file('a.mp3', 'audio/mpeg');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, previewUrls: new Map([[f, 'blob:aud']]) };
    render(<FileDropzoneLightbox file={f} previews={previews} onClose={vi.fn()} />);
    expect(document.querySelector('audio')).toHaveAttribute('src', 'blob:aud');
  });

  it('renders a pdf stage as an embedding iframe', () => {
    const f = file('a.pdf', 'application/pdf');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, previewUrls: new Map([[f, 'blob:pdf']]) };
    render(<FileDropzoneLightbox file={f} previews={previews} onClose={vi.fn()} />);
    expect(document.querySelector('iframe')).toHaveAttribute('src', 'blob:pdf');
  });

  it('renders an html stage as a sandboxed iframe', () => {
    const f = file('a.html', 'text/html');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, previewUrls: new Map([[f, 'blob:html']]) };
    render(<FileDropzoneLightbox file={f} previews={previews} onClose={vi.fn()} />);
    const iframe = document.querySelector('iframe')!;
    expect(iframe).toHaveAttribute('src', 'blob:html');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-popups');
  });

  it('renders a font specimen + pangram scale when a family has loaded', () => {
    const f = file('brand.woff2', 'font/woff2');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, fontFamilies: new Map([[f, 'my-family']]) };
    render(<FileDropzoneLightbox file={f} previews={previews} onClose={vi.fn()} />);
    const hero = document.querySelector('.jini-file-dropzone__lightbox-font-hero');
    expect(hero).toHaveTextContent('AgBb Cc');
    expect(document.querySelector('.jini-file-dropzone__lightbox-font')).toHaveStyle({ fontFamily: "'my-family'" });
  });

  it('falls back for a font with no loaded family yet', () => {
    const f = file('brand.woff2', 'font/woff2');
    render(<FileDropzoneLightbox file={f} previews={EMPTY_PREVIEWS} onClose={vi.fn()} />);
    expect(screen.getByText('No inline preview for this file type.')).toBeInTheDocument();
  });

  it('renders a non-empty text snippet verbatim', () => {
    const f = file('notes.txt', 'text/plain');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, textSnippets: new Map([[f, 'hello world']]) };
    render(<FileDropzoneLightbox file={f} previews={previews} onClose={vi.fn()} />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('shows a translated "(empty file)" placeholder for a genuinely empty (but loaded) text file', () => {
    const f = file('empty.txt', 'text/plain');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, textSnippets: new Map([[f, '']]) };
    render(<FileDropzoneLightbox file={f} previews={previews} onClose={vi.fn()} />);
    expect(screen.getByText('(empty file)')).toBeInTheDocument();
  });

  it('falls back for a text file whose snippet has not loaded yet (undefined, not empty string)', () => {
    const f = file('notes.txt', 'text/plain');
    render(<FileDropzoneLightbox file={f} previews={EMPTY_PREVIEWS} onClose={vi.fn()} />);
    expect(screen.getByText('No inline preview for this file type.')).toBeInTheDocument();
  });

  it('falls back with a name/size card for a kind with no renderable preview (slides/other)', () => {
    const f = file('deck.pptx', 'application/vnd.ms-powerpoint', 2048);
    render(<FileDropzoneLightbox file={f} previews={EMPTY_PREVIEWS} onClose={vi.fn()} />);
    const fallback = document.querySelector<HTMLElement>('.jini-file-dropzone__lightbox-fallback')!;
    expect(within(fallback).getByText('deck.pptx')).toBeInTheDocument();
    expect(within(fallback).getByText('PPTX · 2 KB')).toBeInTheDocument();
  });

  it('shows an em dash for the fallback meta line when size is zero', () => {
    const f = file('deck.pptx', 'application/vnd.ms-powerpoint', 0);
    render(<FileDropzoneLightbox file={f} previews={EMPTY_PREVIEWS} onClose={vi.fn()} />);
    expect(screen.getByText('PPTX · —')).toBeInTheDocument();
  });

  it('clicking the backdrop calls onClose', async () => {
    const onClose = vi.fn();
    const f = file('a.png', 'image/png');
    render(<FileDropzoneLightbox file={f} previews={EMPTY_PREVIEWS} onClose={onClose} />);
    await userEvent.click(document.querySelector('.jini-file-dropzone__lightbox')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking inside the dialog does not call onClose (stops propagation)', async () => {
    const onClose = vi.fn();
    const f = file('a.png', 'image/png');
    render(<FileDropzoneLightbox file={f} previews={EMPTY_PREVIEWS} onClose={onClose} />);
    await userEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking the close button calls onClose', async () => {
    const onClose = vi.fn();
    const f = file('a.png', 'image/png');
    render(<FileDropzoneLightbox file={f} previews={EMPTY_PREVIEWS} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dialog is labeled and portaled to document.body', () => {
    render(<FileDropzoneLightbox file={file('a.png', 'image/png')} previews={EMPTY_PREVIEWS} onClose={vi.fn()} />);
    expect(document.body.querySelector(':scope > .jini-file-dropzone__lightbox')).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'a.png' })).toBeInTheDocument();
  });

  it('translates the close button label and empty-file placeholder end-to-end under I18nProvider', () => {
    const f = file('empty.txt', 'text/plain');
    const previews: FileDropzonePreviewState = { ...EMPTY_PREVIEWS, textSnippets: new Map([[f, '']]) };
    render(
      <I18nProvider
        dictionaries={{ fr: { 'Close preview': 'Fermer', '(empty file)': '(fichier vide)' } }}
        initialLocale="fr"
      >
        <FileDropzoneLightbox file={f} previews={previews} onClose={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
    expect(screen.getByText('(fichier vide)')).toBeInTheDocument();
  });

  it('translates the no-inline-preview hint end-to-end under I18nProvider', () => {
    const f = file('deck.key', 'application/x-iwork-keynote-sffkey');
    render(
      <I18nProvider dictionaries={{ fr: { 'No inline preview for this file type.': "Pas d'aperçu." } }} initialLocale="fr">
        <FileDropzoneLightbox file={f} previews={EMPTY_PREVIEWS} onClose={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByText("Pas d'aperçu.")).toBeInTheDocument();
  });
});
