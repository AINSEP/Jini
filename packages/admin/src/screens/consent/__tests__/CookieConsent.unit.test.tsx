// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithAdminKit } from '../../../react/__tests__/render-with-admin-kit.js';
import { fakeAdminKit } from '../../../react/testing-kit.js';
import { CookieConsent, type ConsentScreenFieldsProps, type ConsentScreenUi } from '../CookieConsent.js';
import { consentTranslation } from '../consent-i18n.js';
import { consentErrors, consentSnapshot, fakeConsentPort } from './consent-fixtures.js';

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

const useGerman = () => consentTranslation({ locale: 'de' });

describe('CookieConsent', () => {
  it('passes the look section the kit light palette and previews through the injected frame', async () => {
    const kit = fakeAdminKit();
    const { ui, seen } = recordingUi();
    renderWithAdminKit(<CookieConsent tabId="look" port={fakeConsentPort({ get: () => Promise.resolve(consentSnapshot()) })} useTranslate={useGerman} errors={consentErrors} ui={ui} delays={{ previewMs: 0 }} />, { kit });
    await screen.findByText('LookFields');
    expect((seen.LookFields as { lightColors: unknown }).lightColors).toBe(kit.theme.defaultAdminTheme.light);
    expect((seen.LookFields as ConsentScreenFieldsProps).dictionary).toBe(useGerman().dictionary);
    await waitFor(() => expect(screen.getByText('<p>page</p>')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(useGerman().t('Cookie Consent'));
  });

  it('shows the host error reader message when the load fails', async () => {
    const { ui } = recordingUi();
    const errors = { ...consentErrors, describe: () => 'host says no' };
    renderWithAdminKit(<CookieConsent tabId="banner" port={fakeConsentPort({ get: () => Promise.reject(new Error('x')) })} useTranslate={useGerman} errors={errors} ui={ui} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('host says no');
  });

  it('renders the banner section with the editor banner modes', async () => {
    const { ui, seen } = recordingUi();
    const snapshot = consentSnapshot();
    renderWithAdminKit(<CookieConsent tabId="banner" port={fakeConsentPort({ get: () => Promise.resolve({ ...snapshot, editor: { ...snapshot.editor, bannerModes: ['jini', 'off'] } }) })} useTranslate={useGerman} errors={consentErrors} ui={ui} />);
    await screen.findByText('BannerFields');
    expect((seen.BannerFields as { bannerModes: unknown }).bannerModes).toEqual(['jini', 'off']);
  });

  it('renders only jini-* class names on every tab, so the host stylesheet owns the look', async () => {
    const classesOf = (root: Element) => [...root.querySelectorAll('[class]')].flatMap((el) => [...el.classList]);
    const english = () => consentTranslation({ locale: 'en' });
    const overview = renderWithAdminKit(<CookieConsent tabId="overview" port={fakeConsentPort({ get: () => Promise.resolve(consentSnapshot()) })} useTranslate={english} errors={consentErrors} ui={recordingUi().ui} />);
    await screen.findByText('Nothing blocks the banner.');
    const classes = classesOf(overview.container);
    overview.unmount();
    const look = renderWithAdminKit(<CookieConsent tabId="look" port={fakeConsentPort({ get: () => Promise.resolve(consentSnapshot()) })} useTranslate={english} errors={consentErrors} ui={recordingUi().ui} delays={{ previewMs: 0 }} />);
    await screen.findByText('LookFields');
    classes.push(...classesOf(look.container));
    look.unmount();
    const failed = renderWithAdminKit(<CookieConsent tabId="banner" port={fakeConsentPort({ get: () => Promise.reject(new Error('x')) })} useTranslate={english} errors={{ ...consentErrors, describe: () => 'Load failed.' }} ui={recordingUi().ui} />);
    await screen.findByText('Load failed.');
    classes.push(...classesOf(failed.container));
    expect(classes).toEqual(expect.arrayContaining(['jini-consent-page', 'jini-page-title', 'jini-card', 'jini-card-head', 'jini-status-neutral', 'jini-page-actions', 'jini-btn-primary', 'jini-notice-error']));
    expect(classes.filter((name) => !name.startsWith('jini-'))).toEqual([]);
  });
});
