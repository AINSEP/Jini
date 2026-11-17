import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import { DEFAULT_VIEWPORT_PRESETS } from '../../../../viewer-shell/index.js';
import { VersionPreviewFrame } from '../../../react/components/VersionPreviewFrame.js';

function baseProps() {
  return {
    previewDocument: '',
    frameReady: false,
    onFrameLoad: vi.fn(),
    viewport: 'desktop',
    viewportPresets: DEFAULT_VIEWPORT_PRESETS,
    title: 'index.html · v1',
    error: null,
    loading: false,
    loadingContent: false,
  };
}

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('VersionPreviewFrame', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an alert with the error message when there is an error', () => {
    render(<VersionPreviewFrame {...baseProps()} error="Restore failed." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Restore failed.');
  });

  it('renders the empty state when not loading and there is no preview document', () => {
    render(<VersionPreviewFrame {...baseProps()} />);
    expect(screen.getByText('No preview available.')).toBeInTheDocument();
  });

  it('does not render the empty state while loading', () => {
    render(<VersionPreviewFrame {...baseProps()} loading />);
    expect(screen.queryByText('No preview available.')).not.toBeInTheDocument();
  });

  it('renders the sandboxed iframe with the given srcDoc and title', () => {
    render(<VersionPreviewFrame {...baseProps()} previewDocument="<p>hi</p>" />);
    const iframe = screen.getByTitle('index.html · v1') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-downloads');
    expect(iframe.srcdoc).toBe('<p>hi</p>');
  });

  it('calls onFrameLoad when the iframe fires load', () => {
    const onFrameLoad = vi.fn();
    render(<VersionPreviewFrame {...baseProps()} previewDocument="<p>hi</p>" onFrameLoad={onFrameLoad} />);
    const iframe = screen.getByTitle('index.html · v1');
    iframe.dispatchEvent(new Event('load'));
    expect(onFrameLoad).toHaveBeenCalledTimes(1);
  });

  it('shows the loading overlay while loading, loadingContent, or frame not ready', () => {
    const { rerender } = render(<VersionPreviewFrame {...baseProps()} loading />);
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(<VersionPreviewFrame {...baseProps()} loadingContent />);
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(<VersionPreviewFrame {...baseProps()} previewDocument="<p/>" frameReady={false} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('hides the loading overlay once the frame is ready and nothing else is loading', () => {
    render(<VersionPreviewFrame {...baseProps()} previewDocument="<p/>" frameReady />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders a non-fixed-frame preset (desktop) without viewport width/height styling', () => {
    render(<VersionPreviewFrame {...baseProps()} previewDocument="<p/>" viewport="desktop" />);
    const viewportEl = document.querySelector('.jini-preview-viewport') as HTMLElement;
    expect(viewportEl.style.getPropertyValue('--preview-viewport-width')).toBe('');
  });

  it('renders a fixed-size preset (mobile) with viewport width/height styling', () => {
    render(<VersionPreviewFrame {...baseProps()} previewDocument="<p/>" viewport="mobile" />);
    const viewportEl = document.querySelector('.jini-preview-viewport') as HTMLElement;
    expect(viewportEl.style.getPropertyValue('--preview-viewport-width')).toBe('390px');
  });

  it('renders translated empty-state text under I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'No preview available.': 'Aucun aperçu disponible.' } }} initialLocale="fr">
        <VersionPreviewFrame {...baseProps()} />
      </I18nProvider>,
    );
    expect(screen.getByText('Aucun aperçu disponible.')).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<VersionPreviewFrame {...baseProps()} useTHook={useQuotingT} />);
    expect(screen.getByText('«No preview available.»')).toBeInTheDocument();
  });
});
