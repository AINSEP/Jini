import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SrcDocSandbox } from '../SrcDocSandbox.js';
import { I18nProvider } from '../../i18n.js';

describe('SrcDocSandbox', () => {
  it('renders a sandboxed iframe with no allow-same-origin', () => {
    render(<SrcDocSandbox html="<p>hi</p>" />);
    const iframe = screen.getByTitle('Artifact preview') as HTMLIFrameElement;
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('builds the srcDoc from the given html', () => {
    render(<SrcDocSandbox html="<p>unique-marker-123</p>" />);
    const iframe = screen.getByTitle('Artifact preview') as HTMLIFrameElement;
    expect(iframe.srcdoc).toContain('unique-marker-123');
    expect(iframe.srcdoc).toContain('data-jini-sandbox-shim');
  });

  it('uses an explicit title over the translated default', () => {
    render(<SrcDocSandbox html="<p>hi</p>" title="Custom title" />);
    expect(screen.getByTitle('Custom title')).toBeInTheDocument();
  });

  it('translates the default title when an I18nProvider dictionary is mounted', () => {
    render(
      <I18nProvider dictionary={{ 'Artifact preview': 'Aperçu de l’artefact' }}>
        <SrcDocSandbox html="<p>hi</p>" />
      </I18nProvider>,
    );
    expect(screen.getByTitle('Aperçu de l’artefact')).toBeInTheDocument();
  });

  it('forwards messages posted from the sandboxed document', () => {
    const onMessage = vi.fn();
    render(<SrcDocSandbox html="<p>hi</p>" onMessage={onMessage} />);
    const iframe = screen.getByTitle('Artifact preview') as HTMLIFrameElement;
    const event = new MessageEvent('message', { data: { type: 'ping' }, source: iframe.contentWindow });
    window.dispatchEvent(event);
    expect(onMessage).toHaveBeenCalledWith({ type: 'ping' });
  });

  it('ignores messages not sourced from its own iframe', () => {
    const onMessage = vi.fn();
    render(<SrcDocSandbox html="<p>hi</p>" onMessage={onMessage} />);
    const event = new MessageEvent('message', { data: { type: 'ping' } });
    window.dispatchEvent(event);
    expect(onMessage).not.toHaveBeenCalled();
  });
});
