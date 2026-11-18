// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, useT, type useT as UseT } from '../features/i18n/index.js';
import type { I18nContextValue } from '../features/i18n/index.js';
import { ProgressCard } from '../features/progress-card/components/ProgressCard.js';
import { SrcDocSandbox } from '../renderers/react/components/SrcDocSandbox.js';
import { ErrorNotice } from '../features/panel-kit/ErrorNotice.js';
import { SeeMore } from '../features/admin-widgets/components/SeeMore/SeeMore.js';
import { InfoTip } from '../features/admin-widgets/components/InfoTip.js';
import { ImagePreviewModal } from '../features/admin-widgets/components/ImagePreviewModal.js';
import { A2uiSurfaceRenderer } from '../features/a2ui/renderer.js';
import { IframeKeepAliveProvider } from '../features/iframe-pool/react/components/IframeKeepAliveProvider.js';
import { PooledIframe } from '../features/iframe-pool/react/components/PooledIframe.js';
import type { useErrorNotice } from '../features/panel-kit/ErrorNotice.hooks.js';
import type { useA2uiSurfaceRoot } from '../features/a2ui/use-a2ui-surface.js';

/** A translator that is visibly not the key, so a test proves the injected hook (not the passthrough) ran. */
const useQuotingT: typeof UseT = () => (key) => `«${key}»`;
const fakeHandle = () => 'fake-handle';

describe('translator-only components', () => {
  it('ProgressCard renders the injected translator', () => {
    const { container } = render(<ProgressCard data={{ id: 'p', status: 'running', steps: [], progress: 'indeterminate' }} useTHook={useQuotingT} />);
    expect(container.textContent).toContain('«');
  });

  it('SrcDocSandbox titles its frame with the injected translator', () => {
    render(<SrcDocSandbox html="<p>x</p>" useTHook={useQuotingT} />);
    expect(screen.getByTitle('«Artifact preview»')).toBeInTheDocument();
  });
});

describe('ErrorNotice', () => {
  const failure = { message: 'It broke', action: 'Retry later', copyText: 'detail-text' } as never;

  it('renders the feedback state and copy action of the injected hook', () => {
    const copy = vi.fn(async () => undefined);
    const useFake = (() => ({ feedback: { text: 'detail-text', copied: true }, copy })) as unknown as typeof useErrorNotice;
    render(<ErrorNotice failure={failure} t={(key) => `«${key}»`} useErrorNoticeHook={useFake} />);
    expect(screen.getByRole('status')).toHaveTextContent('«Copied»');
    fireEvent.click(screen.getByRole('button', { name: '«Copy details»' }));
    expect(copy).toHaveBeenCalledTimes(1);
  });
});

describe('agent-handle hook of the admin widgets', () => {
  const handled = (container: HTMLElement) => container.querySelector('[data-agent-element^="fake-handle"], [data-agent-handle^="fake-handle"]');

  it('SeeMore, InfoTip and ImagePreviewModal take their handle from the injected hook', () => {
    const useAgentHandleHook = vi.fn(fakeHandle);
    const see = render(<SeeMore useAgentHandleHook={useAgentHandleHook as never}>{'a long text '.repeat(40)}</SeeMore>);
    const tip = render(<InfoTip label="Tip" useAgentHandleHook={useAgentHandleHook as never} />);
    expect(handled(tip.container)).not.toBeNull();
    see.unmount();
    tip.unmount();
    render(<ImagePreviewModal open src="/x.png" alt="An image" onClose={vi.fn()} useAgentHandleHook={useAgentHandleHook as never} />);
    expect(useAgentHandleHook).toHaveBeenCalledWith({ agentHandle: undefined });
    expect(useAgentHandleHook.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('A2uiSurfaceRenderer', () => {
  it('renders the fallback when the injected surface-root hook reports no root', () => {
    const useNoRoot = (() => undefined) as unknown as typeof useA2uiSurfaceRoot;
    render(<A2uiSurfaceRenderer interpreter={{} as never} surfaceId="s" registry={{} as never} fallback={<p>no root</p>} useA2uiSurfaceRootHook={useNoRoot} />);
    expect(screen.getByText('no root')).toBeInTheDocument();
  });
});

describe('I18nProvider', () => {
  it('publishes the value of the injected provider hook', () => {
    const value = { locale: 'xx', t: (key: string) => `fake:${key}` } as unknown as I18nContextValue;
    function Probe() {
      return <span>{useT()('hello')}</span>;
    }
    render(
      <I18nProvider useI18nProviderHook={(() => value) as never}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText('fake:hello')).toBeInTheDocument();
  });
});

describe('iframe pool', () => {
  it('IframeKeepAliveProvider publishes the pool of the injected hook', () => {
    const useFakeProvider = vi.fn(() => ({ pool: { marker: 'fake' }, host: null }));
    const { container } = render(<IframeKeepAliveProvider useIframeKeepAliveProviderHook={useFakeProvider as never}><b>child</b></IframeKeepAliveProvider>);
    expect(useFakeProvider).toHaveBeenCalledWith(expect.objectContaining({ maxMounted: expect.any(Number) }));
    expect(container.textContent).toContain('child');
  });

  it('PooledIframe renders a plain iframe when the injected server-render hook says so', () => {
    render(<PooledIframe cacheKey="k" src="about:blank" title="plain" useIsServerRenderHook={() => true} />);
    expect(screen.getByTitle('plain').tagName).toBe('IFRAME');
  });
});
