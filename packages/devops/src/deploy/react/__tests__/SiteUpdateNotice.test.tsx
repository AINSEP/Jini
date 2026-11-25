import type { SiteUpdateStatusReply } from '@jini-ai/core/contracts/site/devops-deploy';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SiteUpdateNotice, type SiteUpdateNoticeProps } from '../SiteUpdateNotice.js';

describe('SiteUpdateNotice', () => {
  it('shows the offered version and renders release notes as text through the injected kit', () => {
    const useSiteUpdateStatusHook = vi.fn<SiteUpdateNoticeProps['useSiteUpdateStatusHook']>(() => ({
      availability: {
        kind: 'available', runningVersion: '1.0.0', latest: '2.0.0',
        notes: '<strong>Release notes</strong>',
      },
    }));
    const updateAvailable = vi.fn<SiteUpdateNoticeProps['copy']['updateAvailable']>(
      ({ latest, runningVersion }) => `Update ${runningVersion} to ${latest}`,
    );
    const kit: SiteUpdateNoticeProps['kit'] = {
      components: { Notice: ({ children, tone }) => <aside data-tone={tone}>{children}</aside> },
    };

    const html = renderToStaticMarkup(<SiteUpdateNotice
      kit={kit} useSiteUpdateStatusHook={useSiteUpdateStatusHook}
      copy={{ updateAvailable, releaseNotes: 'Release notes' }}
    />);

    expect(useSiteUpdateStatusHook).toHaveBeenCalledExactlyOnceWith({});
    expect(updateAvailable).toHaveBeenCalledExactlyOnceWith({ latest: '2.0.0', runningVersion: '1.0.0' });
    expect(html).toBe('<aside data-tone="info">Update 1.0.0 to 2.0.0'
      + '<details><summary>Release notes</summary>&lt;strong&gt;Release notes&lt;/strong&gt;</details></aside>');
    expect(html).not.toContain('<strong>');
  });

  it('renders no update notice when the check is unavailable current or failed', () => {
    const statuses: (SiteUpdateStatusReply | null)[] = [
      null,
      { availability: { kind: 'unavailable' } },
      { availability: { kind: 'current', runningVersion: '1.0.0' } },
      { availability: { kind: 'check-failed' } },
    ];
    for (const status of statuses) {
      const useSiteUpdateStatusHook = vi.fn<SiteUpdateNoticeProps['useSiteUpdateStatusHook']>(() => status);
      const Notice = vi.fn(({ children }: { children: ReactNode }) => <aside>{children}</aside>);
      const html = renderToStaticMarkup(<SiteUpdateNotice
        kit={{ components: { Notice } }} useSiteUpdateStatusHook={useSiteUpdateStatusHook}
        copy={{ updateAvailable: ({ latest }) => latest, releaseNotes: 'Release notes' }}
      />);

      expect(html).toBe('');
      expect(Notice).not.toHaveBeenCalled();
      expect(useSiteUpdateStatusHook).toHaveBeenCalledExactlyOnceWith({});
    }
  });

  it('an accepted hand-off is not shown as a finished update', () => {
    const render = (lastAttempt: NonNullable<SiteUpdateStatusReply['lastAttempt']>) => renderToStaticMarkup(<SiteUpdateNotice
      kit={{ components: { Notice: ({ children, tone }) => <aside data-tone={tone}>{children}</aside> } }}
      useSiteUpdateStatusHook={() => ({ availability: { kind: 'current', runningVersion: '1.0.0' }, lastAttempt })}
      copy={{ updateAvailable: ({ latest }) => latest, releaseNotes: 'Release notes' }}
    />);

    expect(render({ status: 'updating', toVersion: '2.0.0', summary: 'Updating to 2.0.0. <b>The site restarts.</b>' }))
      .toBe('<aside data-tone="info">Updating to 2.0.0. &lt;b&gt;The site restarts.&lt;/b&gt;</aside>');
    expect(render({ status: 'updated', toVersion: '2.0.0', summary: 'Updated to 2.0.0.' })).toBe('<aside data-tone="success">Updated to 2.0.0.</aside>');
    expect(render({ status: 'rolled-back', toVersion: '2.0.0', summary: 'Put back.' })).toBe('<aside data-tone="warning">Put back.</aside>');
    expect(render({ status: 'failed', toVersion: '2.0.0', summary: 'Failed.' })).toBe('<aside data-tone="danger">Failed.</aside>');
  });
});
