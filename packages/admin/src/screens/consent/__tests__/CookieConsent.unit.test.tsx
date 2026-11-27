// @vitest-environment jsdom
import { agentHandle } from '@jini-ai/core/agent-handles';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithAdminKit } from '../../../react/__tests__/render-with-admin-kit.js';
import { AdminKitProvider, useAdminKit } from '../../../react/kit.js';
import { fakeAdminKit } from '../../../react/testing-kit.js';
import { CookieConsent, type ConsentScreenFieldsProps, type ConsentScreenUi } from '../CookieConsent.js';
import { consentTranslation } from '../consent-i18n.js';
import { useConsentPage, useConsentPreview, useConsentPreviewScale, useConsentReadiness } from '../use-consent-page.hooks.js';
import type { ConsentReadiness, ConsentRevisionsPort } from '../settings.hooks.js';
import { conflict, CONSENT_CONFIG, consentErrors, consentSnapshot, fakeConsentPort, revision } from './consent-fixtures.js';

/** @file The page renders the host-supplied consent sections and preview with the host's
 * translation hook, error reader and the kit's light admin palette. */

function recordingUi() {
  const seen: Record<string, unknown> = {};
  const record = (name: string) => (props: object) => { seen[name] = props; return <p>{name}</p>; };
  const ui: ConsentScreenUi = {
    BannerFields: record('BannerFields'), LookFields: record('LookFields'), RulesFields: record('RulesFields'),
    PreviewFrame: ({ html, status }) => <output>{html ?? status}</output>,
    previewDesktopWidth: 1024, previewScale: () => 1,
  };
  return { ui, seen };
}

const hooks = { useConsentPage, useConsentReadiness, useConsentPreview, useConsentPreviewScale, useAdminKit };

const useGerman = () => consentTranslation({ locale: 'de', productName: 'Acme' });

describe('CookieConsent', () => {
  it('passes the look section the kit light palette and previews through the injected frame', async () => {
    const kit = fakeAdminKit();
    const { ui, seen } = recordingUi();
    renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="look" port={fakeConsentPort({ get: () => Promise.resolve(consentSnapshot()) })} useTranslate={useGerman} errors={consentErrors} ui={ui} delays={{ previewMs: 0 }} />, { kit });
    await screen.findByText('LookFields');
    expect((seen.LookFields as { lightColors: unknown }).lightColors).toBe(kit.theme.defaultAdminTheme.light);
    expect((seen.LookFields as ConsentScreenFieldsProps).dictionary).toEqual(useGerman().dictionary);
    await waitFor(() => expect(screen.getByText('<p>page</p>')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(useGerman().t('Cookie Consent'));
  });

  it('shows the host error reader message when the load fails', async () => {
    const { ui } = recordingUi();
    const errors = { ...consentErrors, describe: () => 'host says no' };
    renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="banner" port={fakeConsentPort({ get: () => Promise.reject(new Error('x')) })} useTranslate={useGerman} errors={errors} ui={ui} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('host says no');
  });

  it('renders the banner section with the editor banner modes', async () => {
    const { ui, seen } = recordingUi();
    const snapshot = consentSnapshot();
    renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="banner" port={fakeConsentPort({ get: () => Promise.resolve({ ...snapshot, editor: { ...snapshot.editor, bannerModes: ['jini', 'off'] } }) })} useTranslate={useGerman} errors={consentErrors} ui={ui} />);
    await screen.findByText('BannerFields');
    expect((seen.BannerFields as { bannerModes: unknown }).bannerModes).toEqual(['jini', 'off']);
  });

  it('renders only jini-* class names on every tab, so the host stylesheet owns the look', async () => {
    const classesOf = (root: Element) => [...root.querySelectorAll('[class]')].flatMap((el) => [...el.classList]);
    const english = () => consentTranslation({ locale: 'en', productName: 'Acme' });
    const overview = renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="overview" port={fakeConsentPort({ get: () => Promise.resolve(consentSnapshot()) })} useTranslate={english} errors={consentErrors} ui={recordingUi().ui} />);
    await screen.findByText('Nothing blocks the banner.');
    const classes = classesOf(overview.container);
    overview.unmount();
    const look = renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="look" port={fakeConsentPort({ get: () => Promise.resolve(consentSnapshot()) })} useTranslate={english} errors={consentErrors} ui={recordingUi().ui} delays={{ previewMs: 0 }} />);
    await screen.findByText('LookFields');
    classes.push(...classesOf(look.container));
    look.unmount();
    const failed = renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="banner" port={fakeConsentPort({ get: () => Promise.reject(new Error('x')) })} useTranslate={english} errors={{ ...consentErrors, describe: () => 'Load failed.' }} ui={recordingUi().ui} />);
    await screen.findByText('Load failed.');
    classes.push(...classesOf(failed.container));
    expect(classes).toEqual(expect.arrayContaining(['jini-consent-page', 'jini-page-title', 'jini-card', 'jini-card-head', 'jini-status-neutral', 'jini-page-actions', 'jini-btn-primary', 'jini-notice-error']));
    expect(classes.filter((name) => !name.startsWith('jini-'))).toEqual([]);
  });
});

const english = () => consentTranslation({ locale: 'en', productName: 'Acme' });

it('shows fix links only for actionable problems, with their corresponding tab', async () => {
  const readiness: ConsentReadiness = {
    ready: false, enabled: true, truncated: true, limitations: [],
    blockingProblems: [
      { code: 'PRIVACY_LINK_REQUIRED', field: 'privacyPolicyUrl', message: 'Add the privacy policy link.' },
      { code: 'TRUSTED_REGION_REQUIRED', field: 'regionMode', message: 'Choose a region rule.' },
      { message: 'An administrator must repair storage.' },
    ],
    declarations: [{ src: '/optional.js', consent: ['analytics', 'marketing'] }, { src: '/base.js' }],
    warnings: [{ code: 'unmanaged', message: 'An embed was found.', source: '/old-post' }, { message: 'Review the footer.' }],
  };
  renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="overview"
    port={fakeConsentPort({ readiness: async () => readiness, get: async () => consentSnapshot({
      draft: revision('d2'), published: revision('p1'), effective: CONSENT_CONFIG,
    }) })} useTranslate={english} errors={consentErrors} ui={recordingUi().ui} />);
  const blockers = within(await screen.findByRole('region', { name: 'Before you turn it on' }));
  await blockers.findByText('Add the privacy policy link.');
  const item = (message: string) => within(blockers.getByText(message).closest('li')!);
  expect(item('Add the privacy policy link.').getByRole('link', { name: 'Fix' })).toHaveAttribute('href', '/admin/consent?tab=banner');
  expect(item('Choose a region rule.').getByRole('link', { name: 'Fix' })).toHaveAttribute('href', '/admin/consent?tab=rules');
  expect(item('An administrator must repair storage.').queryByRole('link')).not.toBeInTheDocument();
  const banner = within(screen.getByRole('region', { name: 'Banner' }));
  expect(banner.getByText('On')).toBeInTheDocument();
  expect(banner.getByText('You have changes that are not live yet.')).toBeInTheDocument();
  const scripts = within(screen.getByRole('region', { name: 'Declared scripts' }));
  expect(scripts.getByText('/optional.js').closest('li')).toHaveTextContent('/optional.js — analytics, marketing');
  expect(scripts.getByText('/base.js').closest('li')).toHaveTextContent('/base.js — Automatic');
  expect(scripts.getByText('Only the first 200 items were checked.')).toBeInTheDocument();
  const gaps = within(screen.getByRole('region', { name: 'Unmanaged content' }));
  expect(gaps.getByText('/old-post').closest('li')).toHaveTextContent('An embed was found. /old-post');
  expect(gaps.getByText('Review the footer.').querySelector('code')).toBeNull();
});

it('announces a failed readiness check and does not claim it found no blockers', async () => {
  renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle}
    port={fakeConsentPort({ readiness: async () => { throw new Error('offline'); } })}
    useTranslate={english} errors={consentErrors} ui={recordingUi().ui} />);
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't check readiness.");
  expect(screen.queryByText('Nothing blocks the banner.')).not.toBeInTheDocument();
  expect(screen.queryByText('Checking…')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Declared scripts' })).not.toBeInTheDocument();
});

it('resets custom CSS in the draft using the supplied delay, without publishing', async () => {
  const original = consentSnapshot();
  const customCss = '#banner { padding: 6px; }';
  const defaultCss = '#banner { padding: 18px; }';
  const config = { ...CONSENT_CONFIG, customCss };
  const saveDraft = vi.fn<ConsentRevisionsPort['saveDraft']>(async ({ config }) => ({
    revision: revision('d2', config), blockingProblems: [],
  }));
  const publish = vi.fn<ConsentRevisionsPort['publish']>();
  const { ui } = recordingUi();
  renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="look"
    port={fakeConsentPort({
      get: async () => consentSnapshot({ draft: revision('d1', config), editor: { ...original.editor, defaults: { customCss: defaultCss } } }),
      saveDraft, publish,
    })} useTranslate={english} errors={consentErrors} ui={ui} delays={{ autosaveMs: 0, previewMs: 0 }} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Reset to default' }));
  await waitFor(() => expect(saveDraft.mock.calls).toEqual([[{ config: { ...config, customCss: defaultCss }, expectedDraftId: 'd1' }]]));
  expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
  expect(publish).not.toHaveBeenCalled();
});

it.each([
  { bannerMode: undefined, warning: 'Invalid rule was skipped.' },
  { bannerMode: 'off', warning: null },
] as const)('only shows CSS warnings while Jini renders the banner (mode $bannerMode)', async ({ bannerMode, warning }) => {
  const original = consentSnapshot();
  const config = bannerMode === undefined ? CONSENT_CONFIG : { ...CONSENT_CONFIG, bannerMode };
  renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="banner"
    port={fakeConsentPort({
      get: async () => consentSnapshot({ draft: revision('d1', config), editor: { ...original.editor, bannerModes: ['jini', 'off'] } }),
      preview: async () => ({ html: '<p>preview ready</p>', blockingProblems: [], warnings: [{ code: 'css', message: 'Invalid rule was skipped.' }], revisionId: null }),
    })} useTranslate={english} errors={consentErrors} ui={recordingUi().ui} delays={{ previewMs: 0 }} />);
  await screen.findByText('<p>preview ready</p>');
  expect(screen.queryByText('Invalid rule was skipped.')?.textContent ?? null).toBe(warning);
  expect(screen.queryByText('Some styles were skipped. You can still publish.')?.textContent ?? null)
    .toBe(warning === null ? null : 'Some styles were skipped. You can still publish.');
  expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
});

it('navigates to Rules without adding browser history and never previews the rules tab', async () => {
  const original = window.location.href;
  const originalState = history.state;
  try {
    history.replaceState(null, '', '/admin/consent?tab=overview');
    const length = history.length;
    const preview = vi.fn<ConsentRevisionsPort['preview']>(async () => ({ html: '<p>Unexpected preview</p>', blockingProblems: [], revisionId: null }));
    const { ui, seen } = recordingUi();
    const observePreview = vi.fn(useConsentPreview);
    const port = fakeConsentPort({ preview });
    const props = { hooks: { ...hooks, useConsentPreview: observePreview }, agentHandle, port, useTranslate: english, errors: consentErrors, ui };
    const kit = fakeAdminKit();
    const view = renderWithAdminKit(<CookieConsent {...props} tabId="overview" />, { kit });
    await screen.findByText('Nothing blocks the banner.');
    await userEvent.click(screen.getByRole('tab', { name: 'Rules' }));
    expect(location.pathname + location.search).toBe('/admin/consent?tab=rules');
    expect(history.length).toBe(length);
    view.rerender(<AdminKitProvider kit={kit}><CookieConsent {...props} tabId="rules" /></AdminKitProvider>);
    const fixed = screen.getByRole('region', { name: 'Fixed rules' });
    expect(within(fixed).getByText('Choices are kept for 180 days, then visitors are asked again.')).toBeInTheDocument();
    expect(seen.RulesFields).toMatchObject({ regionModes: ['opt-in', 'opt-out'], disabled: false });
    expect(observePreview).toHaveBeenLastCalledWith({ port, config: null, t: expect.any(Function), errors: consentErrors }, {});
    expect(preview).not.toHaveBeenCalled();
  } finally {
    history.replaceState(originalState, '', original);
  }
});

it('lets the operator reload after a save conflict and disables the reset until then', async () => {
  const initial = consentSnapshot();
  const config = { ...CONSENT_CONFIG, customCss: 'custom style' };
  const get = vi.fn<ConsentRevisionsPort['get']>()
    .mockResolvedValueOnce(consentSnapshot({ draft: revision('d1', config), editor: { ...initial.editor, defaults: { customCss: 'default style' } } }))
    .mockResolvedValueOnce(initial);
  const saveDraft = vi.fn<ConsentRevisionsPort['saveDraft']>().mockRejectedValueOnce(conflict());
  const { ui, seen } = recordingUi();
  renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="look"
    port={fakeConsentPort({ get, saveDraft })} useTranslate={english} errors={consentErrors} ui={ui} delays={{ autosaveMs: 0, previewMs: 0 }} />);
  // Conflict keeps the current edits visible. Drive a separate field edit so Reset still applies.
  await screen.findByText('LookFields');
  act(() => (seen.LookFields as ConsentScreenFieldsProps).onChange({ patch: { title: 'New draft title' } }));
  const warning = await screen.findByRole('alert');
  expect(warning).toHaveTextContent('Someone else changed this. Reload to see it.');
  expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
  await userEvent.click(within(warning).getByRole('button', { name: 'Reload' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(get).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
});

it('announces a publish failure and keeps the unpublished draft available to retry', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise; });
  const publish = vi.fn<ConsentRevisionsPort['publish']>().mockReturnValueOnce(pending);
  const config = { ...CONSENT_CONFIG, title: 'Unpublished title' };
  renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="overview"
    port={fakeConsentPort({
      get: async () => consentSnapshot({ draft: revision('d7', config), published: revision('p5') }),
      publish,
    })} useTranslate={english} errors={consentErrors} ui={recordingUi().ui} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
  expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
  expect(publish).toHaveBeenCalledExactlyOnceWith({ draftId: 'd7', expectedPublishedId: 'p5' });
  await act(async () => { reject(new Error('offline')); });
  expect(screen.getByRole('alert')).toHaveTextContent("Couldn't publish.");
  expect(screen.getByText('You have changes that are not live yet.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
});

it('announces a failed autosave and leaves the edited draft visible without enabling Publish', async () => {
  const saveDraft = vi.fn<ConsentRevisionsPort['saveDraft']>().mockRejectedValue(new Error('private transport details'));
  const { ui, seen } = recordingUi();
  renderWithAdminKit(<CookieConsent hooks={hooks} agentHandle={agentHandle} tabId="banner"
    port={fakeConsentPort({ saveDraft })} useTranslate={english} errors={consentErrors} ui={ui} delays={{ autosaveMs: 0, previewMs: 0 }} />);
  await screen.findByText('BannerFields');
  act(() => (seen.BannerFields as ConsentScreenFieldsProps).onChange({ patch: { title: 'Keep this title' } }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save.");
  expect((seen.BannerFields as ConsentScreenFieldsProps).value.title).toBe('Keep this title');
  expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  expect(saveDraft.mock.calls).toEqual([[{ config: { ...CONSENT_CONFIG, enabled: false, title: 'Keep this title' }, expectedDraftId: null }]]);
});
